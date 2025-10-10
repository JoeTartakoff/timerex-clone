import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchCalendarEvents, calculateAvailableSlots } from '@/utils/calendar'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    console.log('🔄 Refreshing access token...')
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('🔄 Token refresh failed:', errorData)
      return null
    }

    const data = await response.json()
    console.log('🔄 Token refreshed successfully')
    return data.access_token || null
  } catch (error) {
    console.error('Error refreshing token:', error)
    return null
  }
}

async function getAvailableSlotsForUser(
  userId: string,
  dateStart: string,
  dateEnd: string,
  slotDuration: number
) {
  console.log('Getting slots for user:', userId)
  
  try {
    // 사용자의 토큰 가져오기
    const { data: tokens, error: tokensError } = await supabaseAdmin
      .from('user_tokens')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (tokensError || !tokens) {
      console.error('No tokens found for user:', userId, tokensError)
      return null
    }

    console.log('Tokens found for user:', userId)

    // Access token 갱신
    let accessToken = tokens.access_token

    const expiresAt = new Date(tokens.expires_at)
    if (expiresAt < new Date()) {
      console.log('Token expired, refreshing...')
      const newAccessToken = await refreshAccessToken(tokens.refresh_token)
      if (!newAccessToken) {
        console.error('Failed to refresh token')
        return null
      }
      accessToken = newAccessToken

      await supabaseAdmin
        .from('user_tokens')
        .update({
          access_token: newAccessToken,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
    }

    // Google Calendar에서 일정 가져오기
    const timeMin = new Date(dateStart).toISOString()
    const timeMax = new Date(dateEnd + 'T23:59:59').toISOString()
    
    console.log('Fetching calendar events for user:', userId)
    const events = await fetchCalendarEvents(accessToken, timeMin, timeMax)
    console.log(`Fetched ${events.length} events for user:`, userId)

    // 빈 시간대 계산
    const availableSlots = calculateAvailableSlots(
      events,
      dateStart,
      dateEnd,
      '09:00',
      '18:00',
      '12:00',
      '13:00',
      slotDuration
    )

    console.log(`Calculated ${availableSlots.length} available slots for user:`, userId)
    return availableSlots
  } catch (error) {
    console.error('Error in getAvailableSlotsForUser:', error)
    return null
  }
}

export async function POST(request: Request) {
  try {
    const { scheduleId, guestUserId } = await request.json()

    console.log('=== GET AVAILABLE SLOTS API ===')
    console.log('Request received:', { scheduleId, guestUserId })

    // 스케줄 정보 가져오기
    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('schedules')
      .select('*')
      .eq('id', scheduleId)
      .single()

    if (scheduleError) {
      console.error('Schedule error:', scheduleError)
      return NextResponse.json({ 
        success: false, 
        error: 'Schedule not found',
        useStaticSlots: true 
      }, { status: 404 })
    }

    console.log('Schedule found, host user:', schedule.user_id)

    // 호스트의 빈 시간 가져오기
    console.log('Fetching host slots...')
    const hostSlots = await getAvailableSlotsForUser(
      schedule.user_id,
      schedule.date_range_start,
      schedule.date_range_end,
      schedule.time_slot_duration
    )

    console.log('Host slots count:', hostSlots?.length || 0)

    if (!hostSlots) {
      console.log('Failed to get host slots, using static slots')
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to get host availability',
        useStaticSlots: true 
      })
    }

    let finalSlots = hostSlots

    // 게스트가 로그인한 경우, 게스트의 빈 시간도 확인
    if (guestUserId) {
      console.log('Guest logged in, getting guest slots...')
      
      const guestSlots = await getAvailableSlotsForUser(
        guestUserId,
        schedule.date_range_start,
        schedule.date_range_end,
        schedule.time_slot_duration
      )

      console.log('Guest slots count:', guestSlots?.length || 0)

      if (guestSlots) {
        // 호스트와 게스트 모두 비어있는 시간만 필터링 (교집합)
        finalSlots = hostSlots.filter(hostSlot => 
          guestSlots.some(guestSlot => 
            hostSlot.date === guestSlot.date &&
            hostSlot.startTime === guestSlot.startTime &&
            hostSlot.endTime === guestSlot.endTime
          )
        )
        console.log('Intersection slots count:', finalSlots.length)
      } else {
        console.log('Failed to get guest slots, using host slots only')
      }
    }

    // 이미 예약된 시간대 가져오기
    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from('bookings')
      .select('booking_date, start_time, end_time')
      .eq('schedule_id', scheduleId)
      .eq('status', 'confirmed')

    if (bookingsError) {
      console.error('Bookings error:', bookingsError)
    }

    // 예약된 시간 제외
    const availableSlots = finalSlots.filter(slot => {
      return !bookings?.some(
        booking =>
          booking.booking_date === slot.date &&
          booking.start_time === slot.startTime &&
          booking.end_time === slot.endTime
      )
    })

    console.log('Final available slots count:', availableSlots.length)
    console.log('=== API COMPLETED SUCCESSFULLY ===')

    return NextResponse.json({ 
      success: true,
      slots: availableSlots,
      isGuestLoggedIn: !!guestUserId
    })
  } catch (error: unknown) {
    console.error('=== API ERROR ===')
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error('Error message:', errorMessage)
    console.error('Error stack:', errorStack)
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        useStaticSlots: true 
      },
      { status: 500 }
    )
  }
}
