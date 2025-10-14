'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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
  is_candidate_mode: boolean  // ⭐ 추가
  candidate_slots: Array<{    // ⭐ 추가
    date: string
    startTime: string
    endTime: string
  }> | null
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
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [guestPresetsMap, setGuestPresetsMap] = useState<Record<string, GuestPreset[]>>({})
  const [guestResponsesMap, setGuestResponsesMap] = useState<Record<string, GuestResponse[]>>({})
  const [quickGuestInfo, setQuickGuestInfo] = useState({
    name: '',
    email: ''
  })
  const router = useRouter()

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
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_one_time_link', false)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching schedules:', error)
      return
    }

    setSchedules(data || [])

    // ⭐ 각 스케줄의 게스트 프리셋 가져오기
    if (data && data.length > 0) {
      const presetsMap: Record<string, GuestPreset[]> = {}
      const responsesMap: Record<string, GuestResponse[]> = {}
      
      for (const schedule of data) {
        // 게스트 프리셋 가져오기
        const { data: presets } = await supabase
          .from('guest_presets')
          .select('*')
          .eq('schedule_id', schedule.id)
          .order('created_at', { ascending: true })
        
        if (presets && presets.length > 0) {
          presetsMap[schedule.id] = presets
        }

        // ⭐ 후보 모드인 경우 게스트 응답 가져오기
        if (schedule.is_candidate_mode) {
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
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const copyOneTimeLink = (shareLink: string) => {
    const oneTimeToken = crypto.randomUUID()
    let url = `${window.location.origin}/book/${shareLink}`
    
    // ⭐ 게스트 정보가 있으면 경로에 추가
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

const copyFixedLink = (shareLink: string, isCandidateMode: boolean) => {
  let url
  
  // ⭐ 후보 모드면 /candidate/ 경로 사용
  if (isCandidateMode) {
    url = `${window.location.origin}/candidate/${shareLink}`
    
    // ⭐ 후보 모드에서도 게스트 정보가 있으면 쿼리 파라미터로 추가
    if (quickGuestInfo.name && quickGuestInfo.email) {
      const encodedName = encodeURIComponent(quickGuestInfo.name)
      const encodedEmail = encodeURIComponent(quickGuestInfo.email)
      url = `${window.location.origin}/candidate/${shareLink}?name=${encodedName}&email=${encodedEmail}`
    }
  } else {
    url = `${window.location.origin}/book/${shareLink}`
    
    // 게스트 정보가 있으면 경로에 추가
    if (quickGuestInfo.name && quickGuestInfo.email) {
      const encodedName = encodeURIComponent(quickGuestInfo.name)
      const encodedEmail = encodeURIComponent(quickGuestInfo.email)
      url = `${window.location.origin}/book/${shareLink}/${encodedName}/${encodedEmail}`
    }
  }
  
  navigator.clipboard.writeText(url)
  
  if (isCandidateMode && quickGuestInfo.name && quickGuestInfo.email) {
    alert(`${quickGuestInfo.name}様専用候補リンクをコピーしました！\nゲストは複数の候補から選択できます。`)
  } else if (isCandidateMode) {
    alert('候補時間モードのリンクをコピーしました！\nゲストは複数の候補から選択できます。')
  } else if (quickGuestInfo.name && quickGuestInfo.email) {
    alert(`${quickGuestInfo.name}様専用リンクをコピーしました！\n何度でも予約可能なリンクです。`)
  } else {
    alert('固定リンクをコピーしました！\n何度でも予約可能なリンクです。')
  }
}

  // ⭐ 개인화 링크 복사
  const copyPersonalizedLink = (shareLink: string, guestToken: string, guestName: string) => {
    const url = `${window.location.origin}/book/${shareLink}?guest=${guestToken}`
    navigator.clipboard.writeText(url)
    alert(`${guestName}様専用リンクをコピーしました！\n情報が自動入力されます。`)
  }

  // ⭐ 게스트 응답 확정
  const confirmGuestResponse = async (responseId: string, slot: { date: string, startTime: string, endTime: string }, scheduleId: string) => {
    if (!confirm('この時間で確定しますか？\n両方のGoogleカレンダーに予定が追加されます。')) return

    try {
      // 1. guest_responses 테이블 업데이트
      const { error: updateError } = await supabase
        .from('guest_responses')
        .update({
          is_confirmed: true,
          confirmed_slot: slot
        })
        .eq('id', responseId)

      if (updateError) throw updateError

      // 2. 캘린더 이벤트 추가 API 호출
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
      
      // 새로고침
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">
                スケジュール管理
              </h1>
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

            {schedules.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-gray-500">
                  まだスケジュールがありません。新しいスケジュールを作成してください。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {schedules.map((schedule) => (
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

                        {/* ⭐ 게스트 응답 표시 (후보 모드) */}
                        {schedule.is_candidate_mode && guestResponsesMap[schedule.id] && guestResponsesMap[schedule.id].length > 0 && (
                          <div className="mt-3 p-3 bg-purple-50 rounded-md border border-purple-200">
                            <p className="text-sm font-medium text-purple-800 mb-2">
                              📬 ゲスト応答 ({guestResponsesMap[schedule.id].length}件)
                            </p>
                            <div className="space-y-2">
                              {guestResponsesMap[schedule.id].map((response) => (
                                <div key={response.id} className="bg-white p-3 rounded border border-purple-200">
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
                                            className="text-left p-2 bg-purple-50 hover:bg-purple-100 rounded border border-purple-200 text-xs"
                                          >
                                            <div className="font-medium text-purple-900">
                                              {new Date(slot.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                                            </div>
<div className="text-purple-700">
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

                        {/* ⭐ 게스트 프리셋 표시 */}
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
                        {!schedule.is_candidate_mode && (
                          <button
                            onClick={() => copyOneTimeLink(schedule.share_link)}
                            className="px-3 py-2 border border-yellow-300 bg-yellow-50 rounded-md text-sm font-medium text-yellow-700 hover:bg-yellow-100 whitespace-nowrap"
                          >
                            ワンタイムリンクコピー
                          </button>
                        )}
                        <button
                          onClick={() => copyFixedLink(schedule.share_link, schedule.is_candidate_mode)}
                          className={`px-3 py-2 border rounded-md text-sm font-medium whitespace-nowrap ${
                            schedule.is_candidate_mode
                              ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100'
                              : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                          }`}
                        >
                          {schedule.is_candidate_mode ? '候補リンクコピー' : '固定リンクコピー'}
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
    </div>
  )
}
