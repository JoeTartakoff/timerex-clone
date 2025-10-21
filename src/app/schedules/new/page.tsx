'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'

interface Team {
  id: string
  name: string
  description: string | null
}

type ScheduleMode = 'normal' | 'candidate' | 'interview'

export default function NewSchedulePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [user, setUser] = useState<any>(null)
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    dateRangeStart: '',
    dateRangeEnd: '',
    timeSlotDuration: 30,
  })

  const [teams, setTeams] = useState<Team[]>([])
  const [isTeamSchedule, setIsTeamSchedule] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('normal')
  
  const [interviewTimeSettings, setInterviewTimeSettings] = useState({
    startTime: '09:00',
    endTime: '18:00',
    breakStart: '12:00',
    breakEnd: '13:00',
  })
  const [hasBreakTime, setHasBreakTime] = useState(true)

  const [candidateSlots, setCandidateSlots] = useState<Array<{
    date: string
    startTime: string
    endTime: string
  }>>([])
  const [availableTimeSlots, setAvailableTimeSlots] = useState<Array<{
    date: string
    startTime: string
    endTime: string
  }>>([])

  const [showGuestSection, setShowGuestSection] = useState(false)
  const [guestPresets, setGuestPresets] = useState<Array<{
    name: string
    email: string
  }>>([])

  useEffect(() => {
    checkUser()
  }, [])

  useEffect(() => {
    if (formData.dateRangeStart && formData.dateRangeEnd && scheduleMode === 'candidate' && user) {
      fetchHostAvailableSlots()
    }
  }, [formData.dateRangeStart, formData.dateRangeEnd, formData.timeSlotDuration, scheduleMode, user])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login')
      return
    }

    setUser(user)
    await fetchTeams(user.id)
  }

  const fetchTeams = async (userId: string) => {
    console.log('🔍 fetchTeams for schedules/new')
    console.log('👤 userId:', userId)

    const { data: ownedTeams, error: ownedError } = await supabase
      .from('teams')
      .select('id, name, description')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    console.log('✅ Owner 팀:', ownedTeams?.length || 0)
    if (ownedError) console.error('❌ Owner 팀 조회 에러:', ownedError)

    const { data: memberTeams, error: memberError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    console.log('✅ Member 팀:', memberTeams?.length || 0)
    if (memberError) console.error('❌ Member 팀 조회 에러:', memberError)

    if (memberTeams && memberTeams.length > 0) {
      const memberTeamIds = memberTeams.map(m => m.team_id)
      console.log('📋 Member 팀 IDs:', memberTeamIds)
      
      const { data: memberTeamsData, error: teamsError } = await supabase
        .from('teams')
        .select('id, name, description')
        .in('id', memberTeamIds)
        .order('created_at', { ascending: false })

      console.log('✅ Member 팀 데이터:', memberTeamsData?.length || 0)
      if (teamsError) console.error('❌ Member 팀 데이터 조회 에러:', teamsError)

      const allTeams = [...(ownedTeams || []), ...(memberTeamsData || [])]
      const uniqueTeams = Array.from(new Map(allTeams.map(t => [t.id, t])).values())
      
      console.log('✅ 최종 팀 수:', uniqueTeams.length)
      console.log('📊 팀 목록:', uniqueTeams.map(t => t.name))
      setTeams(uniqueTeams)
    } else {
      console.log('ℹ️ Member 팀 없음, Owner 팀만 표시')
      setTeams(ownedTeams || [])
    }
  }

  const fetchHostAvailableSlots = async () => {
    if (!user) return

    setLoadingSlots(true)
    try {
      const tempScheduleId = uuidv4()
      
      const { data: tempSchedule, error: tempError } = await supabase
        .from('schedules')
        .insert({
          user_id: user.id,
          title: 'TEMP_FOR_SLOT_CHECK',
          share_link: tempScheduleId,
          date_range_start: formData.dateRangeStart,
          date_range_end: formData.dateRangeEnd,
          time_slot_duration: formData.timeSlotDuration,
          is_one_time_link: true,
          is_used: true,
        })
        .select()
        .single()

      if (tempError) {
        console.error('Failed to create temp schedule:', tempError)
        alert('空き時間の取得に失敗しました')
        return
      }

      const response = await fetch('/api/calendar/get-available-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: tempSchedule.id,
          guestUserId: null,
        })
      })

      await supabase
        .from('schedules')
        .delete()
        .eq('id', tempSchedule.id)

      if (!response.ok) {
        throw new Error('Failed to fetch available slots')
      }

      const data = await response.json()
      
      if (data.success && data.slots) {
        setAvailableTimeSlots(data.slots)
      } else {
        alert('空き時間の取得に失敗しました')
      }
    } catch (error) {
      console.error('Error fetching slots:', error)
      alert('空き時間の取得に失敗しました')
    } finally {
      setLoadingSlots(false)
    }
  }

  const toggleCandidateSlot = (slot: { date: string, startTime: string, endTime: string }) => {
    const exists = candidateSlots.some(
      s => s.date === slot.date && s.startTime === slot.startTime
    )
    
    if (exists) {
      setCandidateSlots(candidateSlots.filter(
        s => !(s.date === slot.date && s.startTime === slot.startTime)
      ))
    } else {
      setCandidateSlots([...candidateSlots, slot])
    }
  }

  const addGuest = () => {
    setGuestPresets([...guestPresets, { name: '', email: '' }])
  }

  const removeGuest = (index: number) => {
    setGuestPresets(guestPresets.filter((_, i) => i !== index))
  }

  const updateGuest = (index: number, field: 'name' | 'email', value: string) => {
    const updated = [...guestPresets]
    updated[index][field] = value
    setGuestPresets(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (scheduleMode === 'candidate' && candidateSlots.length === 0) {
      alert('候補時間を最低1つ選択してください')
      return
    }

    if (isTeamSchedule && !selectedTeamId) {
      alert('チームを選択してください')
      return
    }
    
    setLoading(true)

    try {
      if (!user) {
        throw new Error('ログインが必要です')
      }

      const shareLink = uuidv4()

      const { data: scheduleData, error: scheduleError } = await supabase
        .from('schedules')
        .insert({
          user_id: isTeamSchedule ? null : user.id,
          team_id: isTeamSchedule ? selectedTeamId : null,
          title: formData.title,
          description: formData.description,
          share_link: shareLink,
          date_range_start: formData.dateRangeStart,
          date_range_end: formData.dateRangeEnd,
          time_slot_duration: formData.timeSlotDuration,
          is_one_time_link: false,
          is_used: false,
          is_candidate_mode: scheduleMode === 'candidate',
          candidate_slots: scheduleMode === 'candidate' ? candidateSlots : null,
          is_interview_mode: scheduleMode === 'interview',
          interview_time_start: scheduleMode === 'interview' ? interviewTimeSettings.startTime : null,
          interview_time_end: scheduleMode === 'interview' ? interviewTimeSettings.endTime : null,
          interview_break_start: scheduleMode === 'interview' && hasBreakTime ? interviewTimeSettings.breakStart : null,
          interview_break_end: scheduleMode === 'interview' && hasBreakTime ? interviewTimeSettings.breakEnd : null,
          assignment_method: isTeamSchedule ? 'round_robin' : null,
        })
        .select()
        .single()

      if (scheduleError) throw scheduleError

      if (showGuestSection && guestPresets.length > 0) {
        const validGuests = guestPresets.filter(g => g.name.trim() && g.email.trim())
        
        if (validGuests.length > 0) {
          const response = await fetch('/api/guest-presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scheduleId: scheduleData.id,
              guests: validGuests
            })
          })

          if (response.ok) {
            const result = await response.json()
            console.log('✅ Guest presets saved:', result.guests.length)
          }
        }
      }

      alert(isTeamSchedule ? 'チーム予約カレンダーを作成しました！' : '予約カレンダーを作成しました！')
      router.push('/dashboard')
    } catch (error: any) {
      console.error('Error:', error)
      alert(error.message || 'スケジュールの作成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
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
                新しい予約カレンダー作成
              </h1>
            </div>
            <div className="flex items-center">
              <button
                onClick={() => router.push('/dashboard')}
                className="text-gray-600 hover:text-gray-900"
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                予約モード *
              </label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setScheduleMode('normal')}
                  className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                    scheduleMode === 'normal'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  📅 通常予約
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode('candidate')}
                  className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                    scheduleMode === 'candidate'
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  📋 候補時間を提示
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode('interview')}
                  className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                    scheduleMode === 'interview'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  🎤 候補日を受取
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                スケジュールタイトル *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="例：打ち合わせ予約"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                説明（任意）
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="スケジュールの詳細を入力してください"
              />
            </div>

            <div className="border-t pt-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                担当 *
              </label>
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!isTeamSchedule}
                    onChange={() => {
                      setIsTeamSchedule(false)
                      setSelectedTeamId('')
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">
                    👤 個人（自分だけ）
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={isTeamSchedule}
                    onChange={() => setIsTeamSchedule(true)}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">
                    👥 チーム（複数人で対応）
                  </span>
                </label>

                {isTeamSchedule && (
                  <div className="ml-6 mt-2">
                    {teams.length === 0 ? (
                      <div className="text-sm text-gray-500 bg-yellow-50 p-3 rounded-md border border-yellow-200">
                        所属しているチームがありません。<br />
                        チームスケジュールを作成するには、まず
                        <button
                          type="button"
                          onClick={() => router.push('/teams')}
                          className="text-blue-600 hover:text-blue-700 font-medium mx-1"
                        >
                          チーム管理
                        </button>
                        でチームを作成するか、既存のチームに参加してください。
                      </div>
                    ) : (
                      <select
                        value={selectedTeamId}
                        onChange={(e) => setSelectedTeamId(e.target.value)}
                        required={isTeamSchedule}
                        className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">チームを選択してください</option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {isTeamSchedule && selectedTeamId && (
                <div className="mt-3 p-3 bg-blue-50 rounded-md border border-blue-200">
                  <p className="text-sm text-blue-800">
                    ℹ️ チームスケジュールは Round Robin 方式で自動的にメンバーに割り当てられます
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  開始日 *
                </label>
                <input
                  type="date"
                  required
                  value={formData.dateRangeStart}
                  onChange={(e) => setFormData({ ...formData, dateRangeStart: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  終了日 *
                </label>
                <input
                  type="date"
                  required
                  value={formData.dateRangeEnd}
                  onChange={(e) => setFormData({ ...formData, dateRangeEnd: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                予約枠の長さ
              </label>
              <select
                value={formData.timeSlotDuration}
                onChange={(e) => setFormData({ ...formData, timeSlotDuration: Number(e.target.value) })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={30}>30分</option>
                <option value={60}>1時間</option>
                <option value={90}>1時間30分</option>
                <option value={120}>2時間</option>
                <option value={150}>2時間30分</option>
                <option value={180}>3時間</option>
                <option value={210}>3時間30分</option>
                <option value={240}>4時間</option>
                <option value={270}>4時間30分</option>
                <option value={300}>5時間</option>
                <option value={330}>5時間30分</option>
                <option value={360}>6時間</option>
              </select>
            </div>

            {scheduleMode === 'candidate' && (
              <div className="space-y-3 bg-purple-50 p-4 rounded-md border border-purple-200">
                <p className="text-sm text-purple-800">
                  あなたのGoogleカレンダーと照合して、空いている時間のみ表示されます。<br />
                  候補時間を選択してください。ゲストはこの中から希望時間を選んで返信できます。
                </p>

                {loadingSlots ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-600">カレンダーを確認中...</p>
                  </div>
                ) : availableTimeSlots.length > 0 ? (
                  <div className="space-y-4">
                    {Object.entries(
                      availableTimeSlots.reduce((acc, slot) => {
                        if (!acc[slot.date]) acc[slot.date] = []
                        acc[slot.date].push(slot)
                        return acc
                      }, {} as Record<string, typeof availableTimeSlots>)
                    ).map(([date, slots]) => (
                      <div key={date}>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">
                          {new Date(date).toLocaleDateString('ja-JP', {
                            month: 'long',
                            day: 'numeric',
                            weekday: 'short'
                          })}
                        </h4>
                        <div className="grid grid-cols-4 gap-2">
                          {slots.map((slot, idx) => {
                            const isSelected = candidateSlots.some(
                              s => s.date === slot.date && s.startTime === slot.startTime
                            )
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => toggleCandidateSlot(slot)}
                                className={`py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                                  isSelected
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-purple-50'
                                }`}
                              >
                                {slot.startTime.slice(0, 5)}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">日付を選択すると空き時間が表示されます</p>
                )}

                {candidateSlots.length > 0 && (
                  <div className="mt-3 p-3 bg-purple-100 rounded-md">
                    <p className="text-sm font-medium text-purple-900">
                      選択済み: {candidateSlots.length}個の候補時間
                    </p>
                  </div>
                )}
              </div>
            )}

            {scheduleMode === 'interview' && (
              <div className="space-y-3 bg-orange-50 p-4 rounded-md border border-orange-200">
                <p className="text-sm text-orange-800">
                  営業時間を設定してください。ゲストはこの時間範囲内で自由に候補時間を提案できます。<br />
                  ホストのカレンダー情報はゲストに表示されません。
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      営業開始時間
                    </label>
                    <input
                      type="time"
                      value={interviewTimeSettings.startTime}
                      onChange={(e) => setInterviewTimeSettings({ ...interviewTimeSettings, startTime: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      営業終了時間
                    </label>
                    <input
                      type="time"
                      value={interviewTimeSettings.endTime}
                      onChange={(e) => setInterviewTimeSettings({ ...interviewTimeSettings, endTime: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="hasBreakTime"
                    checked={hasBreakTime}
                    onChange={(e) => setHasBreakTime(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="hasBreakTime" className="text-sm font-medium text-gray-700 cursor-pointer">
                    休憩時間を設定する
                  </label>
                </div>

                {hasBreakTime && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        休憩開始時間
                      </label>
                      <input
                        type="time"
                        value={interviewTimeSettings.breakStart}
                        onChange={(e) => setInterviewTimeSettings({ ...interviewTimeSettings, breakStart: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        休憩終了時間
                      </label>
                      <input
                        type="time"
                        value={interviewTimeSettings.breakEnd}
                        onChange={(e) => setInterviewTimeSettings({ ...interviewTimeSettings, breakEnd: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-3 p-3 bg-orange-100 rounded-md">
                  <p className="text-sm font-medium text-orange-900">
                    設定時間: {interviewTimeSettings.startTime} - {interviewTimeSettings.endTime}
                    {hasBreakTime && ` （休憩: ${interviewTimeSettings.breakStart} - ${interviewTimeSettings.breakEnd}）`}
                  </p>
                </div>
              </div>
            )}

            <div className="border-t pt-6">
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showGuestSection}
                    onChange={(e) => setShowGuestSection(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    ゲスト情報を事前登録（オプション）
                  </span>
                </label>
              </div>

              {showGuestSection && (
                <div className="space-y-3 bg-gray-50 p-4 rounded-md">
                  <p className="text-sm text-gray-600">
                    ゲストの名前とメールアドレスを登録すると、パーソナライズドリンクが生成されます。<br />
                    ゲストはリンクにアクセスするだけで情報が自動入力されます。
                  </p>

                  {guestPresets.map((guest, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="名前"
                        value={guest.name}
                        onChange={(e) => updateGuest(index, 'name', e.target.value)}
                        className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                      <input
                        type="email"
                        placeholder="メールアドレス"
                        value={guest.email}
                        onChange={(e) => updateGuest(index, 'email', e.target.value)}
                        className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeGuest(index)}
                        className="px-3 py-2 bg-red-100 text-red-600 rounded-md text-sm font-medium hover:bg-red-200"
                      >
                        削除
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addGuest}
                    className="w-full py-2 border-2 border-dashed border-gray-300 rounded-md text-sm text-gray-600 hover:bg-white hover:border-blue-400 hover:text-blue-600"
                  >
                    + ゲストを追加
                  </button>
                </div>
              )}
            </div>

            <div className="bg-blue-50 p-4 rounded-md">
              <p className="text-sm text-blue-800">
                <strong>設定内容：</strong>
              </p>
              <ul className="mt-2 text-sm text-blue-700 list-disc list-inside">
                <li>営業時間: 9:00 - 18:00</li>
                <li>休憩時間: 12:00 - 13:00</li>
                <li>Googleカレンダーの予定と重複しない時間のみ予約可能</li>
                <li>予約時にリアルタイムでカレンダーを確認します</li>
              </ul>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading || loadingSlots || (isTeamSchedule && !selectedTeamId)}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? '作成中...' : '予約カレンダー作成'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
