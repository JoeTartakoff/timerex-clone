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
  time_slot_duration: number
  interview_time_start: string
  interview_time_end: string
  interview_break_start: string
  interview_break_end: string
}

interface TimeBlock {
  id: string
  date: string
  startTime: string
  endTime: string
}

function getThreeDayDates(center: Date): Date[] {
  const dates: Date[] = []
  for (let i = 0; i <= 2; i++) {
    const date = new Date(center)
    date.setDate(center.getDate() + i)
    dates.push(date)
  }
  return dates
}

function isDateInRange(date: Date, start: string, end: string): boolean {
  const dateStr = date.toISOString().split('T')[0]
  return dateStr >= start && dateStr <= end
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function snapToHalfHour(minutes: number): number {
  return Math.round(minutes / 30) * 30
}

function timeToPixelPosition(time: string): number {
  const minutes = timeToMinutes(time)
  const baseMinutes = 9 * 60
  const relativeMinutes = minutes - baseMinutes
  return (relativeMinutes / 60) * 96
}

export default function InterviewPage() {
  const params = useParams()
  const shareLink = params.shareLink as string

  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [selectedBlocks, setSelectedBlocks] = useState<TimeBlock[]>([])
  const [showPopup, setShowPopup] = useState(false)
  const [guestInfo, setGuestInfo] = useState({
    name: '',
    email: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [responseLink, setResponseLink] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<Date>(new Date())
  const [draggingBlockIndex, setDraggingBlockIndex] = useState<number | null>(null)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragInitialTop, setDragInitialTop] = useState(0)
  const [isPrefilledGuest, setIsPrefilledGuest] = useState(false)

  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    loadSchedule()

    const urlParams = new URLSearchParams(window.location.search)
    const nameParam = urlParams.get('name')
    const emailParam = urlParams.get('email')
    
    if (nameParam && emailParam) {
      console.log('👤 Guest info from URL:', nameParam, emailParam)
      setGuestInfo({
        name: decodeURIComponent(nameParam),
        email: decodeURIComponent(emailParam),
      })
      setIsPrefilledGuest(true)
    }
  }, [shareLink])

  // ⭐ 예약 가능한 최단 날짜로 자동 이동
  const checkAndMoveToFirstAvailableDate = (scheduleData: Schedule) => {
    if (!scheduleData) return
    
    // 스케줄 시작 날짜로 이동
    const firstDate = new Date(scheduleData.date_range_start)
    
    const dateStr = firstDate.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    })
    
    console.log(`📅 First available date: ${dateStr}`)
    setStartDate(firstDate)
  }

  const loadSchedule = async () => {
    try {
      console.log('📋 Loading schedule info...')
      
      const { data, error } = await supabase
        .from('schedules')
        .select('*')
        .eq('share_link', shareLink)
        .eq('is_interview_mode', true)
        .single()

      if (error) throw error

      console.log('✅ Schedule loaded:', data.title)
      setSchedule(data)
      setLoading(false)

      // ⭐ 스케줄 시작 날짜로 자동 이동
      checkAndMoveToFirstAvailableDate(data)
    } catch (error) {
      console.error('Error loading schedule:', error)
      alert('スケジュールの読み込みに失敗しました')
      setLoading(false)
    }
  }

  const isHalfHourInBusinessHours = (startTime: string): boolean => {
    if (!schedule) return false
    
    const startMinutes = timeToMinutes(startTime)
    const endMinutes = startMinutes + 30
    
    const businessStart = timeToMinutes(schedule.interview_time_start)
    const businessEnd = timeToMinutes(schedule.interview_time_end)
    
    if (startMinutes < businessStart || endMinutes > businessEnd) {
      return false
    }
    
    if (schedule.interview_break_start && schedule.interview_break_end) {
      const breakStart = timeToMinutes(schedule.interview_break_start)
      const breakEnd = timeToMinutes(schedule.interview_break_end)
      
      if (startMinutes >= breakStart && startMinutes < breakEnd) {
        return false
      }
    }
    
    return true
  }

  const isTimeSlotInBusinessHours = (startTime: string, endTime: string): boolean => {
    if (!schedule) return false
    
    const startMinutes = timeToMinutes(startTime)
    const endMinutes = timeToMinutes(endTime)
    
    for (let time = startMinutes; time < endMinutes; time += 30) {
      const currentTime = minutesToTime(time)
      if (!isHalfHourInBusinessHours(currentTime)) {
        return false
      }
    }
    
    return true
  }

  const handleCellClick = (date: string, hour: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!schedule || draggingBlockIndex !== null) return
    
    const rect = e.currentTarget.getBoundingClientRect()
    const clickY = e.clientY - rect.top
    const cellHeight = rect.height
    
    const minute = clickY < cellHeight / 2 ? 0 : 30
    
    const startMinutes = hour * 60 + minute
    const startTime = minutesToTime(startMinutes)
    const endMinutes = startMinutes + schedule.time_slot_duration
    const endTime = minutesToTime(endMinutes)
    
    if (!isTimeSlotInBusinessHours(startTime, endTime)) {
      alert('この時間帯は選択できません')
      return
    }
    
    const existingIndex = selectedBlocks.findIndex(
      b => b.date === date && b.startTime === startTime
    )
    
    if (existingIndex >= 0) {
      setSelectedBlocks(selectedBlocks.filter((_, i) => i !== existingIndex))
    } else {
      const newBlock: TimeBlock = {
        id: nanoid(10),
        date,
        startTime,
        endTime
      }
      setSelectedBlocks([...selectedBlocks, newBlock])
    }
  }

  const handleBlockMouseDown = (e: React.MouseEvent, blockIndex: number) => {
    e.stopPropagation()
    e.preventDefault()
    
    setDraggingBlockIndex(blockIndex)
    setDragStartY(e.clientY)
    setDragInitialTop(timeToMinutes(selectedBlocks[blockIndex].startTime))
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (draggingBlockIndex === null || !schedule) return
    
    const block = selectedBlocks[draggingBlockIndex]
    
    const deltaY = e.clientY - dragStartY
    const deltaMinutes = Math.round((deltaY / 96) * 60)
    
    let newStartMinutes = dragInitialTop + deltaMinutes
    newStartMinutes = snapToHalfHour(newStartMinutes)
    
    const minMinutes = timeToMinutes(schedule.interview_time_start)
    const maxMinutes = timeToMinutes(schedule.interview_time_end) - schedule.time_slot_duration
    
    if (newStartMinutes < minMinutes) newStartMinutes = minMinutes
    if (newStartMinutes > maxMinutes) newStartMinutes = maxMinutes
    
    const newStartTime = minutesToTime(newStartMinutes)
    const newEndMinutes = newStartMinutes + schedule.time_slot_duration
    const newEndTime = minutesToTime(newEndMinutes)
    
    if (!isTimeSlotInBusinessHours(newStartTime, newEndTime)) {
      return
    }
    
    const newBlocks = [...selectedBlocks]
    newBlocks[draggingBlockIndex] = {
      ...block,
      startTime: newStartTime,
      endTime: newEndTime
    }
    setSelectedBlocks(newBlocks)
  }

  const handleMouseUp = () => {
    setDraggingBlockIndex(null)
  }

  useEffect(() => {
    if (draggingBlockIndex !== null) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [draggingBlockIndex, selectedBlocks, schedule, dragStartY, dragInitialTop])

  const removeBlock = (blockIndex: number) => {
    setSelectedBlocks(selectedBlocks.filter((_, i) => i !== blockIndex))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!schedule || selectedBlocks.length === 0) return

    setSubmitting(true)

    try {
      const shareToken = nanoid(10)

      const slotsToSave = selectedBlocks.map(({ date, startTime, endTime }) => ({
        date,
        startTime,
        endTime
      }))

      const { error } = await supabase
        .from('guest_responses')
        .insert({
          schedule_id: schedule.id,
          guest_name: guestInfo.name,
          guest_email: guestInfo.email,
          selected_slots: slotsToSave,
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

  const goToPrev3Days = () => {
    if (!schedule) return
    
    const prevStart = new Date(startDate)
    prevStart.setDate(startDate.getDate() - 3)
    
    if (isDateInRange(prevStart, schedule.date_range_start, schedule.date_range_end)) {
      setStartDate(prevStart)
    }
  }

  const goToNext3Days = () => {
    if (!schedule) return
    
    const nextStart = new Date(startDate)
    nextStart.setDate(startDate.getDate() + 3)
    
    if (isDateInRange(nextStart, schedule.date_range_start, schedule.date_range_end)) {
      setStartDate(nextStart)
    }
  }

  const goToToday = () => {
    setStartDate(new Date())
  }

  const canGoPrev = schedule ? isDateInRange(
    new Date(startDate.getTime() - 3 * 24 * 60 * 60 * 1000),
    schedule.date_range_start,
    schedule.date_range_end
  ) : false

  const canGoNext = schedule ? isDateInRange(
    new Date(startDate.getTime() + 3 * 24 * 60 * 60 * 1000),
    schedule.date_range_start,
    schedule.date_range_end
  ) : false

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mb-4"></div>
          <p className="text-gray-600">読み込み中...</p>
        </div>
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
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-2 px-4 rounded-md"
            >
              リンクをコピー
            </button>
          </div>
        </div>
      </div>
    )
  }

  const hourSlots: number[] = []
  const startHour = Math.floor(timeToMinutes(schedule.interview_time_start) / 60)
  const endHour = Math.floor(timeToMinutes(schedule.interview_time_end) / 60)
  
  for (let hour = startHour; hour <= endHour; hour++) {
    hourSlots.push(hour)
  }

  const displayDates = getThreeDayDates(startDate).filter(date => 
    isDateInRange(date, schedule.date_range_start, schedule.date_range_end)
  )

  const blockHeightPx = schedule ? (schedule.time_slot_duration / 60) * 96 : 96

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {schedule.title}
              </h1>
              {schedule.description && (
                <p className="text-gray-600">{schedule.description}</p>
              )}
              <div className="mt-4 flex items-center space-x-4 text-sm text-gray-500">
                <span>📅 {schedule.date_range_start} ～ {schedule.date_range_end}</span>
                <span>⏱️ {schedule.time_slot_duration}分</span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                  🎤 候補日を受取
                </span>
                {isPrefilledGuest && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    ✅ 専用リンク
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              営業時間: {schedule.interview_time_start} - {schedule.interview_time_end}
              {schedule.interview_break_start && schedule.interview_break_end && (
                <>
                  <br />
                  休憩時間: {schedule.interview_break_start} - {schedule.interview_break_end}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-orange-800">
            📌 カレンダーで時間をクリックして選択してください（複数選択可）
          </p>
          <p className="text-xs text-orange-600 mt-1">
            予約時間: {schedule.time_slot_duration}分 | 選択後、ドラッグで時間を調整できます
          </p>
          {selectedBlocks.length > 0 && (
            <p className="text-xs text-orange-700 mt-2 font-medium">
              ✅ {selectedBlocks.length}個の時間を選択中
            </p>
          )}
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={goToPrev3Days}
              disabled={!canGoPrev}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← 前の3日
            </button>
            
            <div className="flex items-center gap-3">
              <button
                onClick={goToToday}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md text-sm font-medium transition-colors"
              >
                今日
              </button>
              
              <h2 className="text-lg font-medium text-gray-900">
                {startDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
              </h2>
            </div>
            
            <button
              onClick={goToNext3Days}
              disabled={!canGoNext}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              次の3日 →
            </button>
          </div>

          {displayDates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">この期間には予約可能な日がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse select-none">
                <thead>
                  <tr>
                    <th className="border border-gray-200 bg-gray-50 p-2 text-xs font-medium text-gray-500 w-20">
                      時間
                    </th>
                    {displayDates.map((date, idx) => {
                      const today = new Date()
                      const isToday = date.toISOString().split('T')[0] === today.toISOString().split('T')[0]
                      
                      return (
                        <th key={idx} className="border border-gray-200 bg-gray-50 p-2 text-sm font-medium text-gray-900">
                          <div>
                            {date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                            {date.toLocaleDateString('ja-JP', { weekday: 'short' })}
                            {isToday && <span className="text-red-500 text-lg leading-none">●</span>}
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {hourSlots.map((hour) => {
                    return (
                      <tr key={hour}>
                        <td className="border border-gray-300 bg-gray-50 p-2 text-xs text-gray-600 text-center align-top">
                          {String(hour).padStart(2, '0')}:00
                        </td>
                        {displayDates.map((date, dateIdx) => {
                          const dateStr = date.toISOString().split('T')[0]
                          
                          const firstHalfTime = `${String(hour).padStart(2, '0')}:00`
                          const secondHalfTime = `${String(hour).padStart(2, '0')}:30`
                          const isFirstHalfAvailable = isHalfHourInBusinessHours(firstHalfTime)
                          const isSecondHalfAvailable = isHalfHourInBusinessHours(secondHalfTime)

                          return (
                            <td 
                              key={dateIdx} 
                              className="border border-gray-300 p-0 relative"
                              style={{ height: '96px' }}
                              onClick={(e) => handleCellClick(dateStr, hour, e)}
                            >
                              <div 
                                className={`absolute top-0 left-0 right-0 cursor-pointer transition-colors ${
                                  isFirstHalfAvailable 
                                    ? 'hover:bg-orange-50' 
                                    : 'bg-gray-200 cursor-not-allowed'
                                }`}
                                style={{ height: '48px' }}
                              >
                                {!isFirstHalfAvailable && (
                                  <div className="flex items-center justify-center h-full">
                                    <span className="text-xs text-gray-400 font-medium opacity-80">選択不可</span>
                                  </div>
                                )}
                              </div>
                              
                              <div 
                                className="absolute left-0 right-0 border-t border-dashed border-gray-300 pointer-events-none z-10" 
                                style={{ top: '48px' }} 
                              />
                              
                              <div 
                                className={`absolute bottom-0 left-0 right-0 cursor-pointer transition-colors ${
                                  isSecondHalfAvailable 
                                    ? 'hover:bg-orange-50' 
                                    : 'bg-gray-200 cursor-not-allowed'
                                }`}
                                style={{ height: '48px' }}
                              >
                                {!isSecondHalfAvailable && (
                                  <div className="flex items-center justify-center h-full">
                                    <span className="text-xs text-gray-400 font-medium opacity-80">選択不可</span>
                                  </div>
                                )}
                              </div>
                              
                              {selectedBlocks.map((block, blockIdx) => {
                                const blockStartHour = Math.floor(timeToMinutes(block.startTime) / 60)
                                const isBlockStart = block.date === dateStr && blockStartHour === hour
                                
                                if (!isBlockStart) return null
                                
                                const blockTopPosition = timeToPixelPosition(block.startTime) - (blockStartHour - 9) * 96
                                const isDraggingThis = draggingBlockIndex === blockIdx

                                return (
                                  <div
                                    key={block.id}
                                    className={`absolute left-1 right-1 bg-orange-600 text-white rounded shadow-lg flex items-center justify-center text-xs font-medium z-20 ${
                                      isDraggingThis ? 'cursor-grabbing' : 'cursor-move'
                                    }`}
                                    style={{
                                      top: `${blockTopPosition}px`,
                                      height: `${blockHeightPx}px`
                                    }}
                                    onMouseDown={(e) => handleBlockMouseDown(e, blockIdx)}
                                  >
                                    <div className="text-center relative w-full">
                                      <div>{block.startTime.slice(0, 5)} - {block.endTime.slice(0, 5)}</div>
                                      <div className="text-[10px] opacity-80 mt-1">ドラッグで調整</div>
                                      
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          removeBlock(blockIdx)
                                        }}
                                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm flex items-center justify-center hover:bg-red-600 transition-colors shadow-md z-30"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
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

        {selectedBlocks.length > 0 && (
          <div className="fixed bottom-8 right-8 z-40">
            <button
              onClick={() => setShowPopup(true)}
              className="bg-orange-600 hover:bg-orange-700 text-white font-medium py-4 px-6 rounded-full shadow-lg transition-all hover:scale-105"
            >
              候補時間を送信 ({selectedBlocks.length}個)
            </button>
          </div>
        )}
      </div>

      {showPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  候補時間の送信
                </h2>
                <button
                  onClick={() => setShowPopup(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="bg-orange-50 p-4 rounded-md mb-6">
                <p className="text-sm font-medium text-orange-900 mb-2">
                  📅 選択した時間: {selectedBlocks.length}個
                </p>
                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                  {selectedBlocks.map((block, idx) => (
                    <div key={block.id} className="flex items-center justify-between bg-white p-2 rounded border border-orange-200">
                      <p className="text-xs text-orange-700">
                        {new Date(block.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })} {block.startTime.slice(0, 5)} - {block.endTime.slice(0, 5)}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeBlock(idx)}
                        className="w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 transition-colors shadow-md"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {isPrefilledGuest && (
                <div className="bg-green-50 p-3 rounded-md border border-green-200 mb-4">
                  <p className="text-xs text-green-800 font-medium">
                    ✅ 専用リンク
                  </p>
                  <p className="text-xs text-green-700 mt-1">
                    情報が自動入力されています
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    お名前 *
                  </label>
                  <input
                    type="text"
                    required
                    value={guestInfo.name}
                    onChange={(e) => setGuestInfo({ ...guestInfo, name: e.target.value })}
                    disabled={isPrefilledGuest}
                    className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                      isPrefilledGuest ? 'bg-gray-100 text-gray-900 font-medium' : ''
                    }`}
                    placeholder="山田太郎"
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
                    disabled={isPrefilledGuest}
                    className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                      isPrefilledGuest ? 'bg-gray-100 text-gray-900 font-medium' : ''
                    }`}
                    placeholder="yamada@example.com"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowPopup(false)}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 px-4 rounded-md disabled:bg-gray-400 transition-colors"
                  >
                    {submitting ? '送信中...' : '候補時間を送信'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
