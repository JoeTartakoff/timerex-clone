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
  is_one_time_link: boolean
  is_used: boolean
  used_at: string | null
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

export default function BookingPage() {
  const params = useParams()
  const shareLink = params.shareLink as string

  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null)
  const [guestInfo, setGuestInfo] = useState({
    name: '',
    email: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [guestUser, setGuestUser] = useState<User | null>(null)
  const [isLoadingSlots, setIsLoadingSlots] = useState(false)
  const [isOneTimeMode, setIsOneTimeMode] = useState(false)
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null)
  const [tokenAlreadyUsed, setTokenAlreadyUsed] = useState(false)

  // ⭐ 초기화 플래그 (무한 루프 방지)
  const initRef = useRef(false)
  const guestLoginProcessedRef = useRef(false)

  // 스케줄 데이터 로드
  const fetchScheduleData = async (guestUserId?: string) => {
    try {
      console.log('=== fetchScheduleData START ===')
      console.log('shareLink:', shareLink)
      console.log('guestUserId:', guestUserId)
      
      setIsLoadingSlots(true)
      
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('schedules')
        .select('*')
        .eq('share_link', shareLink)
        .single()

      console.log('Schedule found:', scheduleData?.title)

      if (scheduleError) throw scheduleError

      setSchedule(scheduleData)

      // Google Calendar API로 실시간 슬롯 가져오기
      try {
        console.log('📅 Fetching from Google Calendar API...')
        
        const response = await fetch('/api/calendar/get-available-slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduleId: scheduleData.id,
            guestUserId: guestUserId || null,
          }),
        })

        console.log('API response status:', response.status)

        if (response.ok) {
          const result = await response.json()
          console.log('API result:', result)
          
          if (result.success && result.slots && result.slots.length > 0) {
            const slotsWithId = result.slots.map((slot: any, index: number) => ({
              id: `${slot.date}-${slot.startTime}-${index}`,
              date: slot.date,
              start_time: slot.startTime,
              end_time: slot.endTime,
            }))
            console.log('✅ Using Calendar API slots:', slotsWithId.length)
            setAvailableSlots(slotsWithId)
            return
          }
        }
        
        throw new Error('Calendar API failed')
      } catch (apiError) {
        console.log('⚠️ Calendar API failed, using static slots:', apiError)
        
        // API 실패 시 availability_slots에서 가져오기
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
      }
    } catch (error) {
      console.error('❌ fetchScheduleData error:', error)
      alert('スケジュールの読み込みに失敗しました')
    } finally {
      setLoading(false)
      setIsLoadingSlots(false)
    }
  }

  // ⭐ 초기 로드 (한 번만 실행)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    console.log('🎬 Initial load')

    // URL 파라미터 확인
    const urlParams = new URLSearchParams(window.location.search)
    const mode = urlParams.get('mode')
    const token = urlParams.get('token')
    
    if (mode === 'onetime' && token) {
      setIsOneTimeMode(true)
      setOneTimeToken(token)
      console.log('🔒 One-time mode activated:', token)
      
      // 토큰이 이미 사용되었는지 확인
      const checkToken = async () => {
        const { data } = await supabase
          .from('bookings')
          .select('id')
          .eq('one_time_token', token)
          .maybeSingle()

        if (data) {
          console.log('⚠️ Token already used')
          setTokenAlreadyUsed(true)
        }
      }
      checkToken()
    }

    const init = async () => {
      try {
        // 현재 로그인 상태 확인
        const { data: { user } } = await supabase.auth.getUser()
        
        if (user) {
          console.log('👤 User logged in:', user.email)
          setGuestUser(user as User)
          setGuestInfo({
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
            email: user.email || '',
          })
          
          // 토큰 저장
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
          
          await fetchScheduleData(user.id)
        } else {
          console.log('👤 No user logged in')
          await fetchScheduleData()
        }
      } catch (error) {
        console.error('❌ Init error:', error)
        setLoading(false)
      }
    }

    init()
  }, [shareLink])

  // ⭐ 게스트 로그인 후 처리 (한 번만)
  useEffect(() => {
    if (!guestUser || guestLoginProcessedRef.current) return
    if (initRef.current && guestUser) {
      // 초기 로드에서 이미 처리됨
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

        await fetchScheduleData(guestUser.id)
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

  const handleSlotSelect = (slot: AvailabilitySlot) => {
    setSelectedSlot(slot)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSlot || !schedule) return

    console.log('🚀 BOOKING SUBMISSION')
    console.log('One-time mode:', isOneTimeMode)
    console.log('Token:', oneTimeToken)

    if (submitting) {
      console.log('⚠️ Already submitting')
      return
    }

    setSubmitting(true)

    try {
      // ⭐ 원타임 모드인 경우 토큰 재확인
      if (isOneTimeMode && oneTimeToken) {
        console.log('🔍 Re-checking token...')
        
        const { data: existingBooking } = await supabase
          .from('bookings')
          .select('id')
          .eq('one_time_token', oneTimeToken)
          .maybeSingle()

        if (existingBooking) {
          console.log('❌ Token already used')
          alert('このリンクは既に使用されました。\n他の方が先に予約を完了しました。')
          setTimeout(() => window.location.reload(), 1000)
          return
        }

        console.log('✅ Token available')
      }

      // 예약 생성
      console.log('💾 Creating booking...')
      const { error: bookingError } = await supabase
        .from('bookings')
        .insert({
          schedule_id: schedule.id,
          guest_name: guestInfo.name,
          guest_email: guestInfo.email,
          booking_date: selectedSlot.date,
          start_time: selectedSlot.start_time,
          end_time: selectedSlot.end_time,
          status: 'confirmed',
          is_one_time_booking: isOneTimeMode,
          one_time_token: isOneTimeMode ? oneTimeToken : null,
        })

      if (bookingError) {
        console.error('❌ Booking error:', bookingError)
        throw bookingError
      }

      console.log('✅ Booking created')

      // Google Calendar 추가
      try {
        console.log('📅 Adding to calendar...')
        const response = await fetch('/api/calendar/add-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduleId: schedule.id,
            bookingDate: selectedSlot.date,
            startTime: selectedSlot.start_time,
            endTime: selectedSlot.end_time,
            guestName: guestInfo.name,
            guestEmail: guestInfo.email,
            guestUserId: guestUser?.id,
          }),
        })
        
        if (response.ok) {
          console.log('✅ Calendar event created')
          alert('予約が完了しました！\nカレンダーに追加されました。')
        } else {
          console.log('⚠️ Calendar failed, but booking saved')
          alert('予約が完了しました！\n（カレンダーへの追加は失敗しましたが、予約は保存されています）')
        }
      } catch (calendarError) {
        console.error('⚠️ Calendar error:', calendarError)
        alert('予約が完了しました！\n（カレンダーへの追加は失敗しましたが、予約は保存されています）')
      }
      
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      console.error('❌ Submit error:', error)
      alert('予約に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

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

  if (tokenAlreadyUsed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-yellow-100 mb-4">
              <svg className="h-10 w-10 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              既に予約が完了したリンクです
            </h2>
            <p className="text-gray-600">
              このリンクはワンタイムリンクのため、既に使用されました。
            </p>
          </div>
        </div>
      </div>
    )
  }

  const slotsByDate = availableSlots.reduce((acc, slot) => {
    if (!acc[slot.date]) {
      acc[slot.date] = []
    }
    acc[slot.date].push(slot)
    return acc
  }, {} as Record<string, AvailabilitySlot[]>)

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
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
            </div>
            
            {isOneTimeMode && (
              <div className="ml-4">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  🔒 ワンタイムリンク
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                予約可能な時間を選択
              </h2>

              {isLoadingSlots ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">カレンダーを確認中...</p>
                </div>
              ) : Object.keys(slotsByDate).length === 0 ? (
                <p className="text-gray-500">予約可能な時間がありません。</p>
              ) : (
                <div className="space-y-6">
                  {Object.entries(slotsByDate).map(([date, slots]) => (
                    <div key={date}>
                      <h3 className="text-sm font-medium text-gray-700 mb-3">
                        {new Date(date).toLocaleDateString('ja-JP', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          weekday: 'long',
                        })}
                      </h3>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {slots.map((slot) => {
                          const selected = selectedSlot?.id === slot.id

                          return (
                            <button
                              key={slot.id}
                              onClick={() => handleSlotSelect(slot)}
                              className={`
                                py-2 px-3 rounded-md text-sm font-medium transition-colors
                                ${selected
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                }
                              `}
                            >
                              {slot.start_time.slice(0, 5)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white shadow rounded-lg p-6 sticky top-8">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                予約情報
              </h2>

              {selectedSlot ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="bg-blue-50 p-3 rounded-md">
                    <p className="text-sm font-medium text-blue-900">
                      選択した時間
                    </p>
                    <p className="text-sm text-blue-700 mt-1">
                      {new Date(selectedSlot.date).toLocaleDateString('ja-JP')}
                    </p>
                    <p className="text-sm text-blue-700">
                      {selectedSlot.start_time.slice(0, 5)} - {selectedSlot.end_time.slice(0, 5)}
                    </p>
                  </div>

                  {isOneTimeMode && (
                    <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200">
                      <p className="text-xs text-yellow-800 font-medium">
                        ⚠️ ワンタイムリンク
                      </p>
                      <p className="text-xs text-yellow-700 mt-1">
                        予約完了後、このリンクは無効化されます
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
                      disabled={!!guestUser}
                      className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 ${
                        guestUser ? 'bg-gray-100' : ''
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
                      disabled={!!guestUser}
                      className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 ${
                        guestUser ? 'bg-gray-100' : ''
                      }`}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md disabled:bg-gray-400"
                  >
                    {submitting ? '予約中...' : '予約を確定する'}
                  </button>
                </form>
              ) : (
                <p className="text-sm text-gray-500">
                  予約可能な時間を選択してください
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
