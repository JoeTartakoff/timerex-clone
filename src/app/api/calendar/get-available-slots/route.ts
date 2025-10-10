import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchCalendarEvents, calculateAvailableSlots } from '@/utils/calendar'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ⭐ 환경 정보 로깅 추가
console.log('=== ENVIRONMENT INFO ===')
console.log('NODE_ENV:', process.env.NODE_ENV)
console.log('VERCEL:', process.env.VERCEL)
console.log('VERCEL_ENV:', process.env.VERCEL_ENV)
console.log('VERCEL_REGION:', process.env.VERCEL_REGION)
console.log('Has GOOGLE_CLIENT_SECRET:', !!process.env.GOOGLE_CLIENT_SECRET)
console.log('GOOGLE_CLIENT_SECRET length:', process.env.GOOGLE_CLIENT_SECRET?.length)
console.log('Has NEXT_PUBLIC_GOOGLE_CLIENT_ID:', !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)
console.log('========================')

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    console.log('🔄 Refreshing access token...')
    console.log('🔄 Using client_id:', process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.substring(0, 20) + '...')
    console.log('🔄 Has client_secret:', !!process.env.GOOGLE_CLIENT_SECRET)
    
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

    console.log('🔄 Refresh response status:', response.status)

    if (!response.ok) {
      const errorData = await response.json()
      console.error('🔄 Token refresh failed:', JSON.stringify(errorData, null, 2))
      return null
    }

    const data = await response.json()
    console.log('🔄 Token refreshed successfully')
    return data.access_token || null
  } catch (error) {
    console.error('🔄 Error refreshing token:', error)
    return null
  }
}

async function getAvailableSlotsForUser(
  userId: string,
  dateStart: string,
  dateEnd: string,
  slotDuration: number
) {
  console.log('=== getAvailableSlotsForUser ===')
  console.log('User ID:', userId)
  console.log('Date range:', dateStart, 'to', dateEnd)
  
  try {
    // 사용자의 토큰 가져오기
    console.log('📊 Querying user_tokens table...')
    const { data: tokens, error: tokensError } = await supabaseAdmin
      .from('user_tokens')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (tokensError) {
      console.error('❌ Tokens query error:', JSON.stringify(tokensError, null, 2))
      return null
    }

    if (!tokens) {
      console.error('❌ No tokens found for user:', userId)
      return null
    }

    console.log('✅ Tokens found for user:', userId)
    console.log('🔑 Token expires at:', tokens.expires_at)
    console.log('🔑 Access token (first 20 chars):', tokens.access_token?.substring(0, 20))
    console.log('🔑 Refresh token (first 20 chars):', tokens.refresh_token?.substring(0, 20))

    // Access token 갱신 체크
    let accessToken = tokens.access_token
    const expiresAt = new Date(tokens.expires_at)
    const now = new Date()
    
    console.log('⏰ Current time:', now.toISOString())
    console.log('⏰ Token expires at:', expiresAt.toISOString())
    console.log('⏰ Is expired:', expiresAt < now)
    
    if (expiresAt < now) {
      console.log('🔄 Token expired, attempting refresh...')
      const newAccessToken = await refreshAccessToken(tokens.refresh_token)
      
      if (!newAccessToken) {
        console.error('❌ Failed to refresh token')
        return null
      }
      
      console.log('✅ Token refreshed successfully')
      accessToken = newAccessToken

      console.log('💾 Updating token in database...')
      const { error: updateError } = await supabaseAdmin
        .from('user_tokens')
        .update({
          access_token: newAccessToken,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)

      if (updateError) {
        console.error('❌ Failed to update token:', updateError)
      } else {
        console.log('✅ Token updated in database')
      }
    } else {
      console.log('✅ Token is still valid, no refresh needed')
    }

    // Google Calendar에서 일정 가져오기
    const timeMin = new Date(dateStart).toISOString()
    const timeMax = new Date(dateEnd + 'T23:59:59').toISOString()
    
    console.log('📅 Calling fetchCalendarEvents...')
    console.log('📅 timeMin:', timeMin)
    console.log('📅 timeMax:', timeMax)
    
    const events = await fetchCalendarEvents(accessToken, timeMin, timeMax)
    console.log(`✅ Fetched ${events.length} events for user:`, userId)

    // 빈 시간대 계산
    console.log('🔍 Calling calculateAvailableSlots...')
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

    console.log(`✅ Calculated ${availableSlots.length} available slots for user:`, userId)
    return availableSlots
  } catch (error) {
    console.error('❌ Error in getAvailableSlotsForUser:', error)
    if (error instanceof Error) {
      console.error('Error name:', error.name)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    return null
  }
}

export async function POST(request: Request) {
  try {
    const { scheduleId, guestUserId } = await request.json()

    console.log('=== GET AVAILABLE SLOTS API START ===')
    console.log('📋 Schedule ID:', scheduleId)
    console.log('👤 Guest User ID:', guestUserId)
    console.log('🌐 Environment:', process.env.VERCEL_ENV || 'local')

    // 스케줄 정보 가져오기
    console.log('📊 Fetching schedule from database...')
    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('schedules')
      .select('*')
      .eq('id', scheduleId)
      .single()

    if (scheduleError) {
      console.error('❌ Schedule error:', JSON.stringify(scheduleError, null, 2))
      return NextResponse.json({ 
        success: false, 
        error: 'Schedule not found',
        useStaticSlots: true 
      }, { status: 404 })
    }

    console.log('✅ Schedule found:', schedule.title)
    console.log('👤 Host user ID:', schedule.user_id)

    // 호스트의 빈 시간 가져오기
    console.log('📅 Fetching host slots...')
    const hostSlots = await getAvailableSlotsForUser(
      schedule.user_id,
      schedule.date_range_start,
      schedule.date_range_end,
      schedule.time_slot_duration
    )

    console.log('📊 Host slots result:', hostSlots ? `${hostSlots.length} slots` : 'null')

    if (!hostSlots) {
      console.log('❌ Failed to get host slots')
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to get host availability',
        useStaticSlots: true 
      })
    }

    let finalSlots = hostSlots

    // 게스트가 로그인한 경우
    if (guestUserId) {
      console.log('👤 Guest logged in, fetching guest slots...')
      
      const guestSlots = await getAvailableSlotsForUser(
        guestUserId,
        schedule.date_range_start,
        schedule.date_range_end,
        schedule.time_slot_duration
      )

      console.log('📊 Guest slots result:', guestSlots ? `${guestSlots.length} slots` : 'null')

      if (guestSlots) {
        console.log('🔍 Calculating intersection...')
        const beforeCount = hostSlots.length
        
        finalSlots = hostSlots.filter(hostSlot => 
          guestSlots.some(guestSlot => 
            hostSlot.date === guestSlot.date &&
            hostSlot.startTime === guestSlot.startTime &&
            hostSlot.endTime === guestSlot.endTime
          )
        )
        
        console.log(`✅ Intersection: ${beforeCount} host + ${guestSlots.length} guest = ${finalSlots.length} common slots`)
      } else {
        console.log('⚠️ Failed to get guest slots, using host slots only')
      }
    }

    // 이미 예약된 시간대 제외
    console.log('📊 Fetching existing bookings...')
    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from('bookings')
      .select('booking_date, start_time, end_time')
      .eq('schedule_id', scheduleId)
      .eq('status', 'confirmed')

    if (bookingsError) {
      console.error('⚠️ Bookings error:', bookingsError)
    } else {
      console.log(`📊 Found ${bookings?.length || 0} existing bookings`)
    }

    const availableSlots = finalSlots.filter(slot => {
      return !bookings?.some(
        booking =>
          booking.booking_date === slot.date &&
          booking.start_time === slot.startTime &&
          booking.end_time === slot.endTime
      )
    })

    console.log(`✅ Final available slots: ${availableSlots.length}`)
    console.log('=== API COMPLETED SUCCESSFULLY ===')

    return NextResponse.json({ 
      success: true,
      slots: availableSlots,
      isGuestLoggedIn: !!guestUserId,
      debug: {
        environment: process.env.VERCEL_ENV || 'local',
        hostSlotsCount: hostSlots.length,
        guestSlotsCount: guestUserId ? (finalSlots.length === hostSlots.length ? 0 : 'calculated') : 'not logged in',
        bookingsCount: bookings?.length || 0,
        finalSlotsCount: availableSlots.length,
      }
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
