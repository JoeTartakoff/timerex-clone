import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchCalendarEvents, calculateAvailableSlots } from '@/utils/calendar'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

console.log('=== ENVIRONMENT INFO ===')
console.log('NODE_ENV:', process.env.NODE_ENV)
console.log('VERCEL:', process.env.VERCEL)
console.log('VERCEL_ENV:', process.env.VERCEL_ENV)
console.log('Has GOOGLE_CLIENT_SECRET:', !!process.env.GOOGLE_CLIENT_SECRET)
console.log('Has NEXT_PUBLIC_GOOGLE_CLIENT_ID:', !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)
console.log('========================')

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

    let accessToken = tokens.access_token
    const expiresAt = new Date(tokens.expires_at)
    const now = new Date()
    
    if (expiresAt < now) {
      console.log('🔄 Token expired, attempting refresh...')
      const newAccessToken = await refreshAccessToken(tokens.refresh_token)
      
      if (!newAccessToken) {
        console.error('❌ Failed to refresh token')
        return null
      }
      
      console.log('✅ Token refreshed successfully')
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

    const timeMin = new Date(dateStart).toISOString()
    const timeMax = new Date(dateEnd + 'T23:59:59').toISOString()
    
    const events = await fetchCalendarEvents(accessToken, timeMin, timeMax)
    console.log(`✅ Fetched ${events.length} events for user:`, userId)

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

async function getAvailableSlotsForTeam(
  teamId: string,
  dateStart: string,
  dateEnd: string,
  slotDuration: number
) {
  console.log('=== getAvailableSlotsForTeam ===')
  console.log('Team ID:', teamId)
  
  try {
    const { data: members } = await supabaseAdmin
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .not('user_id', 'is', null)

    if (!members || members.length === 0) {
      console.log('❌ No team members found')
      return null
    }

    console.log(`✅ Found ${members.length} team members:`, members.map(m => m.user_id))

    const allMemberSlots = await Promise.all(
      members.map(member => 
        getAvailableSlotsForUser(
          member.user_id!,
          dateStart,
          dateEnd,
          slotDuration
        )
      )
    )

    console.log('✅ Fetched slots for all team members')

    const validSlots = allMemberSlots.filter(slots => slots !== null)

    console.log(`📊 Valid slots arrays: ${validSlots.length}`)

    if (validSlots.length === 0) {
      console.log('❌ No valid slots from any team member')
      return null
    }

    if (validSlots.length !== members.length) {
      console.log('⚠️ Some team members have no valid slots')
      console.log(`   Valid: ${validSlots.length} / Total: ${members.length}`)
      return null
    }

    console.log('🔍 Starting intersection calculation...')

    let commonSlots = validSlots[0]
    console.log(`   Step 0: Starting with ${commonSlots.length} slots from member 1`)

    for (let i = 1; i < validSlots.length; i++) {
      const memberSlots = validSlots[i]
      console.log(`   Step ${i}: Intersecting with member ${i + 1} (${memberSlots.length} slots)`)
      
      const beforeCount = commonSlots.length
      
      commonSlots = commonSlots.filter(commonSlot => {
        return memberSlots.some(memberSlot =>
          commonSlot.date === memberSlot.date &&
          commonSlot.startTime === memberSlot.startTime &&
          commonSlot.endTime === memberSlot.endTime
        )
      })
      
      console.log(`   Result: ${beforeCount} → ${commonSlots.length} common slots`)
    }

    console.log(`✅ FINAL: Team common slots = ${commonSlots.length}`)
    console.log('=== getAvailableSlotsForTeam COMPLETED ===\n')

    return commonSlots

  } catch (error) {
    console.error('❌ EXCEPTION in getAvailableSlotsForTeam:', error)
    if (error instanceof Error) {
      console.error('   Error name:', error.name)
      console.error('   Error message:', error.message)
      console.error('   Error stack:', error.stack)
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
    console.log('Is team schedule:', !!schedule.team_id)

    // ⭐ 병렬 처리로 속도 개선!
    console.log('🚀 Starting parallel fetch...')
    const startTime = Date.now()

    const [hostSlots, guestSlots, bookingsResult] = await Promise.all([
      schedule.team_id 
        ? getAvailableSlotsForTeam(
            schedule.team_id,
            schedule.date_range_start,
            schedule.date_range_end,
            schedule.time_slot_duration
          )
        : getAvailableSlotsForUser(
            schedule.user_id,
            schedule.date_range_start,
            schedule.date_range_end,
            schedule.time_slot_duration
          ),
      guestUserId 
        ? getAvailableSlotsForUser(
            guestUserId,
            schedule.date_range_start,
            schedule.date_range_end,
            schedule.time_slot_duration
          )
        : Promise.resolve(null),
      supabaseAdmin
        .from('bookings')
        .select('booking_date, start_time, end_time')
        .eq('schedule_id', scheduleId)
        .eq('status', 'confirmed')
    ])

    const parallelTime = Date.now() - startTime
    console.log(`⚡ Parallel fetch completed in ${parallelTime}ms`)

    console.log('📊 Host/Team slots result:', hostSlots ? `${hostSlots.length} slots` : 'null')
    console.log('📊 Guest slots result:', guestSlots ? `${guestSlots.length} slots` : 'not logged in')
    console.log('📊 Bookings result:', bookingsResult.data?.length || 0)

    if (!hostSlots) {
      console.log('❌ Failed to get slots')
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to get availability',
        useStaticSlots: true 
      })
    }

    let finalSlots = hostSlots

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
      
      console.log(`✅ Intersection: ${beforeCount} host/team + ${guestSlots.length} guest = ${finalSlots.length} common slots`)
    }

    // ⭐ 캘린더 확인 제거! DB만 신뢰!
    const validBookings = bookingsResult.data || []
    console.log(`✅ Using ${validBookings.length} confirmed bookings from DB`)

    // 예약된 시간 제외
    const availableSlots = finalSlots.filter(slot => {
      return !validBookings.some(
        booking =>
          booking.booking_date === slot.date &&
          booking.start_time === slot.startTime &&
          booking.end_time === slot.endTime
      )
    })

    console.log(`✅ Final available slots: ${availableSlots.length}`)
    
    const totalTime = Date.now() - startTime
    console.log(`⏱️ Total API time: ${totalTime}ms`)
    console.log('=== API COMPLETED SUCCESSFULLY ===')

    return NextResponse.json({ 
      success: true,
      slots: availableSlots,
      isGuestLoggedIn: !!guestUserId,
      isTeamSchedule: !!schedule.team_id,
      debug: {
        environment: process.env.VERCEL_ENV || 'local',
        hostSlotsCount: hostSlots.length,
        guestSlotsCount: guestSlots?.length || 0,
        bookingsCount: validBookings.length,
        finalSlotsCount: availableSlots.length,
        isTeamSchedule: !!schedule.team_id,
        executionTimeMs: totalTime,
        parallelFetchTimeMs: parallelTime,
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
