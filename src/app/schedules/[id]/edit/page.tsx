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

// ⭐ 주간 날짜 계산 함수
function getWeekDates(baseDate: Date): Date[] {
  const dates: Date[] = []
  const day = baseDate.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(baseDate)
  monday.setDate(baseDate.getDate() + diff)
  
  for (let i = 0; i < 6; i++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    dates.push(date)
  }
  
  return dates
}

// ⭐ 날짜가 범위 내에 있는지 확인
function isDateInRange(date: Date, start: string, end: string): boolean {
  const dateStr = date.toISOString().split('T')[0]
  return dateStr >= start && dateStr <= end
}

// ⭐ 주의 시작일이 범위 내에 있는지 확인
function isWeekInRange(weekStart: Date, rangeStart: string, rangeEnd: string): boolean {
  const weekDates = getWeekDates(weekStart)
  return weekDates.some(date => isDateInRange(date, rangeStart, rangeEnd))
}

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

  // ⭐ 기간 설정 관련 상태
  const [hasDateRange, setHasDateRange] = useState<boolean>(true)
  const [quickPeriod, setQuickPeriod] = useState<number>(0)

  // ⭐ 주간 뷰 상태 (후보시간제시모드용)
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(new Date())
  const [weekDates, setWeekDates] = useState<Date[]>([])

  useEffect(() => {
    checkUser()
  }, [])

  // ⭐ 주간 날짜 업데이트
  useEffect(() => {
    setWeekDates(getWeekDates(currentWeekStart))
  }, [currentWeekStart])

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
        
        // ⭐ 스케줄 기간의 첫 주로 초기화
        const startDate = new Date(formData.dateRangeStart)
        setCurrentWeekStart(startDate)
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

  // ⭐ 빠른 기간 설정 함수
  const quickPeriodOptions = [
    { label: '2週間', days: 14 },
    { label: '1ヶ月', days: 30 },
    { label: '3ヶ月', days: 90 },
    { label: '6ヶ月', days: 180 },
  ]

  const setQuickDateRange = (days: number) => {
    const today = new Date()
    const endDate = new Date(today)
    endDate.setDate(today.getDate() + days)
    
    setFormData({
      ...formData,
      dateRangeStart: today.toISOString().split('T')[0],
      dateRangeEnd: endDate.toISOString().split('T')[0],
    })
    setQuickPeriod(days)
  }

  // ⭐ 무기한 설정 함수
  const setUnlimitedRange = () => {
    const today = new Date()
    const oneYearLater = new Date(today)
    oneYearLater.setFullYear(today.getFullYear() + 1)
    
    setFormData({
      ...formData,
      dateRangeStart: today.toISOString().split('T')[0],
      dateRangeEnd: oneYearLater.toISOString().split('T')[0],
    })
    setQuickPeriod(0)
  }

  // ⭐ 이전 주로 이동
  const goToPrevWeek = () => {
    if (!formData.dateRangeStart || !formData.dateRangeEnd) return
    
    const prevWeek = new Date(currentWeekStart)
    prevWeek.setDate(currentWeekStart.getDate() - 7)
    
    if (isWeekInRange(prevWeek, formData.dateRangeStart, formData.dateRangeEnd)) {
      setCurrentWeekStart(prevWeek)
    }
  }

  // ⭐ 다음 주로 이동
  const goToNextWeek = () => {
    if (!formData.dateRangeStart || !formData.dateRangeEnd) return
    
    const nextWeek = new Date(currentWeekStart)
    nextWeek.setDate(currentWeekStart.getDate() + 7)
    
    if (isWeekInRange(nextWeek, formData.dateRangeStart, formData.dateRangeEnd)) {
      setCurrentWeekStart(nextWeek)
    }
  }

  // ⭐ 이전/다음 주 버튼 활성화 여부
  const canGoPrev = formData.dateRangeStart && formData.dateRangeEnd ? isWeekInRange(
    new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
    formData.dateRangeStart,
    formData.dateRangeEnd
  ) : false

  const canGoNext = formData.dateRangeStart && formData.dateRangeEnd ? isWeekInRange(
    new Date(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    formData.dateRangeStart,
    formData.dateRangeEnd
  ) : false

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

      if (!hasBookings) {
        updateData.date_range_start = formData.dateRangeStart
        updateData.date_range_end = formData.dateRangeEnd
      }

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

  // ⭐ 주간별 슬롯 그룹화
  const slotsByDateAndTime = availableTimeSlots.reduce((acc, slot) => {
    if (!acc[slot.date]) {
      acc[slot.date] = {}
    }
    const timeKey = `${slot.startTime}-${slot.endTime}`
    if (!acc[slot.date][timeKey]) {
      acc[slot.date][timeKey] = []
    }
    acc[slot.date][timeKey].push(slot)
    return acc
  }, {} as Record<string, Record<string, typeof availableTimeSlots>>)

  // ⭐ 모든 시간대 추출 (정렬)
  const allTimeSlots = Array.from(
    new Set(
      availableTimeSlots.map(slot => `${slot.startTime}-${slot.endTime}`)
    )
  ).sort()

  // ⭐ 현재 주의 날짜만 필터링
  const currentWeekDates = weekDates.filter(date => 
    isDateInRange(date, formData.dateRangeStart, formData.dateRangeEnd)
  )

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
                  📋 候補時間を提示
                </div>
                <div className={`px-4 py-3 rounded-lg border-2 text-sm font-medium text-center ${
                  scheduleMode === 'interview'
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
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

            {/* ⭐ 개선된 날짜 선택 UI (예약 없을 때만) */}
            {!hasBookings ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  予約期間 *
                </label>
                
                {/* 라디오 버튼 */}
                <div className="space-y-3 mb-4">
                  <label className={`flex items-center gap-2 ${scheduleMode === 'candidate' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <input
                      type="radio"
                      checked={!hasDateRange}
                      onChange={() => {
                        if (scheduleMode !== 'candidate') {
                          setHasDateRange(false)
                          setUnlimitedRange()
                        }
                      }}
                      disabled={scheduleMode === 'candidate'}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-gray-700">
                      期間を指定しない（無期限）
                      {scheduleMode === 'candidate' && (
                        <span className="ml-2 text-xs text-purple-600">
                          ※ 候補時間提示モードでは使用できません
                        </span>
                      )}
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={hasDateRange}
                      onChange={() => {
                        setHasDateRange(true)
                      }}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">
                      期間を指定する
                    </span>
                  </label>
                </div>

                {/* 기간 지정 시에만 표시 */}
                {hasDateRange && (
                  <>
                    {/* 빠른 선택 버튼 */}
                    <div className="mb-4 ml-6">
                      <p className="text-xs text-gray-600 mb-2">📅 クイック設定:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {quickPeriodOptions.map((option) => (
                          <button
                            key={option.days}
                            type="button"
                            onClick={() => setQuickDateRange(option.days)}
                            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors border ${
                              quickPeriod === option.days
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 수동 날짜 선택 */}
                    <div className="ml-6">
                      <p className="text-xs text-gray-600 mb-2">または、手動で設定:</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            開始日
                          </label>
                          <input
                            type="date"
                            required
                            value={formData.dateRangeStart}
                            onChange={(e) => {
                              setFormData({ ...formData, dateRangeStart: e.target.value })
                              setQuickPeriod(0)
                            }}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            終了日
                          </label>
                          <input
                            type="date"
                            required
                            value={formData.dateRangeEnd}
                            onChange={(e) => {
                              setFormData({ ...formData, dateRangeEnd: e.target.value })
                              setQuickPeriod(0)
                            }}
                            min={formData.dateRangeStart || new Date().toISOString().split('T')[0]}
                            className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* 무기한 선택 시 안내 메시지 */}
                {!hasDateRange && scheduleMode !== 'candidate' && (
                  <div className="ml-6 p-3 bg-blue-50 rounded-md border border-blue-200">
                    <p className="text-xs text-blue-800">
                      ℹ️ 無期限モードでは、1年間の予約枠が自動的に作成されます。<br />
                      いつでも編集ページで期間を変更できます。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* 예약 있을 때는 기존 UI (변경 불가) */
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    開始日 *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.dateRangeStart}
                    disabled={true}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 bg-gray-100 cursor-not-allowed"
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
                    disabled={true}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 bg-gray-100 cursor-not-allowed"
                  />
                </div>
              </div>
            )}

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
                  <>
                    {/* ⭐ 주간 캘린더 네비게이션 */}
                    <div className="flex items-center justify-between mb-4">
                      <button
                        type="button"
                        onClick={goToPrevWeek}
                        disabled={!canGoPrev}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ← Prev
                      </button>
                      
                      <h3 className="text-sm font-medium text-gray-900">
                        {currentWeekStart.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
                      </h3>
                      
                      <button
                        type="button"
                        onClick={goToNextWeek}
                        disabled={!canGoNext}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next →
                      </button>
                    </div>

                    {/* ⭐ 주간 캘린더 테이블 */}
                    {currentWeekDates.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-sm text-gray-500">この週には予約可能な日がありません</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr>
                              <th className="border border-gray-200 bg-gray-50 p-2 text-xs font-medium text-gray-500 w-20">
                                時間
                              </th>
                              {currentWeekDates.map((date, idx) => (
                                <th key={idx} className="border border-gray-200 bg-gray-50 p-2 text-sm font-medium text-gray-900">
                                  <div>
                                    {date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {date.toLocaleDateString('ja-JP', { weekday: 'short' })}
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {allTimeSlots.map((timeSlot) => {
                              const [startTime, endTime] = timeSlot.split('-')
                              
                              return (
                                <tr key={timeSlot}>
                                  <td className="border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600 text-center align-top">
                                    {startTime.slice(0, 5)}
                                  </td>
                                  {currentWeekDates.map((date, idx) => {
                                    const dateStr = date.toISOString().split('T')[0]
                                    const slots = slotsByDateAndTime[dateStr]?.[timeSlot] || []
                                    const slot = slots[0]
                                    const isSelected = slot && candidateSlots.some(
                                      s => s.date === slot.date && s.startTime === slot.startTime
                                    )

                                    return (
                                      <td key={idx} className="border border-gray-200 p-1">
                                        {slot ? (
                                          <button
                                            type="button"
                                            onClick={() => toggleCandidateSlot(slot)}
                                            className={`w-full h-16 rounded text-xs font-medium transition-colors border ${
                                              isSelected
                                                ? 'bg-purple-600 text-white border-purple-600'
                                                : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'
                                            }`}
                                          >
                                            {startTime.slice(0, 5)} - {endTime.slice(0, 5)}
                                          </button>
                                        ) : (
                                          <div className="w-full h-16 bg-gray-100"></div>
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
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
