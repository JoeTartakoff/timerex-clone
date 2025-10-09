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

async function addCalendarEvent(
  accessToken: string,
  eventData: Record<string, unknown>
): Promise<Record<string, unknown>> {
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

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Calendar API error:', errorData)
    throw new Error('Failed to create calendar event')
  }

  return await response.json()
}

export async function POST(request: Request) {
  try {
    const { scheduleId, bookingDate, startTime, endTime, guestName, guestEmail, guestUserId } = await request.json()

    console.log('Add event request:', { scheduleId, guestUserId })

    // 스케줄 정보와 호스트 정보 가져오기
    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('schedules')
      .select('title, user_id')
      .eq('id', scheduleId)
      .single()

    if (scheduleError) throw scheduleError

    // 호스트의 토큰 가져오기
    const { data: hostTokens, error: hostTokensError } = await supabaseAdmin
      .from('user_tokens')
      .select('*')
      .eq('user_id', schedule.user_id)
      .maybeSingle()

    if (hostTokensError || !hostTokens) {
      console.error('No tokens found for host')
      return NextResponse.json({ success: false, error: 'No host tokens' })
    }

    // 호스트 access token 갱신
    let hostAccessToken = hostTokens.access_token
    const hostExpiresAt = new Date(hostTokens.expires_at)
    if (hostExpiresAt < new Date()) {
      const newToken = await refreshAccessToken(hostTokens.refresh_token)
      if (!newToken) throw new Error('Failed to refresh host token')
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

    // 이벤트 데이터 생성
    const [startHour, startMin] = startTime.split(':')
    const [endHour, endMin] = endTime.split(':')
    const startDateTime = `${bookingDate}T${startHour.padStart(2, '0')}:${startMin.padStart(2, '0')}:00`
    const endDateTime = `${bookingDate}T${endHour.padStart(2, '0')}:${endMin.padStart(2, '0')}:00`

    const eventData = {
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
      attendees: [
        { email: guestEmail },
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    }

    // 호스트의 캘린더에 이벤트 추가
    console.log('Adding event to host calendar...')
    const hostEvent = await addCalendarEvent(hostAccessToken, eventData)
    console.log('Host event created:', (hostEvent as { id: string }).id)

    // 게스트가 로그인한 경우, 게스트의 캘린더에도 추가
    let guestEvent = null
    if (guestUserId) {
      console.log('Guest is logged in, adding to guest calendar...')
      
      const { data: guestTokens } = await supabaseAdmin
        .from('user_tokens')
        .select('*')
        .eq('user_id', guestUserId)
        .maybeSingle()

      if (guestTokens) {
        // 게스트 access token 갱신
        let guestAccessToken = guestTokens.access_token
        const guestExpiresAt = new Date(guestTokens.expires_at)
        if (guestExpiresAt < new Date()) {
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

        // 게스트용 이벤트 데이터 (설명 변경)
        const guestEventData = {
          ...eventData,
          summary: `${schedule.title}`,
          description: `ホストとの予定\n場所: ${schedule.title}`,
        }

        try {
          guestEvent = await addCalendarEvent(guestAccessToken, guestEventData)
          console.log('Guest event created:', (guestEvent as { id: string }).id)
        } catch (error) {
          console.error('Failed to add event to guest calendar:', error)
          // 게스트 캘린더 추가 실패해도 계속 진행
        }
      } else {
        console.log('No tokens found for guest')
      }
    }

    return NextResponse.json({ 
      success: true,
      hostEventId: (hostEvent as { id: string }).id,
      guestEventId: guestEvent ? (guestEvent as { id: string }).id : null,
      hostEventLink: (hostEvent as { htmlLink: string }).htmlLink,
      guestEventLink: guestEvent ? (guestEvent as { htmlLink: string }).htmlLink : null
    })
  } catch (error: unknown) {
    console.error('Error adding calendar event:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
