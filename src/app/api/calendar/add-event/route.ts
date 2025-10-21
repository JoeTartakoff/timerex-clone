import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

async function addCalendarEvent(
  accessToken: string,
  eventData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  console.log('📅 Adding calendar event...')
  
  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventData),
    }
  )

  console.log('📅 Calendar API response status:', response.status)

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Calendar API error:', errorData)
    throw new Error('Failed to create calendar event')
  }

  const result = await response.json()
  console.log('✅ Calendar event created:', result.id)
  return result
}

async function checkTeamMemberAvailability(
  userId: string,
  bookingDate: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  try {
    console.log(`\n🔍 === CHECKING AVAILABILITY ===`)
    console.log(`User ID: ${userId}`)
    console.log(`Date: ${bookingDate}`)
    console.log(`Time: ${startTime} - ${endTime}`)
    
    const { data: tokens, error: tokenError } = await supabaseAdmin
      .from('user_tokens')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (tokenError) {
      console.error(`❌ Token query error:`, tokenError)
      return false
    }

    if (!tokens) {
      console.log(`⚠️ No tokens for user ${userId}`)
      return false
    }

    console.log(`✅ Tokens found`)
    console.log(`   Expires at: ${tokens.expires_at}`)

    let accessToken = tokens.access_token
    const expiresAt = new Date(tokens.expires_at)
    const now = new Date()
    
    console.log(`   Current time: ${now.toISOString()}`)
    console.log(`   Token expired: ${expiresAt < now}`)
    
    if (expiresAt < now) {
      console.log(`🔄 Token expired, refreshing...`)
      const newToken = await refreshAccessToken(tokens.refresh_token)
      if (!newToken) {
        console.log(`❌ Failed to refresh token`)
        return false
      }
      accessToken = newToken
      console.log(`✅ Token refreshed`)
    }

    const [startHour, startMin] = startTime.split(':')
    const [endHour, endMin] = endTime.split(':')
    const timeMin = `${bookingDate}T${startHour.padStart(2, '0')}:${startMin.padStart(2, '0')}:00+09:00`
    const timeMax = `${bookingDate}T${endHour.padStart(2, '0')}:${endMin.padStart(2, '0')}:00+09:00`

    console.log(`📅 Checking calendar events:`)
    console.log(`   Time Min: ${timeMin}`)
    console.log(`   Time Max: ${timeMax}`)

    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      `timeMin=${encodeURIComponent(timeMin)}&` +
      `timeMax=${encodeURIComponent(timeMax)}&` +
      `singleEvents=true`
    
    console.log(`   URL: ${calendarUrl}`)

    const response = await fetch(calendarUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    console.log(`📡 Calendar API response status: ${response.status}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Calendar API error:`, errorText)
      return false
    }

    const data = await response.json()
    console.log(`📊 Events found: ${data.items?.length || 0}`)
    
    if (data.items && data.items.length > 0) {
      console.log(`📋 Event details:`)
      data.items.forEach((event: any, index: number) => {
        console.log(`   ${index + 1}. ${event.summary || '(No title)'}`)
        console.log(`      Start: ${event.start?.dateTime || event.start?.date}`)
        console.log(`      End: ${event.end?.dateTime || event.end?.date}`)
        console.log(`      Status: ${event.status}`)
      })
    }

    const hasConflict = data.items && data.items.length > 0

    console.log(`\n${hasConflict ? '❌ BUSY' : '✅ AVAILABLE'}`)
    console.log(`=== END AVAILABILITY CHECK ===\n`)
    
    return !hasConflict

  } catch (error) {
    console.error(`❌ Exception in checkTeamMemberAvailability:`, error)
    return false
  }
}

async function assignTeamMemberRoundRobin(
  scheduleId: string,
  teamId: string,
  bookingDate: string,
  startTime: string,
  endTime: string
): Promise<string | null> {
  try {
    console.log('🔄 === ROUND ROBIN ASSIGNMENT START ===')
    console.log(`📋 Schedule ID: ${scheduleId}`)
    console.log(`👥 Team ID: ${teamId}`)
    
    const { data: members } = await supabaseAdmin
      .from('team_members')
      .select('user_id, email')
      .eq('team_id', teamId)
      .not('user_id', 'is', null)
      .order('joined_at', { ascending: true })

    if (!members || members.length === 0) {
      console.log('❌ No team members found')
      return null
    }

    console.log(`✅ Found ${members.length} team members:`)
    members.forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.email} (${m.user_id})`)
    })

    const { data: rrState, error: rrStateError } = await supabaseAdmin
      .from('round_robin_state')
      .select('last_assigned_user_id')
      .eq('schedule_id', scheduleId)
      .maybeSingle()

    if (rrStateError) {
      console.error('⚠️ Error fetching RR state:', rrStateError)
    }

    console.log('📊 Current RR state:', rrState)

    let startIndex = 0
    if (rrState?.last_assigned_user_id) {
      const lastIndex = members.findIndex(m => m.user_id === rrState.last_assigned_user_id)
      if (lastIndex >= 0) {
        startIndex = (lastIndex + 1) % members.length
        console.log(`⏭️ Last assigned: ${rrState.last_assigned_user_id} (index ${lastIndex})`)
        console.log(`🎯 Starting from index: ${startIndex}`)
      } else {
        console.log('⚠️ Last assigned user not found in current members, starting from 0')
      }
    } else {
      console.log('🆕 No previous assignment, starting from index 0')
    }

    for (let i = 0; i < members.length; i++) {
      const currentIndex = (startIndex + i) % members.length
      const currentMember = members[currentIndex]
      
      console.log(`\n🔍 Checking member ${i + 1}/${members.length}:`)
      console.log(`   Index: ${currentIndex}`)
      console.log(`   Email: ${currentMember.email}`)
      console.log(`   User ID: ${currentMember.user_id}`)

      const isAvailable = await checkTeamMemberAvailability(
        currentMember.user_id!,
        bookingDate,
        startTime,
        endTime
      )

      if (isAvailable) {
        console.log(`\n✅ ASSIGNED TO: ${currentMember.email} (${currentMember.user_id})`)
        
        console.log('💾 Updating round_robin_state...')
        const { data: rrUpdate, error: rrError } = await supabaseAdmin
          .from('round_robin_state')
          .upsert({
            schedule_id: scheduleId,
            last_assigned_user_id: currentMember.user_id,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'schedule_id'
          })
          .select()

        if (rrError) {
          console.error('❌ Failed to update round_robin_state:', rrError)
        } else {
          console.log('✅ Round Robin state updated')
        }

        console.log('🔄 === ROUND ROBIN ASSIGNMENT COMPLETED ===\n')
        return currentMember.user_id!
      } else {
        console.log(`   ❌ Not available, trying next member...`)
      }
    }

    console.log('\n❌ No available team member found')
    console.log('🔄 === ROUND ROBIN ASSIGNMENT FAILED ===\n')
    return null

  } catch (error) {
    console.error('❌ Error in Round Robin assignment:', error)
    return null
  }
}

async function addEventToAllTeamMembers(
  teamId: string,
  assignedUserId: string,
  assignedUserEmail: string,
  eventData: Record<string, unknown>,
  scheduleTitle: string
): Promise<string[]> {
  console.log('\n👥 === ADDING EVENT TO ALL TEAM MEMBERS ===')
  console.log(`Team ID: ${teamId}`)
  console.log(`Assigned user: ${assignedUserEmail}`)
  
  try {
    const { data: members } = await supabaseAdmin
      .from('team_members')
      .select('user_id, email')
      .eq('team_id', teamId)
      .not('user_id', 'is', null)

    if (!members || members.length === 0) {
      console.log('❌ No team members found')
      return []
    }

    console.log(`✅ Found ${members.length} team members`)
    
    const eventIds: string[] = []
    let successCount = 0
    let failCount = 0

    for (const member of members) {
      console.log(`\n📅 Adding event for: ${member.email}`)
      
      try {
        const { data: tokens, error: tokenError } = await supabaseAdmin
          .from('user_tokens')
          .select('*')
          .eq('user_id', member.user_id)
          .maybeSingle()

        if (tokenError || !tokens) {
          console.log(`⚠️ No tokens for ${member.email}, skipping...`)
          failCount++
          continue
        }

        let accessToken = tokens.access_token
        const expiresAt = new Date(tokens.expires_at)
        
        if (expiresAt < new Date()) {
          console.log(`🔄 Token expired, refreshing...`)
          const newToken = await refreshAccessToken(tokens.refresh_token)
          if (!newToken) {
            console.log(`❌ Failed to refresh token for ${member.email}`)
            failCount++
            continue
          }
          accessToken = newToken
          
          await supabaseAdmin
            .from('user_tokens')
            .update({
              access_token: newToken,
              expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', member.user_id)
        }

        const teamEventData = {
          ...eventData,
          summary: `[팀] ${scheduleTitle}`,
          description: `담당자: ${assignedUserEmail}\n\n${eventData.description || ''}`
        }

        const event = await addCalendarEvent(accessToken, teamEventData)
        const eventId = (event as { id: string }).id
        
        eventIds.push(eventId)
        successCount++
        console.log(`✅ Event added for ${member.email}: ${eventId}`)
        
      } catch (error) {
        console.error(`❌ Failed to add event for ${member.email}:`, error)
        failCount++
      }
    }

    console.log(`\n📊 Summary:`)
    console.log(`   Total members: ${members.length}`)
    console.log(`   Success: ${successCount}`)
    console.log(`   Failed: ${failCount}`)
    console.log(`   Event IDs: ${eventIds.length}`)
    console.log('👥 === ALL TEAM MEMBERS PROCESSING COMPLETED ===\n')

    return eventIds

  } catch (error) {
    console.error('❌ Error in addEventToAllTeamMembers:', error)
    return []
  }
}

export async function POST(request: Request) {
  try {
    const { scheduleId, bookingDate, startTime, endTime, guestName, guestEmail, guestUserId } = await request.json()

    console.log('=== ADD EVENT API START ===')
    console.log('📋 Request:', { scheduleId, bookingDate, startTime, endTime, guestName, guestEmail })
    console.log('👤 Guest User ID:', guestUserId || 'Not logged in')

    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('schedules')
      .select('title, user_id, team_id, assignment_method')
      .eq('id', scheduleId)
      .single()

    if (scheduleError) {
      console.error('❌ Schedule error:', scheduleError)
      throw scheduleError
    }

    console.log('✅ Schedule found:', schedule.title)
    console.log('📊 Schedule type:', schedule.team_id ? 'Team' : 'Individual')
    console.log('📊 Assignment method:', schedule.assignment_method || 'N/A')

    const [startHour, startMin] = startTime.split(':')
    const [endHour, endMin] = endTime.split(':')
    const startDateTime = `${bookingDate}T${startHour.padStart(2, '0')}:${startMin.padStart(2, '0')}:00`
    const endDateTime = `${bookingDate}T${endHour.padStart(2, '0')}:${endMin.padStart(2, '0')}:00`

    // ⭐ baseEventData → hostEventData로 변경
    const hostEventData = {
      summary: `${schedule.title} - ${guestName}`,
      description: `予約者: ${guestName}\nメール: ${guestEmail}`,
      start: {
        dateTime: startDateTime,
        timeZone: 'Asia/Tokyo',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Asia/Tokyo',
      },
      attendees: guestUserId ? [] : [{ email: guestEmail }],  // ⭐ 조건부 변경
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    }

    let assignedUserId = schedule.user_id
    let assignedUserEmail = ''
    let hostEventIds: string[] = []
    
    if (schedule.team_id && schedule.assignment_method === 'round_robin') {
      console.log('\n🔄 === TEAM SCHEDULE DETECTED ===')
      
      const teamMemberId = await assignTeamMemberRoundRobin(
        scheduleId,
        schedule.team_id,
        bookingDate,
        startTime,
        endTime
      )

      if (!teamMemberId) {
        console.log('❌ No available team member')
        return NextResponse.json({ 
          success: false, 
          error: 'この時間帯に対応可能なチームメンバーがいません' 
        }, { status: 400 })
      }

      assignedUserId = teamMemberId
      
      const { data: assignedMember } = await supabaseAdmin
        .from('team_members')
        .select('email')
        .eq('user_id', assignedUserId)
        .single()
      
      assignedUserEmail = assignedMember?.email || ''
      console.log(`✅ Assigned to: ${assignedUserEmail}`)

      console.log('\n👥 Adding event to all team members...')
      hostEventIds = await addEventToAllTeamMembers(
        schedule.team_id,
        assignedUserId,
        assignedUserEmail,
        hostEventData,  // ⭐ 변경
        schedule.title
      )

      if (hostEventIds.length === 0) {
        console.log('❌ Failed to add event to any team member')
        return NextResponse.json({ 
          success: false, 
          error: 'チームメンバーのカレンダーへの追加に失敗しました' 
        }, { status: 500 })
      }

      console.log(`✅ Events added to ${hostEventIds.length} team members`)
      
    } else {
      console.log('\n👤 === INDIVIDUAL SCHEDULE ===')
      
      const { data: hostTokens, error: hostTokensError } = await supabaseAdmin
        .from('user_tokens')
        .select('*')
        .eq('user_id', assignedUserId)
        .maybeSingle()

      if (hostTokensError || !hostTokens) {
        console.error('❌ No tokens found for host')
        return NextResponse.json({ 
          success: false, 
          error: 'ホストのトークンが見つかりません' 
        }, { status: 400 })
      }

      console.log('✅ Host tokens found')

      let hostAccessToken = hostTokens.access_token
      const hostExpiresAt = new Date(hostTokens.expires_at)
      
      if (hostExpiresAt < new Date()) {
        console.log('🔄 Token expired, refreshing...')
        const newToken = await refreshAccessToken(hostTokens.refresh_token)
        if (!newToken) {
          throw new Error('Failed to refresh token')
        }
        hostAccessToken = newToken

        await supabaseAdmin
          .from('user_tokens')
          .update({
            access_token: newToken,
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', assignedUserId)
      }

      console.log('📅 Adding event to host calendar...')
      const hostEvent = await addCalendarEvent(hostAccessToken, hostEventData)  // ⭐ 변경
      hostEventIds = [(hostEvent as { id: string }).id]
      console.log('✅ Host event created:', hostEventIds[0])
    }

    let guestEventId: string | null = null
    
    if (guestUserId) {
      console.log('\n👤 === GUEST CALENDAR ===')
      console.log('Guest is logged in, adding to guest calendar...')
      
      const { data: guestTokens } = await supabaseAdmin
        .from('user_tokens')
        .select('*')
        .eq('user_id', guestUserId)
        .maybeSingle()

      if (guestTokens) {
        console.log('✅ Guest tokens found')
        
        let guestAccessToken = guestTokens.access_token
        const guestExpiresAt = new Date(guestTokens.expires_at)
        
        if (guestExpiresAt < new Date()) {
          console.log('🔄 Guest token expired, refreshing...')
          const newToken = await refreshAccessToken(guestTokens.refresh_token)
          if (newToken) {
            guestAccessToken = newToken
            await supabaseAdmin
              .from('user_tokens')
              .update({
                access_token: newToken,
                expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', guestUserId)
          }
        }

        // ⭐ 게스트 전용 이벤트 데이터 (독립적)
        const guestEventData = {
          summary: `${schedule.title}`,
          description: schedule.team_id 
            ? `チームとの予定\n担当者: ${assignedUserEmail}`
            : `ホストとの予定`,
          start: {
            dateTime: startDateTime,
            timeZone: 'Asia/Tokyo',
          },
          end: {
            dateTime: endDateTime,
            timeZone: 'Asia/Tokyo',
          },
          attendees: [],  // ⭐ attendees 없음!
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 24 * 60 },
              { method: 'popup', minutes: 30 },
            ],
          },
        }

        try {
          console.log('📅 Adding event to guest calendar...')
          const guestEvent = await addCalendarEvent(guestAccessToken, guestEventData)
          guestEventId = (guestEvent as { id: string }).id
          console.log('✅ Guest event created:', guestEventId)
        } catch (error) {
          console.error('⚠️ Failed to add event to guest calendar:', error)
        }
      } else {
        console.log('⚠️ Guest tokens not found')
      }
    }

    console.log('\n💾 === UPDATING DATABASE ===')
    
    const { data: targetBooking } = await supabaseAdmin
      .from('bookings')
      .select('id')
      .eq('schedule_id', scheduleId)
      .eq('booking_date', bookingDate)
      .eq('start_time', startTime)
      .eq('end_time', endTime)
      .eq('guest_email', guestEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    console.log('🔍 Found booking to update:', targetBooking?.id)

    if (targetBooking) {
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          host_calendar_event_id: hostEventIds[0],
          guest_calendar_event_id: guestEventId,
          assigned_user_id: assignedUserId,
        })
        .eq('id', targetBooking.id)

      if (updateError) {
        console.error('❌ Failed to update booking:', updateError)
      } else {
        console.log('✅ Successfully updated booking')
        console.log('   Host event ID:', hostEventIds[0])
        console.log('   Guest event ID:', guestEventId || 'N/A')
        console.log('   Assigned user:', assignedUserId)
      }
    }

    console.log('\n=== ADD EVENT API COMPLETED SUCCESSFULLY ===\n')

    return NextResponse.json({ 
      success: true,
      hostEventIds,
      guestEventId,
      assignedUserId,
      assignedUserEmail: schedule.team_id ? assignedUserEmail : undefined,
      isTeamSchedule: !!schedule.team_id,
      teamMembersCount: schedule.team_id ? hostEventIds.length : undefined,
    })
    
  } catch (error: unknown) {
    console.error('\n=== ADD EVENT API ERROR ===')
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error:', errorMessage)
    if (error instanceof Error && error.stack) {
      console.error('Stack:', error.stack)
    }
    
    return NextResponse.json(
      { 
        success: false,
        error: errorMessage 
      },
      { status: 500 }
    )
  }
}
