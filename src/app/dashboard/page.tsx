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

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [guestPresetsMap, setGuestPresetsMap] = useState<Record<string, GuestPreset[]>>({})
  const [guestResponsesMap, setGuestResponsesMap] = useState<Record<string, GuestResponse[]>>({})
  const [quickGuestInfo, setQuickGuestInfo] = useState({
    name: '',
    email: ''
  })
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)

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

      // 개인 스케줄 가져오기
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

      // 내가 속한 팀의 스케줄 가져오기
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

      // 개인 스케줄 + 팀 스케줄 합치기
      const allSchedules = [...(personalSchedules || []), ...teamSchedules]
      setSchedules(allSchedules)

      // 게스트 정보 가져오기
      if (allSchedules && allSchedules.length > 0) {
        const presetsMap: Record<string, GuestPreset[]> = {}
        const responsesMap: Record<string, GuestResponse[]> = {}
        
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
        }
        
        setGuestPresetsMap(presetsMap)
        setGuestResponsesMap(responsesMap)
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

  const copyOneTimeLink = (shareLink: string) => {
    const oneTimeToken = crypto.randomUUID()
    let url = `${window.location.origin}/book/${shareLink}`
    
    if (quickGuestInfo.name && quickGuestInfo.email) {
      const encodedName = encodeURIComponent(quickGuestInfo.name)
      const encodedEmail = encodeURIComponent(quickGuestInfo.email)
      url = `${window.location.origin}/book/${shareLink}/${encodedName}/${encodedEmail}?mode=onetime&token=${oneTimeToken}`
    } else {
      url = `${window.location.origin}/book/${shareLink}?mode=onetime&token=${oneTimeToken}`
    }
    
    navigator.clipboard.writeText(url)
    
    if (quickGuestInfo.name && quickGuestInfo.email) {
      alert(`${quickGuestInfo.name}様専用ワンタイムリンクをコピーしました！\n1回だけ予約可能なリンクです。`)
    } else {
      alert('ワンタイムリンクをコピーしました！\n1回だけ予約可能なリンクです。')
    }
  }

  const copyFixedLink = (shareLink: string, isCandidateMode: boolean, isInterviewMode: boolean) => {
    let url
    
    if (isInterviewMode) {
      url = `${window.location.origin}/interview/${shareLink}`
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        const encodedName = encodeURIComponent(quickGuestInfo.name)
        const encodedEmail = encodeURIComponent(quickGuestInfo.email)
        url = `${window.location.origin}/interview/${shareLink}?name=${encodedName}&email=${encodedEmail}`
      }
    } else if (isCandidateMode) {
      url = `${window.location.origin}/candidate/${shareLink}`
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        const encodedName = encodeURIComponent(quickGuestInfo.name)
        const encodedEmail = encodeURIComponent(quickGuestInfo.email)
        url = `${window.location.origin}/candidate/${shareLink}?name=${encodedName}&email=${encodedEmail}`
      }
    } else {
      url = `${window.location.origin}/book/${shareLink}`
      
      if (quickGuestInfo.name && quickGuestInfo.email) {
        const encodedName = encodeURIComponent(quickGuestInfo.name)
        const encodedEmail = encodeURIComponent(quickGuestInfo.email)
        url = `${window.location.origin}/book/${shareLink}/${encodedName}/${encodedEmail}`
      }
    }
    
    navigator.clipboard.writeText(url)
    
    if (isInterviewMode && quickGuestInfo.name && quickGuestInfo.email) {
      alert(`${quickGuestInfo.name}様専用面接リンクをコピーしました！\nゲストが自由に候補時間を提案できます。`)
    } else if (isInterviewMode) {
      alert('面接モードのリンクをコピーしました！\nゲストが自由に候補時間を提案できます。')
    } else if (isCandidateMode && quickGuestInfo.name && quickGuestInfo.email) {
      alert(`${quickGuestInfo.name}様専用候補リンクをコピーしました！\nゲストは複数の候補から選択できます。`)
    } else if (isCandidateMode) {
      alert('候補時間モードのリンクをコピーしました！\nゲストは複数の候補から選択できます。')
    } else if (quickGuestInfo.name && quickGuestInfo.email) {
      alert(`${quickGuestInfo.name}様専用リンクをコピーしました！\n何度でも予約可能なリンクです。`)
    } else {
      alert('固定リンクをコピーしました！\n何度でも予約可能なリンクです。')
    }
  }

  const copyPersonalizedLink = (shareLink: string, guestToken: string, guestName: string) => {
    const url = `${window.location.origin}/book/${shareLink}?guest=${guestToken}`
    navigator.clipboard.writeText(url)
    alert(`${guestName}様専用リンクをコピーしました！\n情報が自動入力されます。`)
  }

  const confirmGuestResponse = async (responseId: string, slot: { date: string, startTime: string, endTime: string }, scheduleId: string) => {
    if (!confirm('この時間で確定しますか？\n両方のGoogleカレンダーに予定が追加されます。')) return

    try {
      const { error: updateError } = await supabase
        .from('guest_responses')
        .update({
          is_confirmed: true,
          confirmed_slot: slot
        })
        .eq('id', responseId)

      if (updateError) throw updateError

      const response = await fetch('/api/calendar/add-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId,
          bookingDate: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          guestName: guestResponsesMap[scheduleId].find(r => r.id === responseId)?.guest_name,
          guestEmail: guestResponsesMap[scheduleId].find(r => r.id === responseId)?.guest_email,
        })
      })

      if (!response.ok) throw new Error('カレンダーへの追加に失敗しました')

      alert('予定を確定しました！\n両方のカレンダーに追加されました。')
      
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

  const filteredSchedules = selectedFolder
    ? schedules.filter(s => s.folder_id === selectedFolder)
    : selectedFolder === 'uncategorized'
    ? schedules.filter(s => !s.folder_id)
    : schedules

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <h1 className="text-xl font-bold text-gray-900">
                Timerex
              </h1>
              <div className="flex space-x-4">
                <Link
                  href="/dashboard"
                  className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  📅 スケジュール
                </Link>
                <Link
                  href="/teams"
                  className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  👥 チーム管理
                </Link>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">{user?.email}</span>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-6">
            <Link
              href="/schedules/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              + 新しいスケジュール作成
            </Link>
          </div>

          <div className="mb-6 bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">
                📁 フォルダ
              </h3>
              <button
                onClick={() => openFolderModal()}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                + 新規作成
              </button>
            </div>

            <div className="space-y-1">
              <button
                onClick={() => setSelectedFolder(null)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                  selectedFolder === null
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                📋 すべて ({schedules.length})
              </button>

              <button
                onClick={() => setSelectedFolder('uncategorized')}
                className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                  selectedFolder === 'uncategorized'
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                📂 未分類 ({schedules.filter(s => !s.folder_id).length})
              </button>

              {folders.map((folder) => (
                <div key={folder.id} className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedFolder(folder.id)}
                    className={`flex-1 text-left px-3 py-2 rounded-md text-sm ${
                      selectedFolder === folder.id
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    📁 {folder.name} ({schedules.filter(s => s.folder_id === folder.id).length})
                  </button>
                  <button
                    onClick={() => openFolderModal(folder)}
                    className="p-2 text-gray-400 hover:text-gray-600"
                    title="編集"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => deleteFolder(folder.id)}
                    className="p-2 text-gray-400 hover:text-red-600"
                    title="削除"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-6 bg-white shadow rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              📝 クイックゲスト情報入力 (オプション)
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              ゲスト情報を入力してからリンクをコピーすると、専用リンクが生成されます
            </p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
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
              <div className="flex-1">
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
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
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

          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">
                作成したスケジュール
              </h2>
            </div>

            {filteredSchedules.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-gray-500">
                  {selectedFolder ? 'このフォルダにスケジュールがありません。' : 'まだスケジュールがありません。新しいスケジュールを作成してください。'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredSchedules.map((schedule) => (
                  <div key={schedule.id} className="px-6 py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-medium text-gray-900">
                            {schedule.title}
                          </h3>
                          {schedule.is_candidate_mode && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              📋 候補時間モード
                            </span>
                          )}
                          {schedule.is_interview_mode && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              🎤 面接モード
                            </span>
                          )}
                        </div>
                        {schedule.description && (
                          <p className="text-sm text-gray-500 mb-2">
                            {schedule.description}
                          </p>
                        )}
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
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

                        {(schedule.is_candidate_mode || schedule.is_interview_mode) && guestResponsesMap[schedule.id] && guestResponsesMap[schedule.id].length > 0 && (
                          <div className={`mt-3 p-3 rounded-md border ${schedule.is_interview_mode ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200'}`}>
                            <p className={`text-sm font-medium mb-2 ${schedule.is_interview_mode ? 'text-blue-800' : 'text-purple-800'}`}>
                              📬 ゲスト応答 ({guestResponsesMap[schedule.id].length}件)
                            </p>
                            <div className="space-y-2">
                              {guestResponsesMap[schedule.id].map((response) => (
                                <div key={response.id} className={`bg-white p-3 rounded border ${schedule.is_interview_mode ? 'border-blue-200' : 'border-purple-200'}`}>
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
                                      <p className="text-xs text-green-800">
                                        確定時間: {new Date(response.confirmed_slot.date).toLocaleDateString('ja-JP')} {response.confirmed_slot.startTime.slice(0, 5)} - {response.confirmed_slot.endTime.slice(0, 5)}
                                      </p>
                                    </div>
                                  ) : (
                                    <div>
                                      <p className="text-xs text-gray-600 mb-2">希望時間 ({response.selected_slots.length}個):</p>
                                      <div className="grid grid-cols-2 gap-2">
                                        {response.selected_slots.map((slot, idx) => (
                                          <button
                                            key={idx}
                                            onClick={() => confirmGuestResponse(response.id, slot, schedule.id)}
                                            className={`text-left p-2 rounded border text-xs ${schedule.is_interview_mode ? 'bg-blue-50 hover:bg-blue-100 border-blue-200' : 'bg-purple-50 hover:bg-purple-100 border-purple-200'}`}
                                          >
                                            <div className={`font-medium ${schedule.is_interview_mode ? 'text-blue-900' : 'text-purple-900'}`}>
                                              {new Date(slot.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                                            </div>
                                            <div className={schedule.is_interview_mode ? 'text-blue-700' : 'text-purple-700'}>
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
                                    専用リンクコピー
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="ml-4 flex items-center gap-2">
                        {!schedule.is_candidate_mode && !schedule.is_interview_mode && (
                          <button
                            onClick={() => copyOneTimeLink(schedule.share_link)}
                            className="px-3 py-2 border border-yellow-300 bg-yellow-50 rounded-md text-sm font-medium text-yellow-700 hover:bg-yellow-100 whitespace-nowrap"
                          >
                            ワンタイムリンクコピー
                          </button>
                        )}
                        <button
                          onClick={() => copyFixedLink(schedule.share_link, schedule.is_candidate_mode, schedule.is_interview_mode)}
                          className={`px-3 py-2 border rounded-md text-sm font-medium whitespace-nowrap ${
                            schedule.is_interview_mode
                              ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                              : schedule.is_candidate_mode
                              ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100'
                              : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                          }`}
                        >
                          {schedule.is_interview_mode ? '面接リンクコピー' : schedule.is_candidate_mode ? '候補リンクコピー' : '固定リンクコピー'}
                        </button>
                        <button
                          onClick={() => deleteSchedule(schedule.id)}
                          className="px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 whitespace-nowrap"
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

    </div>
  )
}
