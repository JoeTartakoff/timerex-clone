'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { nanoid } from 'nanoid'

interface Schedule {
  id: string
  title: string
  description: string
  date_range_start: string
  date_range_end: string
  candidate_slots: Array<{
    date: string
    startTime: string
    endTime: string
  }>
}

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

function isDateInRange(date: Date, start: string, end: string): boolean {
  const dateStr = date.toISOString().split('T')[0]
  return dateStr >= start && dateStr <= end
}

function isWeekInRange(weekStart: Date, rangeStart: string, rangeEnd: string): boolean {
  const weekDates = getWeekDates(weekStart)
  return weekDates.some(date => isDateInRange(date, rangeStart, rangeEnd))
}

export default function CandidatePage() {
  const params = useParams()
  const shareLink = params.shareLink as string

  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [selectedSlots, setSelectedSlots] = useState<Array<{
    date: string
    startTime: string
    endTime: string
  }>>([])
  const [guestInfo, setGuestInfo] = useState({
    name: '',
    email: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [responseLink, setResponseLink] = useState<string | null>(null)

  // ⭐ 주간 뷰 상태
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(new Date())
  const [weekDates, setWeekDates] = useState<Date[]>([])

  const initRef = useRef(false)

  useEffect(() => {
    setWeekDates(getWeekDates(currentWeekStart))
  }, [currentWeekStart])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    loadSchedule()

    const urlParams = new URLSearchParams(window.location.search)
    const nameParam = urlParams.get('name')
    const emailParam = urlParams.get('email')
    
    if (nameParam && emailParam) {
      setGuestInfo({
        name: decodeURIComponent(nameParam),
        email: decodeURIComponent(emailParam),
      })
    }
  }, [shareLink])

  const loadSchedule = async () => {
    try {
      const { data, error } = await supabase
        .from('schedules')
        .select('*')
        .eq('share_link', shareLink)
        .eq('is_candidate_mode', true)
        .single()

      if (error) throw error

      setSchedule(data)

      // ⭐ 개선: 항상 오늘이 포함된 주로 초기화
      const today = new Date()
      setCurrentWeekStart(today)
    } catch (error) {
      console.error('Error loading schedule:', error)
      alert('スケジュールの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const toggleSlot = (slot: { date: string, startTime: string, endTime: string }) => {
    const exists = selectedSlots.some(
      s => s.date === slot.date && s.startTime === slot.startTime
    )

    if (exists) {
      setSelectedSlots(selectedSlots.filter(
        s => !(s.date === slot.date && s.startTime === slot.startTime)
      ))
    } else {
      setSelectedSlots([...selectedSlots, slot])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!schedule || selectedSlots.length === 0) return

    setSubmitting(true)

    try {
      const shareToken = nanoid(10)

      const { error } = await supabase
        .from('guest_responses')
        .insert({
          schedule_id: schedule.id,
          guest_name: guestInfo.name,
          guest_email: guestInfo.email,
          selected_slots: selectedSlots,
          share_token: shareToken,
          is_confirmed: false,
        })

      if (error) throw error

      const link = `${window.location.origin}/response/${shareToken}`
      setResponseLink(link)

      alert('候補時間を送信しました！\nリンクをホストに共有してください。')
    } catch (error) {
      console.error('Error submitting response:', error)
      alert('送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const copyResponseLink = () => {
    if (responseLink) {
      navigator.clipboard.writeText(responseLink)
      alert('リンクをコピーしました！')
    }
  }

  const goToPrevWeek = () => {
    if (!schedule) return
    
    const prevWeek = new Date(currentWeekStart)
    prevWeek.setDate(currentWeekStart.getDate() - 7)
    
    if (isWeekInRange(prevWeek, schedule.date_range_start, schedule.date_range_end)) {
      setCurrentWeekStart(prevWeek)
    }
  }

  const goToNextWeek = () => {
    if (!schedule) return
    
    const nextWeek = new Date(currentWeekStart)
    nextWeek.setDate(currentWeekStart.getDate() + 7)
    
    if (isWeekInRange(nextWeek, schedule.date_range_start, schedule.date_range_end)) {
      setCurrentWeekStart(nextWeek)
    }
  }

  // ⭐ 오늘로 이동
  const goToToday = () => {
    setCurrentWeekStart(new Date())
  }

  const canGoPrev = schedule ? isWeekInRange(
    new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
    schedule.date_range_start,
    schedule.date_range_end
  ) : false

  const canGoNext = schedule ? isWeekInRange(
    new Date(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    schedule.date_range_start,
    schedule.date_range_end
  ) : false

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  if (!schedule) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            スケジュールが見つかりません
          </h2>
        </div>
      </div>
    )
  }

  if (responseLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <svg className="h-10 w-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              送信完了！
            </h2>
            <p className="text-gray-600 mb-4">
              以下のリンクをホストに共有してください
            </p>
            <div className="bg-gray-50 p-3 rounded-md mb-4">
              <p className="text-sm text-gray-800 break-all">{responseLink}</p>
            </div>
            <button
              onClick={copyResponseLink}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md"
            >
              リンクをコピー
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ⭐ 주간별 슬롯 그룹화
  const slotsByDateAndTime = schedule.candidate_slots.reduce((acc, slot) => {
    if (!acc[slot.date]) {
      acc[slot.date] = {}
    }
    const timeKey = `${slot.startTime}-${slot.endTime}`
    if (!acc[slot.date][timeKey]) {
      acc[slot.date][timeKey] = []
    }
    acc[slot.date][timeKey].push(slot)
    return acc
  }, {} as Record<string, Record<string, typeof schedule.candidate_slots>>)

  // ⭐ 모든 시간대 추출
  const allTimeSlots = Array.from(
    new Set(
      schedule.candidate_slots.map(slot => `${slot.startTime}-${slot.endTime}`)
    )
  ).sort()

  // ⭐ 현재 주의 날짜만 필터링
  const currentWeekDates = weekDates.filter(date => 
    isDateInRange(date, schedule.date_range_start, schedule.date_range_end)
  )

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* ⭐ 1. 헤더 박스 */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {schedule.title}
              </h1>
              {schedule.description && (
                <p className="text-gray-600">{schedule.description}</p>
              )}
              <div className="mt-4">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                  📋 候補時間を提示
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ⭐ 2. 예약 정보 박스 */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            予約情報
          </h2>

          {selectedSlots.length > 0 ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-purple-50 p-4 rounded-md mb-4">
                <p className="text-sm font-medium text-purple-900">
                  選択した時間: {selectedSlots.length}個
                </p>
                <div className="mt-2 space-y-1">
                  {selectedSlots.slice(0, 3).map((slot, idx) => (
                    <p key={idx} className="text-xs text-purple-700">
                      {new Date(slot.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })} {slot.startTime.slice(0, 5)} - {slot.endTime.slice(0, 5)}
                    </p>
                  ))}
                  {selectedSlots.length > 3 && (
                    <p className="text-xs text-purple-600">
                      他 {selectedSlots.length - 3}個
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  お名前 *
                </label>
                <input
                  type="text"
                  required
                  value={guestInfo.name}
                  onChange={(e) => setGuestInfo({ ...guestInfo, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  メールアドレス *
                </label>
                <input
                  type="email"
                  required
                  value={guestInfo.email}
                  onChange={(e) => setGuestInfo({ ...guestInfo, email: e.target.value })}
                  className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-4 rounded-md disabled:bg-gray-400"
              >
                {submitting ? '送信中...' : '候補時間を送信'}
              </button>
            </form>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">
                下のカレンダーから希望する時間を選択してください（複数選択可）
              </p>
            </div>
          )}
        </div>

        {/* ⭐ 3. 주간 캘린더 */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={goToPrevWeek}
              disabled={!canGoPrev}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            
            <div className="flex items-center gap-3">
              <button
                onClick={goToToday}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium transition-colors"
              >
                今日
              </button>
              
              <h2 className="text-lg font-medium text-gray-900">
                {currentWeekStart.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
              </h2>
            </div>
            
            <button
              onClick={goToNextWeek}
              disabled={!canGoNext}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>

          {currentWeekDates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">この週には予約可能な日がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border border-gray-200 bg-gray-50 p-2 text-xs font-medium text-gray-500 w-20">
                      時間
                    </th>
                    {currentWeekDates.map((date, idx) => {
                      // ⭐ 오늘 날짜 확인
                      const today = new Date()
                      const isToday = date.toISOString().split('T')[0] === today.toISOString().split('T')[0]
                      
                      return (
                        <th key={idx} className="border border-gray-200 bg-gray-50 p-2 text-sm font-medium text-gray-900">
                          <div>
                            {date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                            {date.toLocaleDateString('ja-JP', { weekday: 'short' })}
                            {/* ⭐ 오늘이면 빨간 점 표시 */}
                            {isToday && <span className="text-red-500 text-lg leading-none">●</span>}
                          </div>
                        </th>
                      )
                    })}
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
                          const isSelected = slot && selectedSlots.some(
                            s => s.date === slot.date && s.startTime === slot.startTime
                          )

                          return (
                            <td key={idx} className="border border-gray-200 p-1">
                              {slot ? (
                                <button
                                  onClick={() => toggleSlot(slot)}
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
        </div>
      </div>
    </div>
  )
}
