'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Schedule {
  id: string
  title: string
  description: string
  date_range_start: string
  date_range_end: string
  time_slot_duration: number
  user_id: string
}

interface AvailabilitySlot {
  id: string
  date: string
  start_time: string
  end_time: string
}

interface User {
  id: string
  email?: string
  user_metadata?: {
    full_name?: string
  }
}

interface TimeBlock {
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

export default function BookingPage() {
  const params = useParams()
  const shareLink = params.shareLink as string
  const guestName = params.guestName as string
  const guestEmail = params.guestEmail as string

  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([])
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null)
  const [guestInfo, setGuestInfo] = useState({
    name: decodeURIComponent(guestName || ''),
    email: decodeURIComponent(guestEmail || ''),
  })
  const [submitting, setSubmitting] = useState(false)
  const [guestUser, setGuestUser] = useState<User | null>(null)
  const [isLoadingSlots, setIsLoadingSlots] = useState(false)
  const [isPrefilledGuest, setIsPrefilledGuest] = useState(false)
  const [startDate, setStartDate] = useState<Date>(new Date())
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragInitialTop, setDragInitialTop] = useState(0)

  const initRef = useRef(false)
  const guestLoginProcessedRef = useRef(false)

  // ⭐ 스케줄 정보만 먼저 로딩
  const fetchScheduleInfo = async () => {
    try {
      console.log('📋 Fetching schedule info...')
      
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('schedules')
        .select('*')
        .eq('share_link', shareLink)
        .single()

      if (scheduleError) throw scheduleError

      console.log('✅ Schedule info loaded:', scheduleData.title)
      setSchedule(scheduleData)
      setLoading(false)

      const today = new Date()
      setStartDate(today)

      return scheduleData
    } catch (error) {
      console.error('❌ Failed to load schedule:', error)
      alert('スケジュールの読み込みに失敗しました')
      setLoading(false)
      return null
    }
  }

  // ⭐ 캘린더 슬롯은 백그라운드에서 로딩
  const fetchCalendarSlots = async (scheduleData: Schedule, guestUserId?: string) => {
    try {
      console.log('📅 Fetching calendar slots...')
      setIsLoadingSlots(true)

      const response = await fetch('/api/calendar/get-available-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: scheduleData.id,
          guestUserId: guestUserId || null,
        }),
      })

      if (response.ok) {
        const result = await response.json()
        
        if (result.success && result.slots && result.slots.length > 0) {
          const slotsWithId = result.slots.map((slot: any, index: number) => ({
            id: `${slot.date}-${slot.startTime}-${index}`,
            date: slot.date,
            start_time: slot.startTime,
            end_time: slot.endTime,
          }))
          console.log('✅ Using Calendar API slots:', slotsWithId.length)
          setAvailableSlots(slotsWithId)
          setIsLoadingSlots(false)
          return
        }
      }
      
      throw new Error('Calendar API failed')
    } catch (apiError) {
      console.log('⚠️ Calendar API failed, using static slots:', apiError)
      
      const { data: slotsData, error: slotsError } = await supabase
        .from('availability_slots')
        .select('*')
        .eq('schedule_id', scheduleData.id)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true })

      if (slotsError) {
        console.error('❌ Failed to load static slots:', slotsError)
      } else {
        console.log('✅ Loaded static slots:', slotsData?.length || 0)
        setAvailableSlots(slotsData || [])
      }
      
      setIsLoadingSlots(false)
    }
  }

  const fetchGuestPreset = async (token: string) => {
    try {
      console.log('🔍 Fetching guest preset for token:', token)
      
      const response = await fetch(`/api/guest-presets/${token}`)
      
      if (response.ok) {
        const data = await response.json()
        console.log('✅ Guest preset found:', data)
        
        setGuestInfo({
          name: data.guestName,
          email: data.guestEmail,
        })
        setIsPrefilledGuest(true)
        
        setTimeout(() => {
          alert(`${data.guestName}様専用リンクです\n情報が自動入力されました`)
        }, 500)
      } else {
        console.log('⚠️ Guest preset not found')
      }
    } catch (error) {
      console.error('❌ Failed to fetch guest preset:', error)
    }
  }

  useEffect(() => {
    const initPage = async () => {
      if (initRef.current) return
      initRef.current = true

      console.log('🎬 Initial load')

      // ⭐ URL 경로에 게스트 정보가 있으면 전용링크
      if (guestName && guestEmail) {
        console.log('👤 Guest info from URL:', guestName, guestEmail)
        setIsPrefilledGuest(true)
      }

      const init = async () => {
        try {
          // ⭐ 1단계: 스케줄 정보만 먼저 로딩
          const scheduleData = await fetchScheduleInfo()
          if (!scheduleData) return

          // ⭐ 2단계: 사용자 정보 확인
          const { data: { user } } = await supabase.auth.getUser()
          
          if (user) {
            console.log('👤 User logged in:', user.email)
            setGuestUser(user as User)
            
            // 전용링크가 아닐 때만 자동 입력
            if (!guestName && !guestEmail) {
              setGuestInfo({
                name: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
                email: user.email || '',
              })
            }
            
            const { data: { session } } = await supabase.auth.getSession()
            if (session?.provider_token && session?.provider_refresh_token) {
              await supabase.from('user_tokens').upsert({
                user_id: user.id,
                access_token: session.provider_token,
                refresh_token: session.provider_refresh_token,
                expires_at: new Date(Date.now() + (session.expires_in || 3600) * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id' })
            }
            
            // ⭐ 3단계: 캘린더 슬롯 백그라운드 로딩
            fetchCalendarSlots(scheduleData, user.id)
          } else {
            console.log('👤 No user logged in')
            // ⭐ 3단계: 캘린더 슬롯 백그라운드 로딩
            fetchCalendarSlots(scheduleData)
          }
        } catch (error) {
          console.error('❌ Init error:', error)
          setLoading(false)
        }
      }

      init()
    }

    initPage()
  }, [shareLink])

  useEffect(() => {
    if (!guestUser || guestLoginProcessedRef.current) return
    if (initRef.current && guestUser) {
      guestLoginProcessedRef.current = true
      return
    }

    guestLoginProcessedRef.current = true
    console.log('👤 Guest login detected, reloading...')

    const reload = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        
        if (session?.provider_token && session?.provider_refresh_token) {
          await supabase.from('user_tokens').upsert({
            user_id: guestUser.id,
            access_token: session.provider_token,
            refresh_token: session.provider_refresh_token,
            expires_at: new Date(Date.now() + (session.expires_in || 3600) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
        }

        if (schedule) {
          fetchCalendarSlots(schedule, guestUser.id)
        }
      } catch (error) {
        console.error('❌ Guest login handler error:', error)
      }
    }

    reload()
  }, [guestUser?.id])

  const handleGuestLogin = async () => {
    const currentUrl = window.location.href
    
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar',
        redirectTo: currentUrl,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })

    if (error) {
      console.error('❌ Login error:', error)
      alert('ログインに失敗しました')
    }
  }

  const handleGuestLogout = async () => {
    await supabase.auth.signOut()
    setGuestUser(null)
    guestLoginProcessedRef.current = false
    window.location.reload()
  }

  const isHalfHourAvailable = (date: string, startTime: string): boolean => {
    const startMinutes = timeToMinutes(startTime)
    const endMinutes = startMinutes + 30
    
    return availableSlots.some(slot => 
      slot.date === date &&
      timeToMinutes(slot.start_time) <= startMinutes && 
      timeToMinutes(slot.end_time) >= endMinutes
    )
  }

  const isTimeSlotAvailable = (date: string, startTime: string, endTime: string): boolean => {
    const startMinutes = timeToMinutes(startTime)
    const endMinutes = timeToMinutes(endTime)
    
    for (let time = startMinutes; time < endMinutes; time += 30) {
      const currentTime = minutesToTime(time)
      if (!isHalfHourAvailable(date, currentTime)) {
        return false
      }
    }
    
    return true
  }

  const handleCellClick = (date: string, hour: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!schedule || isDragging) return
    
    const rect = e.currentTarget.getBoundingClientRect()
    const clickY = e.clientY - rect.top
    const cellHeight = rect.height
    
    const minute = clickY < cellHeight / 2 ? 0 : 30
    
    const startMinutes = hour * 60 + minute
    const startTime = minutesToTime(startMinutes)
    const endMinutes = startMinutes + schedule.time_slot_duration
    const endTime = minutesToTime(endMinutes)
    
    if (!isTimeSlotAvailable(date, startTime, endTime)) {
      alert('この時間帯は予約できません')
      return
    }
    
    setSelectedBlock({
      date,
      startTime,
      endTime
    })

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBlockMouseDown = (e: React.MouseEvent) => {
    if (!selectedBlock) return
    
    e.stopPropagation()
    e.preventDefault()
    
    setIsDragging(true)
    setDragStartY(e.clientY)
    setDragInitialTop(timeToMinutes(selectedBlock.startTime))
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !selectedBlock || !schedule) return
    
    const deltaY = e.clientY - dragStartY
    const deltaMinutes = Math.round((deltaY / 96) * 60)
    
    let newStartMinutes = dragInitialTop + deltaMinutes
    newStartMinutes = snapToHalfHour(newStartMinutes)
    
    const minMinutes = 9 * 60
    const maxMinutes = 18 * 60 - schedule.time_slot_duration
    
    if (newStartMinutes < minMinutes) newStartMinutes = minMinutes
    if (newStartMinutes > maxMinutes) newStartMinutes = maxMinutes
    
    const newStartTime = minutesToTime(newStartMinutes)
    const newEndMinutes = newStartMinutes + schedule.time_slot_duration
    const newEndTime = minutesToTime(newEndMinutes)
    
    if (!isTimeSlotAvailable(selectedBlock.date, newStartTime, newEndTime)) {
      return
    }
    
    setSelectedBlock({
      ...selectedBlock,
      startTime: newStartTime,
      endTime: newEndTime
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, selectedBlock, schedule, dragStartY, dragInitialTop])

  const cancelSelection = () => {
    setSelectedBlock(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedBlock || !schedule) return

    console.log('🚀 BOOKING SUBMISSION')

    if (submitting) {
      console.log('⚠️ Already submitting')
      return
    }

    setSubmitting(true)

    try {
      console.log('💾 Creating booking...')
      const { error: bookingError } = await supabase
        .from('bookings')
        .insert({
          schedule_id: schedule.id,
          guest_name: guestInfo.name,
          guest_email: guestInfo.email,
          booking_date: selectedBlock.date,
          start_time: selectedBlock.startTime,
          end_time: selectedBlock.endTime,
          status: 'confirmed',
        })

      if (bookingError) {
        console.error('❌ Booking error:', bookingError)
        throw bookingError
      }

      console.log('✅ Booking created')

      try {
        console.log('📅 Adding to calendar...')
        const response = await fetch('/api/calendar/add-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduleId: schedule.id,
            bookingDate: selectedBlock.date,
            startTime: selectedBlock.startTime,
            endTime: selectedBlock.endTime,
            guestName: guestInfo.name,
            guestEmail: guestInfo.email,
            guestUserId: guestUser?.id,
          }),
        })
        
        if (response.ok) {
          console.log('✅ Calendar event created')
        } else {
          console.log('⚠️ Calendar failed, but booking saved')
        }
      } catch (calendarError) {
        console.error('⚠️ Calendar error:', calendarError)
      }

      const bookingDate = new Date(selectedBlock.date).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      })

      alert(
        `予約が完了しました！\n\n` +
        `📅 日時：${bookingDate}\n` +
        `🕐 時間：${selectedBlock.startTime.slice(0, 5)} - ${selectedBlock.endTime.slice(0, 5)}\n` +
        `👤 名前：${guestInfo.name}\n` +
        `📧 メール：${guestInfo.email}\n\n` +
        `カレンダーに追加されました。`
      )
      
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      console.error('❌ Submit error:', error)
      alert('予約に失敗しました')
    } finally {
      setSubmitting(false)
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
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
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

  const hourSlots: number[] = []
  for (let hour = 9; hour <= 17; hour++) {
    hourSlots.push(hour)
  }

  const displayDates = getThreeDayDates(startDate).filter(date => 
    isDateInRange(date, schedule.date_range_start, schedule.date_range_end)
  )

  const blockHeightPx = schedule ? (schedule.time_slot_duration / 60) * 96 : 96

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 헤더 박스 */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
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
            </div>
            
            <div className="ml-4">
              {isPrefilledGuest && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  ✅ 専用リンク
                </span>
              )}
            </div>
          </div>

          <div className="pt-6 border-t border-gray-200">
            {guestUser ? (
              <div className="flex items-center justify-between bg-blue-50 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div>
                    <p className="text-sm font-medium text-blue-900">
                      Googleカレンダーと連携中
                    </p>
                    <p className="text-xs text-blue-700">
                      {guestUser.email}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleGuestLogout}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  ログアウト
                </button>
              </div>
            ) : (
              <div className="bg-gray-50 p-4 rounded-lg">
                <button
                  onClick={handleGuestLogin}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Googleでログイン
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 예약 정보 박스 */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            予約情報
          </h2>

          {selectedBlock ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-md mb-4 relative">
                <p className="text-sm font-medium text-blue-900">
                  選択した時間
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  {new Date(selectedBlock.date).toLocaleDateString('ja-JP')}
                </p>
                <p className="text-sm text-blue-700">
                  {selectedBlock.startTime} - {selectedBlock.endTime}
                </p>
                
                <button
                  type="button"
                  onClick={cancelSelection}
                  className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm flex items-center justify-center hover:bg-red-600 transition-colors shadow-md"
                  title="選択をキャンセル"
                >
                  ×
                </button>
              </div>

              {isPrefilledGuest && (
                <div className="bg-green-50 p-3 rounded-md border border-green-200">
                  <p className="text-xs text-green-800 font-medium">
                    ✅ 専用リンク
                  </p>
                  <p className="text-xs text-green-700 mt-1">
                    情報が自動入力されています
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  お名前 *
                </label>
                <input
                  type="text"
                  required
                  value={guestInfo.name}
                  onChange={(e) => setGuestInfo({ ...guestInfo, name: e.target.value })}
                  disabled={!!guestUser || isPrefilledGuest}
                  className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 ${
                    (guestUser || isPrefilledGuest) ? 'bg-gray-100' : ''
                  }`}
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
                  disabled={!!guestUser || isPrefilledGuest}
                  className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 ${
                    (guestUser || isPrefilledGuest) ? 'bg-gray-100' : ''
                  }`}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md disabled:bg-gray-400"
              >
                {submitting ? '予約中...' : '予約を確定する'}
              </button>
            </form>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">
                下のカレンダーで時間をクリックして選択してください
              </p>
              <p className="text-sm text-gray-400 mt-2">
                予約時間: {schedule.time_slot_duration}分
              </p>
              <p className="text-sm text-gray-400">
                選択後、ドラッグで時間を調整できます
              </p>
            </div>
          )}
        </div>

        {/* 캘린더 박스 */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={goToPrev3Days}
              disabled={!canGoPrev || isLoadingSlots}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← 前の3日
            </button>
            
            <div className="flex items-center gap-3">
              <button
                onClick={goToToday}
                disabled={isLoadingSlots}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              >
                今日
              </button>
              
              <h2 className="text-lg font-medium text-gray-900">
                {startDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
              </h2>
            </div>
            
            <button
              onClick={goToNext3Days}
              disabled={!canGoNext || isLoadingSlots}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              次の3日 →
            </button>
          </div>

          {isLoadingSlots ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-500">カレンダーを確認中...</p>
              <p className="text-xs text-gray-400 mt-2">Googleカレンダーと同期しています</p>
            </div>
          ) : displayDates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">この期間には予約可能な日がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse select-none">
                <thead>
                  <tr>
                    <th className="border border-gray-300 bg-gray-50 p-2 text-xs font-medium text-gray-500 w-20">
                      時間
                    </th>
                    {displayDates.map((date, idx) => {
                      const today = new Date()
                      const isToday = date.toISOString().split('T')[0] === today.toISOString().split('T')[0]
                      
                      return (
                        <th key={idx} className="border border-gray-300 bg-gray-50 p-2 text-sm font-medium text-gray-900">
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
                          const isFirstHalfAvailable = isHalfHourAvailable(dateStr, firstHalfTime)
                          const isSecondHalfAvailable = isHalfHourAvailable(dateStr, secondHalfTime)
                          
                          const blockStartHour = selectedBlock ? Math.floor(timeToMinutes(selectedBlock.startTime) / 60) : -1
                          const isBlockStart = selectedBlock && 
                                               selectedBlock.date === dateStr && 
                                               blockStartHour === hour
                          
                          const blockTopPosition = selectedBlock && isBlockStart
                            ? timeToPixelPosition(selectedBlock.startTime) - (blockStartHour - 9) * 96
                            : 0

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
                                    ? 'hover:bg-blue-50' 
                                    : 'bg-gray-200 cursor-not-allowed'
                                }`}
                                style={{ height: '48px' }}
                              >
                                {!isFirstHalfAvailable && (
                                  <div className="flex items-center justify-center h-full">
                                    <span className="text-xs text-gray-400 font-medium opacity-80">予約不可</span>
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
                                    ? 'hover:bg-blue-50' 
                                    : 'bg-gray-200 cursor-not-allowed'
                                }`}
                                style={{ height: '48px' }}
                              >
                                {!isSecondHalfAvailable && (
                                  <div className="flex items-center justify-center h-full">
                                    <span className="text-xs text-gray-400 font-medium opacity-80">予約不可</span>
                                  </div>
                                )}
                              </div>
                              
                              {isBlockStart && (
                                <div
                                  className={`absolute left-1 right-1 bg-blue-600 text-white rounded shadow-lg flex items-center justify-center text-xs font-medium z-20 ${
                                    isDragging ? 'cursor-grabbing' : 'cursor-move'
                                  }`}
                                  style={{
                                    top: `${blockTopPosition}px`,
                                    height: `${blockHeightPx}px`
                                  }}
                                  onMouseDown={handleBlockMouseDown}
                                >
                                  <div className="text-center relative w-full">
                                    <div>{selectedBlock.startTime.slice(0, 5)} - {selectedBlock.endTime.slice(0, 5)}</div>
                                    <div className="text-[10px] opacity-80 mt-1">ドラッグで調整</div>
                                    
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        cancelSelection()
                                      }}
                                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm flex items-center justify-center hover:bg-red-600 transition-colors shadow-md z-30"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
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
