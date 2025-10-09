'use client'

import { useEffect, useState } from 'react'
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

interface Booking {
  booking_date: string
  start_time: string
  end_time: string
}

export default function BookingPage() {
  const params = useParams()
  const shareLink = params.shareLink as string

  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null)
  const [guestInfo, setGuestInfo] = useState({
    name: '',
    email: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [guestUser, setGuestUser] = useState<any>(null)
  const [isLoadingSlots, setIsLoadingSlots] = useState(false)

  useEffect(() => {
    console.log('=== useEffect triggered ===')
    console.log('shareLink:', shareLink)
    
    const init = async () => {
      try {
        await checkGuestUser()
        await fetchScheduleData()
      } catch (error) {
        console.error('Init error:', error)
        setLoading(false)
      }
    }
    
    init()
  }, [])

useEffect(() => {
  if (!guestUser) return

  const saveAndReload = async () => {
    console.log('=== Guest Login Detected ===')
    console.log('Guest user ID:', guestUser.id)
    console.log('Guest email:', guestUser.email)
    
    // 게스트 정보 자동 입력
    setGuestInfo({
      name: guestUser.user_metadata?.full_name || guestUser.email?.split('@')[0] || '',
      email: guestUser.email || '',
    })
    
    try {
      // 세션에서 토큰 가져오기
      const { data: { session } } = await supabase.auth.getSession()
      console.log('Session check:', {
        hasSession: !!session,
        hasProviderToken: !!session?.provider_token,
        hasRefreshToken: !!session?.provider_refresh_token
      })
      
      if (session?.provider_token && session?.provider_refresh_token) {
        // 토큰 저장
        const expiresAt = new Date(Date.now() + (session.expires_in || 3600) * 1000).toISOString()
        
        const { error: tokenError } = await supabase
          .from('user_tokens')
          .upsert({
            user_id: guestUser.id,
            access_token: session.provider_token,
            refresh_token: session.provider_refresh_token,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id'
          })

        if (tokenError) {
          console.error('Failed to save guest tokens:', tokenError)
        } else {
          console.log('Guest tokens saved successfully')
        }
      }

      // 게스트 ID를 명시적으로 전달하여 슬롯 재로드
      console.log('Reloading slots with guest ID:', guestUser.id)
      await fetchScheduleData(guestUser.id)
    } catch (error) {
      console.error('Error in guest login handler:', error)
    }
  }

  saveAndReload()
}, [guestUser?.id])

  const checkGuestUser = async () => {
    try {
      console.log('Checking guest user...')
      const { data: { user }, error } = await supabase.auth.getUser()
      console.log('Guest user result:', { user: user?.email, error })
      if (user) {
        setGuestUser(user)
      }
    } catch (error) {
      console.error('Error checking guest user:', error)
    }
  }

  const fetchScheduleData = async (guestUserId?: string) => {
    try {
      console.log('=== fetchScheduleData START ===')
      console.log('shareLink:', shareLink)
      console.log('guestUserId param:', guestUserId)
      console.log('guestUser state:', guestUser?.id)
      
      setIsLoadingSlots(true)
      
      // 스케줄 정보 가져오기
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('schedules')
        .select('*')
        .eq('share_link', shareLink)
        .single()

      console.log('Schedule query result:')
      console.log('- data:', scheduleData)
      console.log('- error:', scheduleError)

      if (scheduleError) throw scheduleError

      setSchedule(scheduleData)

      // 실시간으로 Google Calendar에서 가능한 시간 가져오기
      try {
        const finalGuestUserId = guestUserId || guestUser?.id
        console.log('Final guest user ID for API:', finalGuestUserId)
        
        console.log('Fetching available slots...')
        const response = await fetch('/api/calendar/get-available-slots', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scheduleId: scheduleData.id,
            guestUserId: finalGuestUserId,
          }),
        })

        console.log('API response status:', response.status)
        
        // 응답이 비어있는지 확인
        const text = await response.text()
        console.log('API response text length:', text.length)
        
        if (!text) {
          console.error('Empty response from API')
          throw new Error('Empty API response')
        }
        
        const result = JSON.parse(text)
        console.log('API result:', result)

        if (result.success && result.slots) {
          // 실시간 슬롯 사용
          const slotsWithId = result.slots.map((slot: any, index: number) => ({
            id: `${slot.date}-${slot.startTime}-${index}`,
            date: slot.date,
            start_time: slot.startTime,
            end_time: slot.endTime,
          }))
          console.log('Setting available slots:', slotsWithId.length)
          setAvailableSlots(slotsWithId)
          setBookings([]) // 이미 필터링됨
        } else {
          console.log('API failed, loading static slots')
          // API 실패 시 저장된 슬롯 사용 (폴백)
          await loadStaticSlots(scheduleData.id)
        }
      } catch (error) {
        console.error('Failed to get real-time slots, using static slots:', error)
        // API 실패 시 저장된 슬롯 사용 (폴백)
        await loadStaticSlots(scheduleData.id)
      }
    } catch (error) {
      console.error('Error in fetchScheduleData:', error)
      alert('スケジュールの読み込みに失敗しました: ' + error)
    } finally {
      console.log('Setting loading to false')
      setLoading(false)
      setIsLoadingSlots(false)
    }
  }

  // 저장된 슬롯 로드 (폴백용)
  const loadStaticSlots = async (scheduleId: string) => {
    // 가능한 시간대 가져오기
    const { data: slotsData, error: slotsError } = await supabase
      .from('availability_slots')
      .select('*')
      .eq('schedule_id', scheduleId)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })

    if (slotsError) throw slotsError

    setAvailableSlots(slotsData || [])

    // 이미 예약된 시간대 가져오기
    const { data: bookingsData, error: bookingsError } = await supabase
      .from('bookings')
      .select('booking_date, start_time, end_time')
      .eq('schedule_id', scheduleId)
      .eq('status', 'confirmed')

    if (bookingsError) throw bookingsError

    setBookings(bookingsData || [])
  }

  const handleGuestLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar',
        redirectTo: `${window.location.origin}/book/${shareLink}`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })

    if (error) {
      console.error('ログインエラー:', error.message)
      alert('ログインに失敗しました')
    }
  }

  const handleGuestLogout = async () => {
    await supabase.auth.signOut()
    setGuestUser(null)
    await fetchScheduleData()
  }

  const isSlotBooked = (slot: AvailabilitySlot) => {
    return bookings.some(
      (booking) =>
        booking.booking_date === slot.date &&
        booking.start_time === slot.start_time &&
        booking.end_time === slot.end_time
    )
  }

  const handleSlotSelect = (slot: AvailabilitySlot) => {
    if (isSlotBooked(slot)) return
    setSelectedSlot(slot)
  }

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!selectedSlot || !schedule) return

  setSubmitting(true)

  try {
    // 예약 저장
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
      })

    if (bookingError) throw bookingError

    // Google Calendar에 이벤트 추가 (호스트 + 게스트)
    try {
      console.log('Calling calendar API...')
      const response = await fetch('/api/calendar/add-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduleId: schedule.id,
          bookingDate: selectedSlot.date,
          startTime: selectedSlot.start_time,
          endTime: selectedSlot.end_time,
          guestName: guestInfo.name,
          guestEmail: guestInfo.email,
          guestUserId: guestUser?.id, // 게스트 ID 추가
        }),
      })
      
      const result = await response.json()
      console.log('Calendar API response:', result)
      
      if (!response.ok) {
        console.error('Calendar API failed:', result)
      }
    } catch (calendarError) {
      console.error('Calendar event creation failed:', calendarError)
      // 캘린더 추가 실패해도 예약은 완료된 것으로 처리
    }
    
    alert('予約が完了しました！\nカレンダーに追加されました。')
    
    // 페이지 새로고침
    setSelectedSlot(null)
    setGuestInfo({ name: '', email: '' })
    await fetchScheduleData()
  } catch (error: any) {
    console.error('Error:', error)
    alert('予約に失敗しました: ' + error.message)
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
          <p className="text-gray-600">
            このリンクは無効です。
          </p>
        </div>
      </div>
    )
  }

  // 날짜별로 슬롯 그룹화
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
        {/* ヘッダー */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
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

          {/* 게스트 로그인 섹션 */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            {guestUser ? (
              <div className="flex items-center justify-between bg-blue-50 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-blue-900">
                      Googleカレンダーと連携中
                    </p>
                    <p className="text-xs text-blue-700">
                      {guestUser.email} - お互いに空いている時間のみ表示
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
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 mb-1">
                      自分のカレンダーと照合しますか？
                    </p>
                    <p className="text-xs text-gray-600 mb-3">
                      Googleでログインすると、お互いのカレンダーで空いている時間のみ表示されます
                    </p>
                    <button
                      onClick={handleGuestLogin}
                      className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Googleでログイン
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 時間選択 */}
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
                          const booked = isSlotBooked(slot)
                          const selected = selectedSlot?.id === slot.id

                          return (
                            <button
                              key={slot.id}
                              onClick={() => handleSlotSelect(slot)}
                              disabled={booked}
                              className={`
                                py-2 px-3 rounded-md text-sm font-medium transition-colors
                                ${booked
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                  : selected
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

          {/* 予約フォーム */}
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

    {guestUser && (
      <div className="bg-green-50 p-3 rounded-md">
        <p className="text-xs text-green-700">
          ✓ Googleアカウントでログイン済み
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
        className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
          guestUser ? 'bg-gray-100 cursor-not-allowed' : ''
        }`}
        placeholder="山田太郎"
      />
      {guestUser && (
        <p className="text-xs text-gray-500 mt-1">
          Googleアカウントから自動入力
        </p>
      )}
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
        className={`w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
          guestUser ? 'bg-gray-100 cursor-not-allowed' : ''
        }`}
        placeholder="example@email.com"
      />
      {guestUser && (
        <p className="text-xs text-gray-500 mt-1">
          Googleアカウントから自動入力
        </p>
      )}
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
