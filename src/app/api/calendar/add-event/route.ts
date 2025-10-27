import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto' 
import { sendBookingNotifications } from '@/lib/sendgrid'

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
  eventData: Record<string, unknown>,
  conferenceDataVersion: number = 0
): Promise<Record<string, unknown>> {
  console.log('📅 Adding calendar event...')
  console.log('🎥 Conference data version:', conferenceDataVersion)
  
  const url = conferenceDataVersion > 0
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=${conferenceDataVersion}`
    : 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventData),
  })

  console.log('📅 Calendar API response status:', response.status)

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Calendar API error:', errorData)
    throw new Error('Failed to create calendar event')
  }

  const result = await response.json()
  console.log('✅ Calendar event created:', result.id)
  
  if (result.hangoutLink) {
    console.log('🎥 Google Meet link:', result.hangoutLink)
  }
  
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
  scheduleTitle: string,
  conferenceDataVersion: number = 0
): Promise<string[]> {
  console.log('\n👥 === ADDING EVENT TO ALL TEAM MEMBERS ===')
  console.log(`Team ID: ${teamId}`)
  console.log(`Assigned user: ${assignedUserEmail}`)
  console.log('🎥 Conference data version:', conferenceDataVersion)
  
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

        const event = await addCalendarEvent(accessToken, teamEventData, conferenceDataVersion)
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
  console.log('\n\n🚨 ============================================')
  console.log('🚨 ADD EVENT API CALLED!')
  console.log('🚨 ============================================\n')
  
  try {
    const body = await request.json()
    console.log('📦 Request body:', JSON.stringify(body, null, 2))

    const { scheduleId, bookingDate, startTime, endTime, guestName, guestEmail, guestUserId } = body

    console.log('\n=== ADD EVENT API START ===')
    console.log('📋 Request:', { scheduleId, bookingDate, startTime, endTime, guestName, guestEmail })
    console.log('👤 Guest User ID:', guestUserId || 'Not logged in')

    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('schedules')
      .select('title, user_id, team_id, assignment_method, create_meet_link')
      .eq('id', scheduleId)
      .single()

    if (scheduleError) {
      console.error('❌ Schedule error:', scheduleError)
      throw scheduleError
    }

    console.log('✅ Schedule found:', schedule.title)
    console.log('📊 Schedule type:', schedule.team_id ? 'Team' : 'Individual')
    console.log('📊 Assignment method:', schedule.assignment_method || 'N/A')
    console.log('🎥 Create Meet link:', schedule.create_meet_link || false)

    const [startHour, startMin] = startTime.split(':')
    const [endHour, endMin] = endTime.split(':')
    const startDateTime = `${bookingDate}T${startHour.padStart(2, '0')}:${startMin.padStart(2, '0')}:00`
    const endDateTime = `${bookingDate}T${endHour.padStart(2, '0')}:${endMin.padStart(2, '0')}:00`

    const hostEventData: Record<string, unknown> = {
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
      attendees: [{ email: guestEmail }],  // ⭐ 항상 게스트 추가
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    }

    if (schedule.create_meet_link) {
      console.log('🎥 Adding Google Meet conference data...')
      hostEventData.conferenceData = {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      }
    }

    const conferenceDataVersion = schedule.create_meet_link ? 1 : 0

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
        hostEventData,
        schedule.title,
        conferenceDataVersion
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
      const hostEvent = await addCalendarEvent(hostAccessToken, hostEventData, conferenceDataVersion)
      hostEventIds = [(hostEvent as { id: string }).id]
      console.log('✅ Host event created:', hostEventIds[0])
    }

    // ⭐⭐⭐ 게스트 이벤트 로직 완전 제거! ⭐⭐⭐
    let guestEventId: string | null = null
    
    if (guestUserId) {
      console.log('\n👤 === GUEST CALENDAR ===')
      console.log('✅ Guest is logged in')
      console.log('📧 Guest will receive calendar invitation from host')
      console.log('📧 Invitation email will be sent to:', guestEmail)
      if (schedule.create_meet_link) {
        console.log('🎥 Meet link will be included in the invitation')
      }
      // ⭐ 게스트 이벤트 생성 안 함!
      // 호스트 초대로 자동 처리됨
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
        console.log('   Guest event ID:', guestEventId || 'N/A (invitation only)')
        console.log('   Assigned user:', assignedUserId)
      }
    }




// ⭐⭐⭐ 메일 발송 추가 ⭐⭐⭐
console.log('\n📧 === SENDING EMAIL NOTIFICATIONS ===')

// 호스트 정보 조회
const { data: hostUser } = await supabaseAdmin
  .from('users')
  .select('name, email')
  .eq('id', assignedUserId)
  .single()

const hostName = hostUser?.name || hostUser?.email?.split('@')[0] || 'ホスト'
const hostEmail = hostUser?.email || ''

// Meet 링크 추출 (있는 경우)
let meetLink: string | undefined = undefined
if (schedule.create_meet_link && hostEventIds.length > 0) {
  try {
    const { data: hostTokens } = await supabaseAdmin
      .from('user_tokens')
      .select('access_token')
      .eq('user_id', assignedUserId)
      .single()

    if (hostTokens) {
      const eventResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${hostEventIds[0]}`,
        {
          headers: { 'Authorization': `Bearer ${hostTokens.access_token}` }
        }
      )

      if (eventResponse.ok) {
        const eventData = await eventResponse.json()
        meetLink = eventData.hangoutLink
        console.log('🎥 Meet link extracted:', meetLink)
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to extract Meet link:', error)
  }
}

// 메일 발송
try {
  const emailResult = await sendBookingNotifications({
    scheduleTitle: schedule.title,
    guestName,
    guestEmail,
    hostName,
    hostEmail: hostEmail || 'gogumatruck@gmail.com',
    bookingDate,
    startTime,
    endTime,
    meetLink,
    bookingMode: 'normal',
  })

  if (!emailResult.allSuccess) {
    console.warn('⚠️ Some emails failed to send, but booking completed')
  }
} catch (emailError) {
  console.error('⚠️ Email sending failed, but booking completed:', emailError)
  // 메일 실패해도 예약은 완료되도록 계속 진행
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
      hasMeetLink: schedule.create_meet_link || false,
    })
    
  } catch (error: unknown) {
    console.error('\n=== ADD EVENT API ERROR ===')
    console.error('Error type:', typeof error)
    console.error('Error:', error)
    
    if (error instanceof Error) {
      console.error('Message:', error.message)
      console.error('Stack:', error.stack)
    } else {
      console.error('Unknown error type:', JSON.stringify(error))
    }
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    )
  }
}
