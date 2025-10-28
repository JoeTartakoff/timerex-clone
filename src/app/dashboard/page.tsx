'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Folder {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
  updated_at: string
}

interface Schedule {
  id: string
  title: string
  description: string
  share_link: string
  date_range_start: string
  date_range_end: string
  time_slot_duration: number
  created_at: string
  is_one_time_link: boolean
  is_used: boolean
  used_at: string | null
  is_candidate_mode: boolean
  candidate_slots: Array<{
    date: string
    startTime: string
    endTime: string
  }> | null
  is_interview_mode: boolean
  interview_time_start: string | null
  interview_time_end: string | null
  folder_id: string | null
  team_id: string | null  
}

interface GuestPreset {
  id: string
  schedule_id: string
  guest_name: string
  guest_email: string
  custom_token: string
  created_at: string
}

interface GuestResponse {
  id: string
  schedule_id: string
  guest_name: string
  guest_email: string
  selected_slots: Array<{
    date: string
    startTime: string
    endTime: string
  }>
  share_token: string
  is_confirmed: boolean
  confirmed_slot: {
    date: string
    startTime: string
    endTime: string
  } | null
  created_at: string
}

interface Booking {
  id: string
  schedule_id: string
  booking_date: string
  start_time: string
  end_time: string
  guest_name: string
  guest_email: string
  status: string
  host_calendar_event_id: string | null
  guest_calendar_event_id: string | null
  guest_user_id: string | null
  assigned_user_id: string | null
  created_at: string
}

interface Toast {
  id: string
  message: string
  type: 'blue' | 'yellow' | 'purple' | 'orange' | 'green'
}

type FilterType = 'all' | 'normal' | 'candidate' | 'interview'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [guestPresetsMap, setGuestPresetsMap] = useState<Record<string, GuestPreset[]>>({})
  const [guestResponsesMap, setGuestResponsesMap] = useState<Record<string, GuestResponse[]>>({})
  const [bookingsMap, setBookingsMap] = useState<Record<string, Booking[]>>({})
  const [quickGuestInfo, setQuickGuestInfo] = useState({
    name: '',
    email: ''
  })
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [selectedFilter, setSelectedFilter] = useState<FilterType>('all')

  const showToast = (message: string, type: Toast['type']) => {
    const id = Math.random().toString(36).substring(7)
    const newToast: Toast = { id, message, type }
    
    setToasts(prev => [...prev, newToast])
    
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  useEffect(() => {
    checkUser()
  }, [])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login')
      return
    }
    
    setUser(user)

    const { data: { session } } = await supabase.auth.getSession()
    if (session?.provider_token && session?.provider_refresh_token) {
      try {
        const expiresAt = new Date(Date.now() + (session.expires_in || 3600) * 1000).toISOString()
        
        await supabase
          .from('user_tokens')
          .upsert({
            user_id: user.id,
            access_token: session.provider_token,
            refresh_token: session.provider_refresh_token,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id'
          })
      } catch (error) {
        console.error('Failed to save tokens:', error)
      }
    }

    await fetchSchedules(user.id)
    setLoading(false)
  }

  const fetchSchedules = async (userId: string) => {
    try {
      console.log('🔍 fetchSchedules 시작, userId:', userId)
      
      const { data: foldersData } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
      
      setFolders(foldersData || [])

      console.log('📅 개인 스케줄 조회 시작...')
      const { data: personalSchedules, error: personalError } = await supabase
        .from('schedules')
        .select('*')
        .eq('user_id', userId)
        .eq('is_one_time_link', false)
        .order('created_at', { ascending: false })

      console.log('📊 결과:', { personalSchedules, personalError })

      if (personalError) {
        console.error('❌ Error fetching personal schedules:', personalError)
        setSchedules([])
        return
      }

      const { data: myTeams } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)

      let teamSchedules: any[] = []
      if (myTeams && myTeams.length > 0) {
        const teamIds = myTeams.map(t => t.team_id)
        const { data: teamSchedulesData } = await supabase
          .from('schedules')
          .select('*')
          .in('team_id', teamIds)
          .eq('is_one_time_link', false)
          .order('created_at', { ascending: false })
        
        teamSchedules = teamSchedulesData || []
      }

      const allSchedules = [...(personalSchedules || []), ...teamSchedules]
      setSchedules(allSchedules)

      if (allSchedules && allSchedules.length > 0) {
        const presetsMap: Record<string, GuestPreset[]> = {}
        const responsesMap: Record<string, GuestResponse[]> = {}
        const bookingsMap: Record<string, Booking[]> = {}
        
        for (const schedule of allSchedules) {
          const { data: presets } = await supabase
            .from('guest_presets')
            .select('*')
            .eq('schedule_id', schedule.id)
            .order('created_at', { ascending: true })
          
          if (presets && presets.length > 0) {
            presetsMap[schedule.id] = presets
          }

          if (schedule.is_candidate_mode || schedule.is_interview_mode) {
            const { data: responses } = await supabase
              .from('guest_responses')
              .select('*')
              .eq('schedule_id', schedule.id)
              .order('created_at', { ascending: false })
            
            if (responses && responses.length > 0) {
              responsesMap[schedule.id] = responses
            }
          }

          if (!schedule.is_candidate_mode && !schedule.is_interview_mode) {
            const { data: bookings } = await supabase
              .from('bookings')
              .select('*')
              .eq('schedule_id', schedule.id)
              .eq('status', 'confirmed')
              .order('booking_date', { ascending: false })
              .order('start_time', { ascending: false })
              .limit(5)
            
            if (bookings && bookings.length > 0) {
              bookingsMap[schedule.id] = bookings
              console.log(`✅ Found ${bookings.length} bookings for schedule:`, schedule.title)
            }
          }
        }
        
        setGuestPresetsMap(presetsMap)
        setGuestResponsesMap(responsesMap)
        setBookingsMap(bookingsMap)
      }
    } catch (error) {
      console.error('Error in fetchSchedules:', error)
      setSchedules([])
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const copyOneTimeLink = async (shareLink: string, scheduleId: string) => {
    try {
      const response = await fetch('/api/one-time-token/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Token creation failed')
      }

      const { token } = await response.json()
      console.log('✅ One-time token created:', token)

      let url = `${window.location.origin}/book/${shareLink}`
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        const encodedName = encodeURIComponent(quickGuestInfo.name)
        const encodedEmail = encodeURIComponent(quickGuestInfo.email)
        url = `${window.location.origin}/book/${shareLink}/${encodedName}/${encodedEmail}?token=${token}`
      } else {
        url = `${window.location.origin}/book/${shareLink}?token=${token}`
      }
      
      navigator.clipboard.writeText(url)
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        showToast(
          `${quickGuestInfo.name}様専用ワンタイムリンクをコピーしました！\n1回だけ予約可能なリンクです。\n有効期限：24時間`,
          'yellow'
        )
      } else {
        showToast(
          'ワンタイムリンクをコピーしました！\n1回だけ予約可能なリンクです。\n有効期限：24時間',
          'yellow'
        )
      }
    } catch (error) {
      console.error('❌ Error creating one-time link:', error)
      showToast('ワンタイムリンクの生成に失敗しました', 'yellow')
    }
  }

  const copyFixedLink = (shareLink: string, isCandidateMode: boolean, isInterviewMode: boolean) => {
    let url
    let toastType: Toast['type'] = 'blue'
    let message = ''
    
    if (isInterviewMode) {
      toastType = 'orange'
      url = `${window.location.origin}/interview/${shareLink}`
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        const encodedName = encodeURIComponent(quickGuestInfo.name)
        const encodedEmail = encodeURIComponent(quickGuestInfo.email)
        url = `${window.location.origin}/interview/${shareLink}?name=${encodedName}&email=${encodedEmail}`
        message = `${quickGuestInfo.name}様専用候補日受取リンクをコピーしました！\nゲストが自由に候補時間を提案できます。`
      } else {
        message = '候補日受取リンクをコピーしました！\nゲストが自由に候補時間を提案できます。'
      }
    } else if (isCandidateMode) {
      toastType = 'purple'
      url = `${window.location.origin}/candidate/${shareLink}`
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        const encodedName = encodeURIComponent(quickGuestInfo.name)
        const encodedEmail = encodeURIComponent(quickGuestInfo.email)
        url = `${window.location.origin}/candidate/${shareLink}?name=${encodedName}&email=${encodedEmail}`
        message = `${quickGuestInfo.name}様専用候補時間提示リンクをコピーしました！\nゲストは複数の候補から選択できます。`
      } else {
        message = '候補時間提示リンクをコピーしました！\nゲストは複数の候補から選択できます。'
      }
    } else {
      toastType = 'blue'
      url = `${window.location.origin}/book/${shareLink}`
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        const encodedName = encodeURIComponent(quickGuestInfo.name)
        const encodedEmail = encodeURIComponent(quickGuestInfo.email)
        url = `${window.location.origin}/book/${shareLink}/${encodedName}/${encodedEmail}`
        message = `${quickGuestInfo.name}様専用通常予約リンクをコピーしました！\n何度でも予約可能なリンクです。`
      } else {
        message = '通常予約リンクをコピーしました！\n何度でも予約可能なリンクです。'
      }
    }
    
    navigator.clipboard.writeText(url)
    showToast(message, toastType)
  }

  const copyPersonalizedLink = (shareLink: string, guestToken: string, guestName: string) => {
    const url = `${window.location.origin}/book/${shareLink}?guest=${guestToken}`
    navigator.clipboard.writeText(url)
    showToast(
      `${guestName}様専用リンクをコピーしました！\n情報が自動入力されます。`,
      'green'
    )
  }

const confirmGuestResponse = async (responseId: string, slot: { date: string, startTime: string, endTime: string }, scheduleId: string) => {
  if (!confirm('この時間で確定しますか？\n両方のGoogleカレンダーに予定が追加されます。')) return

  try {
    const guestResponse = guestResponsesMap[scheduleId].find(r => r.id === responseId)
    if (!guestResponse) {
      alert('ゲスト情報が見つかりません')
      return
    }

    console.log('🔵 Confirming guest response...')
    console.log('   Response ID:', responseId)
    console.log('   Guest:', guestResponse.guest_name, guestResponse.guest_email)
    console.log('   Slot:', slot)

    const { error: updateError } = await supabase
      .from('guest_responses')
      .update({
        is_confirmed: true,
        confirmed_slot: slot
      })
      .eq('id', responseId)

    if (updateError) throw updateError

    console.log('✅ guest_responses updated')

    const response = await fetch('/api/calendar/add-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduleId,
        bookingDate: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        guestName: guestResponse.guest_name,
        guestEmail: guestResponse.guest_email,
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ Calendar API error:', errorData)
      throw new Error('カレンダーへの追加に失敗しました')
    }

    const result = await response.json()
    console.log('✅ Calendar API result:', result)

    console.log('💾 Saving to bookings table...')
    const { error: bookingError } = await supabase
      .from('bookings')
      .insert({
        schedule_id: scheduleId,
        guest_name: guestResponse.guest_name,
        guest_email: guestResponse.guest_email,
        booking_date: slot.date,
        start_time: slot.startTime,
        end_time: slot.endTime,
        status: 'confirmed',
        host_calendar_event_id: result.hostEventIds?.[0] || null,
        guest_calendar_event_id: result.guestEventId || null,
        assigned_user_id: result.assignedUserId || null,
      })

    if (bookingError) {
      console.error('⚠️ Failed to save booking:', bookingError)
      alert('予定を確定しました！\n（データベースへの保存に一部失敗しましたが、カレンダーには追加されています）')
    } else {
      console.log('✅ Booking saved to database')
      alert('予定を確定しました！\n両方のカレンダーに追加されました。')
    }
    
    if (user) {
      await fetchSchedules(user.id)
    }
  } catch (error) {
    console.error('Error confirming response:', error)
    alert('確定に失敗しました')
  }
}

  const deleteSchedule = async (id: string) => {
    if (!confirm('このスケジュールを削除しますか？')) return

    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', id)

    if (error) {
      alert('削除に失敗しました')
      return
    }

    alert('削除しました')
    if (user) {
      await fetchSchedules(user.id)
    }
  }

  // ⭐ 통상모드 예약 취소
  const cancelBooking = async (bookingId: string, guestName: string) => {
    if (!confirm(`${guestName}様の予約をキャンセルしますか？\n\n両方のGoogleカレンダーから予定が削除されます。`)) {
      return
    }

    try {
      console.log('🗑️ Cancelling booking:', bookingId)
      
      const response = await fetch('/api/calendar/delete-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          bookingId,
          type: 'booking'
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'キャンセルに失敗しました')
      }

      console.log('✅ Booking cancelled:', result)

      let message = '予約をキャンセルしました\n\n'
      
      if (result.hostDeleted && result.guestDeleted) {
        message += '✅ ホストとゲストのカレンダーから削除されました'
      } else if (result.hostDeleted) {
        message += '✅ ホストのカレンダーから削除されました\n⚠️ ゲストのカレンダーは手動で削除が必要です'
      } else if (result.guestDeleted) {
        message += '✅ ゲストのカレンダーから削除されました\n⚠️ ホストのカレンダーは手動で削除が必要です'
      } else {
        message += '⚠️ カレンダーからの削除に失敗しました\n手動で削除してください'
      }

      alert(message)
      
      if (user) {
        await fetchSchedules(user.id)
      }
    } catch (error) {
      console.error('❌ Cancel booking error:', error)
      alert('予約のキャンセルに失敗しました')
    }
  }

  // ⭐ 후보시간제시/후보일받기 확정 취소
  const cancelGuestResponse = async (responseId: string, guestName: string) => {
    if (!confirm(`${guestName}様の確定をキャンセルしますか？\n\n両方のGoogleカレンダーから予定が削除され、未確定状態に戻ります。`)) {
      return
    }

    try {
      console.log('🗑️ Cancelling guest response:', responseId)
      
      const response = await fetch('/api/calendar/delete-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          responseId,
          type: 'response'
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'キャンセルに失敗しました')
      }

      console.log('✅ Response cancelled:', result)

      let message = '確定をキャンセルしました\n未確定状態に戻りました\n\n'
      
      if (result.hostDeleted && result.guestDeleted) {
        message += '✅ ホストとゲストのカレンダーから削除されました'
      } else if (result.hostDeleted) {
        message += '✅ ホストのカレンダーから削除されました\n⚠️ ゲストのカレンダーは手動で削除が必要です'
      } else if (result.guestDeleted) {
        message += '✅ ゲストのカレンダーから削除されました\n⚠️ ホストのカレンダーは手動で削除が必要です'
      } else {
        message += '⚠️ カレンダーからの削除に失敗しました\n手動で削除してください'
      }

      alert(message)
      
      if (user) {
        await fetchSchedules(user.id)
      }
    } catch (error) {
      console.error('❌ Cancel response error:', error)
      alert('キャンセルに失敗しました')
    }
  }

  const createFolder = async () => {
    if (!folderName.trim()) {
      alert('フォルダ名を入力してください')
      return
    }

    try {
      const { error } = await supabase
        .from('folders')
        .insert({
          user_id: user.id,
          name: folderName,
          color: '#3B82F6',
        })

      if (error) throw error

      alert('フォルダを作成しました')
      setFolderName('')
      setShowFolderModal(false)
      
      if (user) {
        await fetchSchedules(user.id)
      }
    } catch (error) {
      console.error('Error creating folder:', error)
      alert('フォルダの作成に失敗しました')
    }
  }

  const updateFolder = async () => {
    if (!editingFolder || !folderName.trim()) return

    try {
      const { error } = await supabase
        .from('folders')
        .update({ name: folderName, updated_at: new Date().toISOString() })
        .eq('id', editingFolder.id)

      if (error) throw error

      alert('フォルダ名を変更しました')
      setFolderName('')
      setEditingFolder(null)
      setShowFolderModal(false)
      
      if (user) {
        await fetchSchedules(user.id)
      }
    } catch (error) {
      console.error('Error updating folder:', error)
      alert('フォルダ名の変更に失敗しました')
    }
  }

  const deleteFolder = async (folderId: string) => {
    if (!confirm('このフォルダを削除しますか？\nフォルダ内のスケジュールは未分類に移動されます。')) return

    try {
      const { error } = await supabase
        .from('folders')
        .delete()
        .eq('id', folderId)

      if (error) throw error

      alert('フォルダを削除しました')
      
      if (user) {
        await fetchSchedules(user.id)
      }
    } catch (error) {
      console.error('Error deleting folder:', error)
      alert('フォルダの削除に失敗しました')
    }
  }

  const moveScheduleToFolder = async (scheduleId: string, folderId: string | null) => {
    try {
      const { error } = await supabase
        .from('schedules')
        .update({ folder_id: folderId })
        .eq('id', scheduleId)

      if (error) throw error

      if (user) {
        await fetchSchedules(user.id)
      }
    } catch (error) {
      console.error('Error moving schedule:', error)
      alert('スケジュールの移動に失敗しました')
    }
  }

  const openFolderModal = (folder?: Folder) => {
    if (folder) {
      setEditingFolder(folder)
      setFolderName(folder.name)
    } else {
      setEditingFolder(null)
      setFolderName('')
    }
    setShowFolderModal(true)
  }

  const closeFolderModal = () => {
    setShowFolderModal(false)
    setFolderName('')
    setEditingFolder(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  const folderFilteredSchedules = selectedFolder === 'uncategorized'
    ? schedules.filter(s => !s.folder_id)
    : selectedFolder
    ? schedules.filter(s => s.folder_id === selectedFolder)
    : schedules

  const filteredSchedules = folderFilteredSchedules.filter(schedule => {
    if (selectedFilter === 'all') return true
    if (selectedFilter === 'normal') return !schedule.is_candidate_mode && !schedule.is_interview_mode
    if (selectedFilter === 'candidate') return schedule.is_candidate_mode
    if (selectedFilter === 'interview') return schedule.is_interview_mode
    return true
  })

  const normalCount = folderFilteredSchedules.filter(s => !s.is_candidate_mode && !s.is_interview_mode).length
  const candidateCount = folderFilteredSchedules.filter(s => s.is_candidate_mode).length
  const interviewCount = folderFilteredSchedules.filter(s => s.is_interview_mode).length

  const getToastBgColor = (type: Toast['type']) => {
    switch (type) {
      case 'blue': return 'bg-blue-500'
      case 'yellow': return 'bg-yellow-500'
      case 'purple': return 'bg-purple-500'
      case 'orange': return 'bg-orange-500'
      case 'green': return 'bg-green-500'
      default: return 'bg-blue-500'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <div className="fixed top-4 right-4 z-[9999] space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${getToastBgColor(toast.type)} text-white px-6 py-4 rounded-lg shadow-lg min-w-[300px] max-w-md animate-slide-down`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium whitespace-pre-line flex-1">
                {toast.message}
              </p>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-white hover:text-gray-200 transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-64 bg-white shadow-lg flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">ヤクソクAI</h1>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                Navigation
              </h2>
            </div>
            <div className="space-y-1">
              <Link
                href="/dashboard"
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 font-medium"
                onClick={() => setIsSidebarOpen(false)}
              >
                <span>📅</span>
                <span>スケジュール</span>
              </Link>
              <Link
                href="/teams"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-50"
                onClick={() => setIsSidebarOpen(false)}
              >
                <span>👥</span>
                <span>チーム管理</span>
              </Link>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                フォルダ
              </h2>
              <button
                onClick={() => openFolderModal()}
                className="text-blue-600 hover:text-blue-700 text-xl"
                title="新規フォルダ作成"
              >
                +
              </button>
            </div>

            <div className="space-y-1">
              <button
                onClick={() => {
                  setSelectedFolder(null)
                  setIsSidebarOpen(false)
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedFolder === null
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📋</span>
                  <span>すべて</span>
                </div>
                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">
                  {schedules.length}
                </span>
              </button>

              <button
                onClick={() => {
                  setSelectedFolder('uncategorized')
                  setIsSidebarOpen(false)
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedFolder === 'uncategorized'
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📂</span>
                  <span>未分類</span>
                </div>
                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">
                  {schedules.filter(s => !s.folder_id).length}
                </span>
              </button>

              {folders.map((folder) => (
                <div key={folder.id} className="group relative">
                  <button
                    onClick={() => {
                      setSelectedFolder(folder.id)
                      setIsSidebarOpen(false)
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedFolder === folder.id
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span>📁</span>
                      <span className="truncate">{folder.name}</span>
                    </div>
                    <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">
                      {schedules.filter(s => s.folder_id === folder.id).length}
                    </span>
                  </button>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openFolderModal(folder)
                      }}
                      className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                      title="編集"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteFolder(folder.id)
                      }}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="削除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-700 truncate">{user?.email}</span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            ログアウト
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="lg:hidden bg-white shadow-sm sticky top-0 z-30">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">ヤクソクAI</h1>
            <div className="w-10"></div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="mb-6 bg-white shadow rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              📝 クイックゲスト情報入力 (オプション)
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              ゲスト情報を入力してからリンクをコピーすると、専用リンクが生成されます
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 w-full">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  名前
                </label>
                <input
                  type="text"
                  value={quickGuestInfo.name}
                  onChange={(e) => setQuickGuestInfo({ ...quickGuestInfo, name: e.target.value })}
                  placeholder="例：田中太郎"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div className="flex-1 w-full">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={quickGuestInfo.email}
                  onChange={(e) => setQuickGuestInfo({ ...quickGuestInfo, email: e.target.value })}
                  placeholder="例：tanaka@example.com"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={() => setQuickGuestInfo({ name: '', email: '' })}
                className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                クリア
              </button>
            </div>
            {quickGuestInfo.name && quickGuestInfo.email && (
              <div className="mt-2 text-xs text-green-600">
                ✅ {quickGuestInfo.name}様専用リンクが生成されます
              </div>
            )}
          </div>

          <div className="mb-6">
            <Link
              href="/schedules/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              + 予約カレンダー作成
            </Link>
          </div>

          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                作成した予約カレンダー
              </h2>
              
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedFilter('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedFilter === 'all'
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  📋 全体 ({folderFilteredSchedules.length})
                </button>
                <button
                  onClick={() => setSelectedFilter('normal')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedFilter === 'normal'
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  🔵 通常モード ({normalCount})
                </button>
                <button
                  onClick={() => setSelectedFilter('candidate')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedFilter === 'candidate'
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  🟣 候補時間提示モード ({candidateCount})
                </button>
                <button
                  onClick={() => setSelectedFilter('interview')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedFilter === 'interview'
                      ? 'bg-orange-600 text-white'
                      : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                  }`}
                >
                  🟠 候補日受取モード ({interviewCount})
                </button>
              </div>
            </div>

            {filteredSchedules.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-gray-500">
                  {selectedFilter !== 'all' 
                    ? 'このモードの予約カレンダーがありません。' 
                    : selectedFolder 
                    ? 'このフォルダに予約カレンダーがありません。' 
                    : 'まだ予約カレンダーがありません。新しい予約カレンダーを作成してください。'
                  }
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredSchedules.map((schedule) => (
                  <div key={schedule.id} className="px-4 sm:px-6 py-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className="text-lg font-medium text-gray-900">
                            {schedule.title}
                          </h3>
                          {schedule.is_candidate_mode && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              📋 候補時間を提示
                            </span>
                          )}
                          {schedule.is_interview_mode && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                              🎤 候補日を受取
                            </span>
                          )}
                        </div>
                        {schedule.description && (
                          <p className="text-sm text-gray-500 mb-2">
                            {schedule.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                          <span>
                            📅 {schedule.date_range_start} ～ {schedule.date_range_end}
                          </span>
                          <span>
                            ⏱️ {schedule.time_slot_duration}分枠
                          </span>
                        </div>

                        <div className="mt-2">
                          <select
                            value={schedule.folder_id || ''}
                            onChange={(e) => moveScheduleToFolder(schedule.id, e.target.value || null)}
                            className="text-xs border border-gray-300 rounded px-2 py-1"
                          >
                            <option value="">📂 未分類</option>
                            {folders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                📁 {folder.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* ⭐ 통상모드 확정 예약 표시 */}
                        {!schedule.is_candidate_mode && 
                         !schedule.is_interview_mode && 
                         bookingsMap[schedule.id] && 
                         bookingsMap[schedule.id].length > 0 && (
                          <div className="mt-3 p-3 bg-blue-50 rounded-md border border-blue-200">
                            <p className="text-sm font-medium text-blue-800 mb-2">
                              ✅ 確定済み予約 ({bookingsMap[schedule.id].length}件)
                            </p>
                            <div className="space-y-2">
                              {bookingsMap[schedule.id].map((booking) => (
                                <div key={booking.id} className="bg-white p-2 rounded border border-blue-200">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-gray-900 truncate">
                                        {booking.guest_name}
                                      </p>
                                      <p className="text-xs text-gray-500 truncate">
                                        {booking.guest_email}
                                      </p>
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <div className="text-right flex-shrink-0">
                                        <p className="text-xs font-medium text-blue-900">
                                          {new Date(booking.booking_date).toLocaleDateString('ja-JP', {
                                            month: 'short',
                                            day: 'numeric'
                                          })}
                                        </p>
                                        <p className="text-xs text-blue-700">
                                          {booking.start_time.slice(0, 5)} - {booking.end_time.slice(0, 5)}
                                        </p>
                                      </div>
                                      <button
                                        onClick={() => cancelBooking(booking.id, booking.guest_name)}
                                        className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium transition-colors whitespace-nowrap"
                                        title="予約をキャンセル"
                                      >
                                        キャンセル
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ⭐ 후보시간제시/후보일받기 응답 표시 */}
                        {(schedule.is_candidate_mode || schedule.is_interview_mode) && guestResponsesMap[schedule.id] && guestResponsesMap[schedule.id].length > 0 && (
                          <div className={`mt-3 p-3 rounded-md border ${schedule.is_interview_mode ? 'bg-orange-50 border-orange-200' : 'bg-purple-50 border-purple-200'}`}>
                            <p className={`text-sm font-medium mb-2 ${schedule.is_interview_mode ? 'text-orange-800' : 'text-purple-800'}`}>
                              📬 ゲスト応答 ({guestResponsesMap[schedule.id].length}件)
                            </p>
                            <div className="space-y-2">
                              {guestResponsesMap[schedule.id].map((response) => (
                                <div key={response.id} className={`bg-white p-3 rounded border ${schedule.is_interview_mode ? 'border-orange-200' : 'border-purple-200'}`}>
                                  <div className="flex items-start justify-between mb-2">
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">{response.guest_name}</p>
                                      <p className="text-xs text-gray-500">{response.guest_email}</p>
                                    </div>
                                    {response.is_confirmed && (
                                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        ✅ 確定済み
                                      </span>
                                    )}
                                  </div>
                                  
                                  {response.is_confirmed && response.confirmed_slot ? (
                                    <div className="bg-green-50 p-2 rounded">
                                      <div className="flex items-center justify-between">
                                        <p className="text-xs text-green-800 flex-1">
                                          確定時間: {new Date(response.confirmed_slot.date).toLocaleDateString('ja-JP')} {response.confirmed_slot.startTime.slice(0, 5)} - {response.confirmed_slot.endTime.slice(0, 5)}
                                        </p>
                                        {/* ⭐ 취소 버튼 추가 */}
                                        <button
                                          onClick={() => cancelGuestResponse(response.id, response.guest_name)}
                                          className="ml-2 px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium transition-colors whitespace-nowrap"
                                          title="確定をキャンセル"
                                        >
                                          キャンセル
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div>
                                      <p className="text-xs text-gray-600 mb-2">希望時間 ({response.selected_slots.length}個):</p>
                                      <div className="grid grid-cols-2 gap-2">
                                        {response.selected_slots.map((slot, idx) => (
                                          <button
                                            key={idx}
                                            onClick={() => confirmGuestResponse(response.id, slot, schedule.id)}
                                            className={`text-left p-2 rounded border text-xs ${schedule.is_interview_mode ? 'bg-orange-50 hover:bg-orange-100 border-orange-200' : 'bg-purple-50 hover:bg-purple-100 border-purple-200'}`}
                                          >
                                            <div className={`font-medium ${schedule.is_interview_mode ? 'text-orange-900' : 'text-purple-900'}`}>
                                              {new Date(slot.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                                            </div>
                                            <div className={schedule.is_interview_mode ? 'text-orange-700' : 'text-purple-700'}>
                                              {slot.startTime.slice(0, 5)} - {slot.endTime.slice(0, 5)}
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {guestPresetsMap[schedule.id] && guestPresetsMap[schedule.id].length > 0 && (
                          <div className="mt-3 p-3 bg-green-50 rounded-md border border-green-200">
                            <p className="text-sm font-medium text-green-800 mb-2">
                              👥 登録済みゲスト ({guestPresetsMap[schedule.id].length}名)
                            </p>
                            <div className="space-y-2">
                              {guestPresetsMap[schedule.id].map((guest) => (
                                <div key={guest.id} className="flex items-center justify-between bg-white p-2 rounded border border-green-200">
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900">{guest.guest_name}</p>
                                    <p className="text-xs text-gray-500">{guest.guest_email}</p>
                                  </div>
                                  <button
                                    onClick={() => copyPersonalizedLink(schedule.share_link, guest.custom_token, guest.guest_name)}
                                    className="ml-2 px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 whitespace-nowrap"
                                  >
                                    専用リンク
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap lg:flex-nowrap items-center gap-2">
                        <Link
                          href={`/schedules/${schedule.id}/edit`}
                          className="flex-1 sm:flex-initial px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 whitespace-nowrap text-center"
                        >
                          編集
                        </Link>
                        {!schedule.is_candidate_mode && !schedule.is_interview_mode && (
                          <button
                            onClick={() => copyOneTimeLink(schedule.share_link, schedule.id)}
                            className="flex-1 sm:flex-initial px-3 py-2 border border-yellow-300 bg-yellow-50 rounded-md text-sm font-medium text-yellow-700 hover:bg-yellow-100 whitespace-nowrap"
                          >
                            ワンタイム
                          </button>
                        )}
                        <button
                          onClick={() => copyFixedLink(schedule.share_link, schedule.is_candidate_mode, schedule.is_interview_mode)}
                          className={`flex-1 sm:flex-initial px-3 py-2 border rounded-md text-sm font-medium whitespace-nowrap ${
                            schedule.is_interview_mode
                              ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                              : schedule.is_candidate_mode
                              ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100'
                              : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                          }`}
                        >
                          {schedule.is_interview_mode ? '候補日受取' : schedule.is_candidate_mode ? '候補時間' : '通常予約'}
                        </button>
                        <button
                          onClick={() => deleteSchedule(schedule.id)}
                          className="flex-1 sm:flex-initial px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 whitespace-nowrap"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {showFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {editingFolder ? 'フォルダ名を編集' : '新しいフォルダを作成'}
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                フォルダ名
              </label>
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="例：営業チーム"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={closeFolderModal}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={editingFolder ? updateFolder : createFolder}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium"
              >
                {editingFolder ? '保存' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes slide-down {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .animate-slide-down {
          animation: slide-down 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
