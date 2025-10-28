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

interface Toast {
  id: string
  message: string
  type: 'blue' | 'yellow' | 'purple' | 'orange' | 'green'
}

type FilterType = 'all' | 'normal' | 'candidate' | 'interview'

// ⭐ 확정/제안 건수를 함께 저장하는 타입
interface CountInfo {
  confirmed: number
  proposed: number
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [countMap, setCountMap] = useState<Record<string, CountInfo>>({})
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

    // ⭐ 확정/제안 건수 계산 (수정됨)
    if (allSchedules && allSchedules.length > 0) {
      const newCountMap: Record<string, CountInfo> = {}
      
      for (const schedule of allSchedules) {
        if (schedule.is_candidate_mode || schedule.is_interview_mode) {
          // 후보모드: 확정된 응답 수 + 미확정 제안 수
          const { data: allResponses } = await supabase
            .from('guest_responses')
            .select('id, is_confirmed')
            .eq('schedule_id', schedule.id)
          
          const confirmedCount = allResponses?.filter(r => r.is_confirmed).length || 0
          const unconfirmedCount = allResponses?.filter(r => !r.is_confirmed).length || 0

          newCountMap[schedule.id] = {
            confirmed: confirmedCount,
            proposed: unconfirmedCount  // ⭐ 미확정만 카운트
          }
        } else {
          // 통상모드: 확정된 예약 수만
          const { data: bookings } = await supabase
            .from('bookings')
            .select('id')
            .eq('schedule_id', schedule.id)
            .eq('status', 'confirmed')
          
          newCountMap[schedule.id] = {
            confirmed: bookings?.length || 0,
            proposed: 0
          }
        }
      }
      
      setCountMap(newCountMap)
      console.log('✅ Count map updated:', newCountMap)
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

  const navigateToDetail = (scheduleId: string) => {
    router.push(`/schedules/${scheduleId}/detail`)
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
                {filteredSchedules.map((schedule) => {
                  const count = countMap[schedule.id] || { confirmed: 0, proposed: 0 }
                  const isCandidateOrInterview = schedule.is_candidate_mode || schedule.is_interview_mode
                  
                  return (
                    <div key={schedule.id} className="px-4 sm:px-6 py-4 hover:bg-gray-50 transition-colors">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        {/* 왼쪽: 제목 + 확정건수/제안건수 + 폴더 */}
                        <div 
                          className="flex-1 cursor-pointer"
                          onClick={() => navigateToDetail(schedule.id)}
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="text-lg font-medium text-gray-900 hover:text-blue-600 transition-colors">
                              {schedule.title}
                            </h3>
                            {schedule.is_candidate_mode && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                🟣 候補時間提示
                              </span>
                            )}
                            {schedule.is_interview_mode && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                🟠 候補日受取
                              </span>
                            )}
                            {!schedule.is_candidate_mode && !schedule.is_interview_mode && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                🔵 通常モード
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            {isCandidateOrInterview ? (
                              <>
                                <span className="font-medium">
                                  ✅ 確定: {count.confirmed}件
                                </span>
                                <span className="font-medium">
                                  📬 提案: {count.proposed}件
                                </span>
                              </>
                            ) : (
                              <span className="font-medium">
                                ✅ 確定: {count.confirmed}件
                              </span>
                            )}
                          </div>

                          <div className="mt-2">
                            <select
                              value={schedule.folder_id || ''}
                              onChange={(e) => {
                                e.stopPropagation()
                                moveScheduleToFolder(schedule.id, e.target.value || null)
                              }}
                              onClick={(e) => e.stopPropagation()}
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
                        </div>
                        
                        {/* 오른쪽: 버튼들 */}
                        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2">
                          <Link
                            href={`/schedules/${schedule.id}/edit`}
                            className="flex-1 sm:flex-initial px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 whitespace-nowrap text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            編集
                          </Link>
                          {!schedule.is_candidate_mode && !schedule.is_interview_mode && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                copyOneTimeLink(schedule.share_link, schedule.id)
                              }}
                              className="flex-1 sm:flex-initial px-3 py-2 border border-yellow-300 bg-yellow-50 rounded-md text-sm font-medium text-yellow-700 hover:bg-yellow-100 whitespace-nowrap"
                            >
                              ワンタイム
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              copyFixedLink(schedule.share_link, schedule.is_candidate_mode, schedule.is_interview_mode)
                            }}
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
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteSchedule(schedule.id)
                            }}
                            className="flex-1 sm:flex-initial px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 whitespace-nowrap"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
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
