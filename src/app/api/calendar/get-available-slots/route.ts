import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
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

    const data = await response.json()
    return data.access_token || null
  } catch (error) {
    console.error('Error refreshing token:', error)
    return null
  }
}

// ⭐ 새로운 페이지네이션 지원 함수
async function fetchCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
) {
  const allEvents: any[] = []
  let pageToken: string | undefined = undefined
  let pageCount = 0
  const maxPages = 10 // 무한 루프 방지

  console.log('🔍 Starting to fetch calendar events...')
  console.log('🔍 Time range:', { timeMin, timeMax })

  do {
    try {
      pageCount++
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
      url.searchParams.set('timeMin', timeMin)
      url.searchParams.set('timeMax', timeMax)
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('maxResults', '250') // ⭐ 최대값 설정
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken)
      }

      console.log(`🔍 Fetching page ${pageCount}...`)
      console.log(`🔍 URL: ${url.toString()}`)

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      console.log(`🔍 Page ${pageCount} response status:`, response.status)

      if (!response.ok) {
        const errorData = await response.json()
        console.error('🔍 Calendar API error details:', JSON.stringify(errorData, null, 2))
        throw new Error(`Failed to fetch calendar events: ${response.status}`)
      }

      const data = await response.json()
      const pageEvents = data.items || []
      
      console.log(`📄 Page ${pageCount}: ${pageEvents.length} events`)
      console.log(`📄 Has next page: ${!!data.nextPageToken}`)
      
      allEvents.push(...pageEvents)
      pageToken = data.nextPageToken

      if (pageCount >= maxPages) {
        console.warn(`⚠️ Reached max pages (${maxPages}), stopping`)
        break
      }
    } catch (error) {
      console.error(`❌ Error fetching page ${pageCount}:`, error)
      throw error
    }
  } while (pageToken)

  console.log(`✅ Total events fetched: ${allEvents.length}`)

  // 이벤트 변환
  const formattedEvents = allEvents.map((item: any) => ({
    id: item.id,
    summary: item.summary || '予定',
    start: item.start.dateTime || item.start.date,
    end: item.end.dateTime || item.end.date,
  }))

  console.log(`✅ Formatted events: ${formattedEvents.length}`)
  
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
    console.log('Schedule ID:', scheduleId)
    console.log('🔍 Guest User ID:', guestUserId)

    // 스케줄 정보 가져오기
    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('schedules')
      .select('*')
      .eq('id', scheduleId)
      .single()

    if (scheduleError) {
      console.error('Schedule error:', scheduleError)
      throw scheduleError
    }

    console.log('Schedule found:', schedule.title)
    console.log('🔍 Schedule date range:', schedule.date_range_start, 'to', schedule.date_range_end)

    // 호스트 토큰 가져오기
    const { data: hostTokens, error: hostTokensError } = await supabaseAdmin
      .from('user_tokens')
      .select('*')
      .eq('user_id', schedule.user_id)
      .maybeSingle()

    if (hostTokensError || !hostTokens) {
      console.error('No tokens found for host:', schedule.user_id)
      return NextResponse.json({ 
        success: false, 
        error: 'No host tokens found' 
      }, { status: 400 })
    }

    console.log('Host tokens found')

    // 호스트 토큰 갱신 확인
    let hostAccessToken = hostTokens.access_token
    const hostExpiresAt = new Date(hostTokens.expires_at)
    
    if (hostExpiresAt < new Date()) {
      console.log('Host token expired, refreshing...')
      const newToken = await refreshAccessToken(hostTokens.refresh_token)
      if (!newToken) {
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
    }

    // 호스트 캘린더 이벤트 가져오기
    const timeMin = new Date(schedule.date_range_start).toISOString()
    const timeMax = new Date(schedule.date_range_end + 'T23:59:59').toISOString()

    console.log('🔍 Time range - timeMin:', timeMin, 'timeMax:', timeMax)
    console.log('📅 Fetching host calendar events...')
    
    const hostEvents = await fetchCalendarEvents(hostAccessToken, timeMin, timeMax)
    console.log('🔍 Host events count:', hostEvents.length)

    let allEvents = [...hostEvents]

    // 게스트가 로그인한 경우 게스트 캘린더도 확인
    if (guestUserId) {
      console.log('📅 Fetching guest calendar events...')
      console.log('🔍 Looking for guest tokens with user_id:', guestUserId)
      
      const { data: guestTokens, error: guestTokensError } = await supabaseAdmin
        .from('user_tokens')
        .select('*')
        .eq('user_id', guestUserId)
        .maybeSingle()

      console.log('🔍 Guest tokens query error:', guestTokensError)
      console.log('🔍 Guest tokens found:', !!guestTokens)

      if (guestTokens) {
        console.log('🔍 Guest token expires at:', guestTokens.expires_at)
        
        let guestAccessToken = guestTokens.access_token
        const guestExpiresAt = new Date(guestTokens.expires_at)
        
        if (guestExpiresAt < new Date()) {
          console.log('🔍 Guest token expired, refreshing...')
          const newToken = await refreshAccessToken(guestTokens.refresh_token)
          if (newToken) {
            console.log('🔍 Guest token refreshed successfully')
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
            console.log('🔍 Failed to refresh guest token')
          }
        }

        try {
          const guestEvents = await fetchCalendarEvents(guestAccessToken, timeMin, timeMax)
          console.log('🔍 Guest events count:', guestEvents.length)
          console.log('🔍 Sample guest events:', guestEvents.slice(0, 2))
          allEvents = [...hostEvents, ...guestEvents]
          console.log('🔍 Total events (host + guest):', allEvents.length)
        } catch (error) {
          console.error('🔍 Failed to fetch guest events:', error)
        }
      } else {
        console.log('🔍 No guest tokens found in database for user:', guestUserId)
      }
    } else {
      console.log('🔍 No guest user ID provided')
    }

    // 사용 가능한 슬롯 계산
    const availableSlots = calculateAvailableSlots(
      allEvents,
      schedule.date_range_start,
      schedule.date_range_end,
      schedule.time_slot_duration
    )

    console.log('🔍 Available slots count:', availableSlots.length)

    return NextResponse.json({ 
      success: true,
      slots: availableSlots,
      isGuestLoggedIn: !!guestUserId
    })
  } catch (error: unknown) {
    console.error('=== API ERROR ===')
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error:', errorMessage)
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage
      },
      { status: 500 }
    )
  }
}
