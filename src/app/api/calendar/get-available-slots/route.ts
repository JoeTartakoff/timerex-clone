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
    console.error('🔄 Error refreshing token:', error)
    return null
  }
}

async function fetchCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarType: string = 'unknown'
) {
  const allEvents: any[] = []
  let pageToken: string | undefined = undefined
  let pageCount = 0
  const maxPages = 10

  console.log(`📅 [${calendarType}] Starting to fetch calendar events...`)
  console.log(`📅 [${calendarType}] Time range:`, { timeMin, timeMax })

  do {
    try {
      pageCount++
      
      let url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
        `timeMin=${encodeURIComponent(timeMin)}&` +
        `timeMax=${encodeURIComponent(timeMax)}&` +
        `singleEvents=true&` +
        `orderBy=startTime&` +
        `maxResults=250`
      
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`
      }

      console.log(`📄 [${calendarType}] Fetching page ${pageCount}...`)

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      console.log(`📄 [${calendarType}] Page ${pageCount} response status:`, response.status)

      if (!response.ok) {
        const errorData = await response.json()
        console.error(`❌ [${calendarType}] Calendar API error:`, JSON.stringify(errorData, null, 2))
        throw new Error(`Failed to fetch calendar events: ${response.status}`)
      }

      const data = await response.json()
      const pageEvents = data.items || []
      
      console.log(`📄 [${calendarType}] Page ${pageCount}: ${pageEvents.length} events`)
      console.log(`📄 [${calendarType}] Has next page: ${!!data.nextPageToken}`)
      
      allEvents.push(...pageEvents)
      pageToken = data.nextPageToken

      if (pageCount >= maxPages) {
        console.warn(`⚠️ [${calendarType}] Reached max pages (${maxPages}), stopping`)
        break
      }
    } catch (error) {
      console.error(`❌ [${calendarType}] Error fetching page ${pageCount}:`, error)
      throw error
    }
  } while (pageToken)

  console.log(`✅ [${calendarType}] Total events fetched: ${allEvents.length}`)

  const formattedEvents = allEvents.map((item: any) => ({
    id: item.id,
    summary: item.summary || '予定',
    start: item.start.dateTime || item.start.date,
    end: item.end.dateTime || item.end.date,
  }))

  console.log(`✅ [${calendarType}] Formatted events: ${formattedEvents.length}`)
  
  return formattedEvents
}

function calculateAvailableSlots(
  events: any[],
  dateRangeStart: string,
  dateRangeEnd: string,
  slotDuration: number
) {
  const availableSlots: any[] = []
  const startDate = new Date(dateRangeStart)
  const endDate = new Date(dateRangeEnd)

  const workingHoursStart = '09:00'
  const workingHoursEnd = '18:00'
  const lunchStart = '12:00'
  const lunchEnd = '13:00'

  console.log('🔍 Calculating available slots...')
  console.log('🔍 Total events to check against:', events.length)

  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().split('T')[0]
    
    const dayEvents = events.filter(event => {
      const eventStart = new Date(event.start)
      const eventYear = eventStart.getFullYear()
      const eventMonth = String(eventStart.getMonth() + 1).padStart(2, '0')
      const eventDay = String(eventStart.getDate()).padStart(2, '0')
      const eventDateStr = `${eventYear}-${eventMonth}-${eventDay}`
      
      return eventDateStr === dateStr
    })

    const slots = generateTimeSlots(
      dateStr,
      workingHoursStart,
      workingHoursEnd,
      lunchStart,
      lunchEnd,
      slotDuration
    )

    slots.forEach(slot => {
      const slotStart = new Date(`${slot.date}T${slot.startTime}`)
      const slotEnd = new Date(`${slot.date}T${slot.endTime}`)

      const isAvailable = !dayEvents.some(event => {
        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        
        return (
          (slotStart >= eventStart && slotStart < eventEnd) ||
          (slotEnd > eventStart && slotEnd <= eventEnd) ||
          (slotStart <= eventStart && slotEnd >= eventEnd) ||
          (eventStart <= slotStart && eventEnd >= slotEnd)
        )
      })

      if (isAvailable) {
        availableSlots.push(slot)
      }
    })
  }

  console.log('✅ Available slots calculated:', availableSlots.length)
  return availableSlots
}

function generateTimeSlots(
  date: string,
  startTime: string,
  endTime: string,
  lunchStart: string,
  lunchEnd: string,
  duration: number
) {
  const slots: any[] = []
  const start = parseTime(startTime)
  const end = parseTime(endTime)
  const lunchStartMin = parseTime(lunchStart)
  const lunchEndMin = parseTime(lunchEnd)

  let current = start

  while (current + duration <= end) {
    const slotEnd = current + duration

    const overlapLunch = (
      (current >= lunchStartMin && current < lunchEndMin) ||
      (slotEnd > lunchStartMin && slotEnd <= lunchEndMin) ||
      (current <= lunchStartMin && slotEnd >= lunchEndMin)
    )

    if (!overlapLunch) {
      slots.push({
        date,
        startTime: formatTime(current),
        endTime: formatTime(slotEnd),
      })
    }

    current += duration
  }

  return slots
}

function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`
}

export async function POST(request: Request) {
  try {
    const { scheduleId, guestUserId } = await request.json()

    console.log('=== GET AVAILABLE SLOTS API ===')
    console.log('📋 Schedule ID:', scheduleId)
    console.log('👤 Guest User ID:', guestUserId)

    // 스케줄 정보 가져오기
    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('schedules')
      .select('*')
      .eq('id', scheduleId)
      .single()

    if (scheduleError) {
      console.error('❌ Schedule error:', scheduleError)
      throw scheduleError
    }

    console.log('✅ Schedule found:', schedule.title)
    console.log('📅 Schedule date range:', schedule.date_range_start, 'to', schedule.date_range_end)

    // 호스트 토큰 가져오기
    const { data: hostTokens, error: hostTokensError } = await supabaseAdmin
      .from('user_tokens')
      .select('*')
      .eq('user_id', schedule.user_id)
      .maybeSingle()

    if (hostTokensError || !hostTokens) {
      console.error('❌ No tokens found for host:', schedule.user_id)
      return NextResponse.json({ 
        success: false, 
        error: 'No host tokens found' 
      }, { status: 400 })
    }

    console.log('✅ Host tokens found')
    console.log('🔑 Host token expires at:', hostTokens.expires_at)

    // 호스트 토큰 갱신 확인
    let hostAccessToken = hostTokens.access_token
    const hostExpiresAt = new Date(hostTokens.expires_at)
    const now = new Date()
    
    console.log('⏰ Current time:', now.toISOString())
    console.log('⏰ Token expires at:', hostExpiresAt.toISOString())
    console.log('⏰ Token expired:', hostExpiresAt < now)
    
    if (hostExpiresAt < now) {
      console.log('🔄 Host token expired, refreshing...')
      const newToken = await refreshAccessToken(hostTokens.refresh_token)
      if (!newToken) {
        console.error('❌ Failed to refresh host token')
        return NextResponse.json({ 
          success: false, 
          error: 'Failed to refresh host token' 
        }, { status: 400 })
      }
      hostAccessToken = newToken

      await supabaseAdmin
        .from('user_tokens')
        .update({
          access_token: newToken,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', schedule.user_id)
      
      console.log('✅ Host token refreshed and saved')
    }

    // 호스트 캘린더 이벤트 가져오기
    const timeMin = new Date(schedule.date_range_start).toISOString()
    const timeMax = new Date(schedule.date_range_end + 'T23:59:59').toISOString()

    console.log('📅 Time range - timeMin:', timeMin, 'timeMax:', timeMax)
    console.log('📅 Fetching host calendar events...')
    
    const hostEvents = await fetchCalendarEvents(hostAccessToken, timeMin, timeMax, 'HOST')
    console.log('✅ Host events count:', hostEvents.length)

    let allEvents = [...hostEvents]

    // 게스트가 로그인한 경우 게스트 캘린더도 확인
    if (guestUserId) {
      console.log('👤 Guest user logged in, fetching guest calendar...')
      console.log('🔍 Looking for guest tokens with user_id:', guestUserId)
      
      const { data: guestTokens, error: guestTokensError } = await supabaseAdmin
        .from('user_tokens')
        .select('*')
        .eq('user_id', guestUserId)
        .maybeSingle()

      if (guestTokensError) {
        console.error('❌ Guest tokens query error:', guestTokensError)
      }
      
      console.log('🔍 Guest tokens found:', !!guestTokens)

      if (guestTokens) {
        console.log('✅ Guest tokens retrieved')
        console.log('🔑 Guest token expires at:', guestTokens.expires_at)
        
        let guestAccessToken = guestTokens.access_token
        const guestExpiresAt = new Date(guestTokens.expires_at)
        
        console.log('⏰ Guest token expired:', guestExpiresAt < now)
        
        if (guestExpiresAt < now) {
          console.log('🔄 Guest token expired, refreshing...')
          const newToken = await refreshAccessToken(guestTokens.refresh_token)
          if (newToken) {
            console.log('✅ Guest token refreshed successfully')
            guestAccessToken = newToken
            await supabaseAdmin
              .from('user_tokens')
              .update({
                access_token: newToken,
                expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', guestUserId)
          } else {
            console.error('❌ Failed to refresh guest token')
          }
        }

        try {
          console.log('📅 Fetching guest calendar events...')
          const guestEvents = await fetchCalendarEvents(guestAccessToken, timeMin, timeMax, 'GUEST')
          console.log('✅ Guest events count:', guestEvents.length)
          
          if (guestEvents.length > 0) {
            console.log('📝 Sample guest events:', guestEvents.slice(0, 3).map(e => ({
              summary: e.summary,
              start: e.start,
              end: e.end
            })))
          }
          
          allEvents = [...hostEvents, ...guestEvents]
          console.log('✅ Total events (host + guest):', allEvents.length)
        } catch (error) {
          console.error('❌ Failed to fetch guest events:', error)
        }
      } else {
        console.log('⚠️ No guest tokens found in database for user:', guestUserId)
      }
    } else {
      console.log('ℹ️ No guest user ID provided')
    }

    // 사용 가능한 슬롯 계산
    const availableSlots = calculateAvailableSlots(
      allEvents,
      schedule.date_range_start,
      schedule.date_range_end,
      schedule.time_slot_duration
    )

    console.log('✅ Available slots count:', availableSlots.length)
    console.log('=== API COMPLETED SUCCESSFULLY ===')

    return NextResponse.json({ 
      success: true,
      slots: availableSlots,
      isGuestLoggedIn: !!guestUserId,
      debug: {
        hostEventsCount: hostEvents.length,
        guestEventsCount: allEvents.length - hostEvents.length,
        totalEventsCount: allEvents.length,
        availableSlotsCount: availableSlots.length,
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
        error: errorMessage
      },
      { status: 500 }
    )
  }
}
