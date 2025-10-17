'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'

interface Team {
  id: string
  name: string
  description: string | null
}

type ScheduleMode = 'normal' | 'candidate' | 'interview'

export default function EditSchedulePage() {
  const router = useRouter()
  const params = useParams()
  const scheduleId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [hasBookings, setHasBookings] = useState(false)
  
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
    await loadSchedule(user.id)
  }

  const fetchTeams = async (userId: string) => {
    const { data: ownedTeams } = await supabase
      .from('teams')
      .select('id, name, description')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    const { data: memberTeams } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    if (memberTeams && memberTeams.length > 0) {
      const memberTeamIds = memberTeams.map(m => m.team_id)
      
      const { data: memberTeamsData } = await supabase
        .from('teams')
        .select('id, name, description')
        .in('id', memberTeamIds)
        .order('created_at', { ascending: false })

      const allTeams = [...(ownedTeams || []), ...(memberTeamsData || [])]
      const uniqueTeams = Array.from(new Map(allTeams.map(t => [t.id, t])).values())
      
      setTeams(uniqueTeams)
    } else {
      setTeams(ownedTeams || [])
    }
  }

  const loadSchedule = async (userId: string) => {
    try {
      const { data: schedule, error } = await supabase
        .from('schedules')
        .select('*')
        .eq('id', scheduleId)
        .single()

      if (error) throw error

      if (!schedule) {
        alert('スケジュールが見つかりません')
        router.push('/dashboard')
        return
      }

      // 권한 확인
      if (schedule.user_id && schedule.user_id !== userId) {
        alert('このスケジュールを編集する権限がありません')
        router.push('/dashboard')
        return
      }

      if (schedule.team_id) {
        const { data: membership } = await supabase
          .from('team_members')
          .select('id')
          .eq('team_id', schedule.team_id)
          .eq('user_id', userId)
          .single()

        if (!membership) {
          alert('このスケジュールを編集する権限がありません')
          router.push('/dashboard')
          return
        }
      }

      // 예약 확인
      const { data: bookings } = await supabase
        .from('bookings')
        .select('id')
        .eq('schedule_id', scheduleId)
        .limit(1)

      setHasBookings((bookings && bookings.length > 0) || false)

      // 데이터 로드
      setFormData({
        title: schedule.title,
        description: schedule.description || '',
        dateRangeStart: schedule.date_range_start,
        dateRangeEnd: schedule.date_range_end,
        timeSlotDuration: schedule.time_slot_duration,
      })

      setIsTeamSchedule(!!schedule.team_id)
      setSelectedTeamId(schedule.team_id || '')

      if (schedule.is_interview_mode) {
        setScheduleMode('interview')
        setInterviewTimeSettings({
          startTime: schedule.interview_time_start || '09:00',
          endTime: schedule.interview_time_end || '18:00',
          breakStart: schedule.interview_break_start || '12:00',
          breakEnd: schedule.interview_break_end || '13:00',
        })
        setHasBreakTime(!!(schedule.interview_break_start && schedule.interview_break_end))
      } else if (schedule.is_candidate_mode) {
        setScheduleMode('candidate')
        // 기존 후보 시간 로드
        if (schedule.candidate_slots) {
          setCandidateSlots(schedule.candidate_slots)
        }
      } else {
        setScheduleMode('normal')
      }

      setLoading(false)
    } catch (error) {
      console.error('Error loading schedule:', error)
      alert('スケジュールの読み込みに失敗しました')
      router.push('/dashboard')
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (scheduleMode === 'candidate' && candidateSlots.length === 0) {
      alert('候補時間を最低1つ選択してください')
      return
    }

    if (hasBookings) {
      if (!confirm('既に予約が入っています。\n変更すると予約に影響する可能性があります。\n続けますか？')) {
        return
      }
    }
    
    setSaving(true)

    try {
      const updateData: any = {
        title: formData.title,
        description: formData.description,
        time_slot_duration: formData.timeSlotDuration,
      }

      // 예약이 없으면 날짜도 변경 가능
      if (!hasBookings) {
        updateData.date_range_start = formData.dateRangeStart
        updateData.date_range_end = formData.dateRangeEnd
      }

      // 면접 모드 설정
      if (scheduleMode === 'interview') {
        updateData.is_interview_mode = true
        updateData.is_candidate_mode = false
        updateData.interview_time_start = interviewTimeSettings.startTime
        updateData.interview_time_end = interviewTimeSettings.endTime
        updateData.interview_break_start = hasBreakTime ? interviewTimeSettings.breakStart : null
        updateData.interview_break_end = hasBreakTime ? interviewTimeSettings.breakEnd : null
        updateData.candidate_slots = null
      } else if (scheduleMode === 'candidate') {
        updateData.is_candidate_mode = true
        updateData.is_interview_mode = false
        updateData.interview_time_start = null
        updateData.interview_time_end = null
        updateData.interview_break_start = null
        updateData.interview_break_end = null
        updateData.candidate_slots = candidateSlots
      } else {
        updateData.is_candidate_mode = false
        updateData.is_interview_mode = false
        updateData.interview_time_start = null
        updateData.interview_time_end = null
        updateData.interview_break_start = null
        updateData.interview_break_end = null
        updateData.candidate_slots = null
      }

      const { error } = await supabase
        .from('schedules')
        .update(updateData)
        .eq('id', scheduleId)

      if (error) throw error

      alert('スケジュールを更新しました！')
      router.push('/dashboard')
    } catch (error: any) {
      console.error('Error:', error)
      alert(error.message || 'スケジュールの更新に失敗しました')
    } finally {
      setSaving(false)
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
                予約カレンダー編集
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
          {hasBookings && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-sm text-yellow-800">
                ⚠️ このスケジュールには既に予約が入っています。<br />
                日付範囲の変更はできません。タイトル、説明、予約枠の長さのみ変更可能です。
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 예약 모드 표시 (변경 불가) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                予約モード (変更不可)
              </label>
              <div className="grid grid-cols-3 gap-3">
                <div className={`px-4 py-3 rounded-lg border-2 text-sm font-medium text-center ${
                  scheduleMode === 'normal'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-gray-100 text-gray-400'
                }`}>
                  📅 通常予約
                </div>
                <div className={`px-4 py-3 rounded-lg border-2 text-sm font-medium text-center ${
                  scheduleMode === 'candidate'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-gray-100 text-gray-400'
                }`}>
                  📋 候補日を提示
                </div>
                <div className={`px-4 py-3 rounded-lg border-2 text-sm font-medium text-center ${
                  scheduleMode === 'interview'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-gray-100 text-gray-400'
                }`}>
                  🎤 候補日を受取
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                予約モードは作成後に変更できません
              </p>
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

            {/* 팀 스케줄 표시 (변경 불가) */}
            {isTeamSchedule && (
              <div className="border-t pt-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  担当 (変更不可)
                </label>
                <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
                  <p className="text-sm text-gray-700">
                    👥 チームスケジュール
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    個人/チームの設定は作成後に変更できません
                  </p>
                </div>
              </div>
            )}

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
                  disabled={hasBookings}
                  className={`mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    hasBookings ? 'bg-gray-100 cursor-not-allowed' : ''
                  }`}
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
                  disabled={hasBookings}
                  className={`mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    hasBookings ? 'bg-gray-100 cursor-not-allowed' : ''
                  }`}
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

            {/* 候補日を提示 モード */}
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

            {/* 候補日を受取 モード 설정 */}
            {scheduleMode === 'interview' && (
              <div className="space-y-3 bg-green-50 p-4 rounded-md border border-green-200">
                <p className="text-sm text-green-800">
                  営業時間を設定してください。
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
              </div>
            )}

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
                disabled={saving || loadingSlots}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400"
              >
                {saving ? '更新中...' : '更新'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
