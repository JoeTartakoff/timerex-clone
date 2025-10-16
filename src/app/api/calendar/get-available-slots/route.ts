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
    console.log('📊 Raw results:', allMemberSlots.map((slots, i) => 
      `Member ${i + 1}: ${slots ? slots.length : 'null'} slots`
    ))

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
    console.log(`   Sample slot:`, commonSlots[0])

    for (let i = 1; i < validSlots.length; i++) {
      try {
        const memberSlots = validSlots[i]
        console.log(`\n   Step ${i}: Intersecting with member ${i + 1}`)
        console.log(`   Member ${i + 1} has ${memberSlots.length} slots`)
        console.log(`   Sample slot from member ${i + 1}:`, memberSlots[0])
        
        const beforeCount = commonSlots.length
        
        console.log(`   Starting filter operation...`)
        
        commonSlots = commonSlots.filter(commonSlot => {
          const found = memberSlots.some(memberSlot =>
            commonSlot.date === memberSlot.date &&
            commonSlot.startTime === memberSlot.startTime &&
            commonSlot.endTime === memberSlot.endTime
          )
          return found
        })
        
        console.log(`   Filter completed!`)
        console.log(`   Result: ${beforeCount} → ${commonSlots.length} common slots`)
        
        if (commonSlots.length > 0) {
          console.log(`   Sample common slot:`, commonSlots[0])
        } else {
          console.log(`   ⚠️ No common slots remaining!`)
        }
        
      } catch (error) {
        console.error(`   ❌ Error in step ${i}:`, error)
        throw error
      }
    }

    console.log(`\n✅ Loop completed successfully!`)
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

    let hostSlots
    
    if (schedule.team_id) {
      console.log('📅 Fetching team slots...')
      hostSlots = await getAvailableSlotsForTeam(
        schedule.team_id,
        schedule.date_range_start,
        schedule.date_range_end,
        schedule.time_slot_duration
      )
    } else {
      console.log('📅 Fetching host slots...')
      hostSlots = await getAvailableSlotsForUser(
        schedule.user_id,
        schedule.date_range_start,
        schedule.date_range_end,
        schedule.time_slot_duration
      )
    }

    console.log('📊 Host/Team slots result:', hostSlots ? `${hostSlots.length} slots` : 'null')

    if (!hostSlots) {
      console.log('❌ Failed to get slots')
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to get availability',
        useStaticSlots: true 
      })
    }

    let finalSlots = hostSlots

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
        
        console.log(`✅ Intersection: ${beforeCount} host/team + ${guestSlots.length} guest = ${finalSlots.length} common slots`)
      } else {
        console.log('⚠️ Failed to get guest slots, using host/team slots only')
      }
    }

    console.log('📊 Fetching existing bookings...')
    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from('bookings')
      .select('booking_date, start_time, end_time, host_calendar_event_id, assigned_user_id')
      .eq('schedule_id', scheduleId)
      .eq('status', 'confirmed')

    if (bookingsError) {
      console.error('⚠️ Bookings error:', bookingsError)
    } else {
      console.log(`📊 Found ${bookings?.length || 0} existing bookings`)
    }

    let validBookings: any[] = []
    if (bookings && bookings.length > 0) {
      console.log('🔍 Checking calendar events existence...')
      
      for (const booking of bookings) {
        console.log('📝 Processing booking:', booking)
        
        if (booking.host_calendar_event_id) {
          try {
            const userId = booking.assigned_user_id || schedule.user_id
            
            const { data: userTokens } = await supabaseAdmin
              .from('user_tokens')
              .select('access_token')
              .eq('user_id', userId)
              .single()

            if (userTokens?.access_token) {
              const eventResponse = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${booking.host_calendar_event_id}`,
                {
                  headers: {
                    'Authorization': `Bearer ${userTokens.access_token}`,
                  },
                }
              )

              console.log('🔎 Event check response status:', eventResponse.status)

              if (eventResponse.ok) {
                const eventData = await eventResponse.json()
                
                if (eventData.status !== 'cancelled') {
                  console.log('✅ Event exists:', booking.host_calendar_event_id)
                  validBookings.push(booking)
                } else {
                  console.log('⚠️ Event cancelled:', booking.host_calendar_event_id)
                }
              } else {
                console.log('⚠️ Event not found (status ' + eventResponse.status + '):', booking.host_calendar_event_id)
              }
            } else {
              validBookings.push(booking)
            }
          } catch (error) {
            console.log('⚠️ Error checking event:', error)
            validBookings.push(booking)
          }
        } else {
          validBookings.push(booking)
        }
      }
    }

    console.log(`✅ Valid bookings: ${validBookings.length} / ${bookings?.length || 0}`)

    const availableSlots = finalSlots.filter(slot => {
      return !validBookings.some(
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
      isTeamSchedule: !!schedule.team_id,
      debug: {
        environment: process.env.VERCEL_ENV || 'local',
        hostSlotsCount: hostSlots.length,
        guestSlotsCount: guestUserId ? (finalSlots.length === hostSlots.length ? 0 : 'calculated') : 'not logged in',
        bookingsCount: bookings?.length || 0,
        validBookingsCount: validBookings.length,
        finalSlotsCount: availableSlots.length,
        isTeamSchedule: !!schedule.team_id,
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
