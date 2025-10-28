import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
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

async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<boolean> {
  try {
    console.log('🗑️ Deleting calendar event:', eventId)
    
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    )

    console.log('🗑️ Delete response status:', response.status)

    if (response.status === 204 || response.status === 410) {
      console.log('✅ Calendar event deleted successfully')
      return true
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Calendar API error:', errorText)
      return false
    }

    return true
  } catch (error) {
    console.error('❌ Error deleting calendar event:', error)
    return false
  }
}

export async function POST(request: Request) {
  console.log('\n\n🚨 ============================================')
  console.log('🚨 DELETE EVENT API CALLED!')
  console.log('🚨 ============================================\n')
  
  try {
    const body = await request.json()
    console.log('📦 Request body:', JSON.stringify(body, null, 2))

    const { bookingId, responseId, type } = body

    console.log('\n=== DELETE EVENT API START ===')
    console.log('📋 Type:', type)
    console.log('📋 Booking ID:', bookingId)
    console.log('📋 Response ID:', responseId)

    let hostDeleted = false
    let guestDeleted = false
    let hostUserId = null
    let schedule = null

    // 통상모드
    if (type === 'booking' && bookingId) {
      console.log('\n🔵 === NORMAL MODE CANCELLATION ===')
      
      const { data: booking, error: bookingError } = await supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single()

      if (bookingError || !booking) {
        console.error('❌ Booking not found:', bookingError)
        throw new Error('予約が見つかりません')
      }

      console.log('✅ Booking found:', booking.guest_name)
      console.log('🎫 Host event ID:', booking.host_calendar_event_id)
      console.log('🎫 Guest event ID:', booking.guest_calendar_event_id)

      const { data: scheduleData } = await supabaseAdmin
        .from('schedules')
        .select('id, title, user_id, team_id')
        .eq('id', booking.schedule_id)
        .single()

      schedule = scheduleData
      hostUserId = booking.assigned_user_id || schedule?.user_id

      if (booking.host_calendar_event_id && hostUserId) {
        const { data: hostTokens } = await supabaseAdmin
          .from('user_tokens')
          .select('*')
          .eq('user_id', hostUserId)
          .maybeSingle()

        if (hostTokens) {
          let hostAccessToken = hostTokens.access_token
          const hostExpiresAt = new Date(hostTokens.expires_at)
          
          if (hostExpiresAt < new Date()) {
            const newToken = await refreshAccessToken(hostTokens.refresh_token)
            if (newToken) {
              hostAccessToken = newToken
              await supabaseAdmin
                .from('user_tokens')
                .update({
                  access_token: newToken,
                  expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('user_id', hostUserId)
            }
          }

          if (hostAccessToken) {
            hostDeleted = await deleteCalendarEvent(
              hostAccessToken,
              booking.host_calendar_event_id
            )
          }
        }
      }

      if (booking.guest_calendar_event_id && booking.guest_user_id) {
        const { data: guestTokens } = await supabaseAdmin
          .from('user_tokens')
          .select('*')
          .eq('user_id', booking.guest_user_id)
          .maybeSingle()

        if (guestTokens) {
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
                .eq('user_id', booking.guest_user_id)
            }
          }

          if (guestAccessToken) {
            guestDeleted = await deleteCalendarEvent(
              guestAccessToken,
              booking.guest_calendar_event_id
            )
          }
        }
      }

      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)

      if (updateError) {
        console.error('❌ Failed to update booking:', updateError)
        throw updateError
      }

      console.log('✅ Booking status updated to cancelled')
    }

    // 후보시간제시/후보일받기 모드
    if (type === 'response' && responseId) {
      console.log('\n🟣 === CANDIDATE/INTERVIEW MODE CANCELLATION ===')
      
      const { data: response, error: responseError } = await supabaseAdmin
        .from('guest_responses')
        .select('*')
        .eq('id', responseId)
        .single()

      if (responseError || !response) {
        console.error('❌ Response not found:', responseError)
        throw new Error('応答が見つかりません')
      }

      if (!response.is_confirmed) {
        throw new Error('この応答はまだ確定されていません')
      }

      console.log('✅ Response found:', response.guest_name)
      console.log('📅 Confirmed slot:', JSON.stringify(response.confirmed_slot, null, 2))

      const { data: scheduleData } = await supabaseAdmin
        .from('schedules')
        .select('id, title, user_id, team_id')
        .eq('id', response.schedule_id)
        .single()

      schedule = scheduleData
      hostUserId = schedule?.user_id

      if (response.confirmed_slot) {
        console.log('\n🔍 Searching for related booking...')
        console.log('   schedule_id:', response.schedule_id)
        console.log('   guest_email:', response.guest_email)
        console.log('   booking_date:', response.confirmed_slot.date)
        console.log('   start_time:', response.confirmed_slot.startTime)
        console.log('   end_time:', response.confirmed_slot.endTime)

        const { data: relatedBooking, error: bookingError } = await supabaseAdmin
          .from('bookings')
          .select('*')
          .eq('schedule_id', response.schedule_id)
          .eq('guest_email', response.guest_email)
          .eq('booking_date', response.confirmed_slot.date)
          .eq('start_time', response.confirmed_slot.startTime)
          .eq('end_time', response.confirmed_slot.endTime)
          .eq('status', 'confirmed')
          .maybeSingle()

        if (bookingError) {
          console.error('❌ Error searching for booking:', bookingError)
        }

        if (!relatedBooking) {
          console.log('⚠️ No exact match found, trying broader search...')
          
          const { data: allBookings } = await supabaseAdmin
            .from('bookings')
            .select('*')
            .eq('schedule_id', response.schedule_id)
            .eq('guest_email', response.guest_email)
            .eq('status', 'confirmed')
          
          console.log('📋 All confirmed bookings for this guest:', allBookings?.length || 0)
          
          if (allBookings && allBookings.length > 0) {
            console.log('📋 Booking details:')
            allBookings.forEach((b, i) => {
              console.log(`   ${i + 1}. Date: ${b.booking_date}, Time: ${b.start_time}-${b.end_time}`)
              console.log(`      Host event: ${b.host_calendar_event_id}`)
              console.log(`      Guest event: ${b.guest_calendar_event_id}`)
            })
            
            // 첫 번째 예약을 사용 (가장 최근 확정)
            const booking = allBookings[0]
            console.log('⚠️ Using first booking as fallback')
            
            if (booking.host_calendar_event_id && hostUserId) {
              const { data: hostTokens } = await supabaseAdmin
                .from('user_tokens')
                .select('*')
                .eq('user_id', hostUserId)
                .maybeSingle()

              if (hostTokens) {
                let hostAccessToken = hostTokens.access_token
                const hostExpiresAt = new Date(hostTokens.expires_at)
                
                if (hostExpiresAt < new Date()) {
                  const newToken = await refreshAccessToken(hostTokens.refresh_token)
                  if (newToken) {
                    hostAccessToken = newToken
                    await supabaseAdmin
                      .from('user_tokens')
                      .update({
                        access_token: newToken,
                        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                        updated_at: new Date().toISOString(),
                      })
                      .eq('user_id', hostUserId)
                  }
                }

                if (hostAccessToken) {
                  hostDeleted = await deleteCalendarEvent(
                    hostAccessToken,
                    booking.host_calendar_event_id
                  )
                }
              }
            }

            if (booking.guest_calendar_event_id && booking.guest_user_id) {
              const { data: guestTokens } = await supabaseAdmin
                .from('user_tokens')
                .select('*')
                .eq('user_id', booking.guest_user_id)
                .maybeSingle()

              if (guestTokens) {
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
                      .eq('user_id', booking.guest_user_id)
                  }
                }

                if (guestAccessToken) {
                  guestDeleted = await deleteCalendarEvent(
                    guestAccessToken,
                    booking.guest_calendar_event_id
                  )
                }
              }
            }

            await supabaseAdmin
              .from('bookings')
              .update({ status: 'cancelled' })
              .eq('id', booking.id)
          } else {
            console.log('❌ No bookings found at all for this guest/schedule')
          }
        } else {
          console.log('✅ Found exact match booking:', relatedBooking.id)
          console.log('🎫 Host event ID:', relatedBooking.host_calendar_event_id)
          console.log('🎫 Guest event ID:', relatedBooking.guest_calendar_event_id)

          if (relatedBooking.host_calendar_event_id && hostUserId) {
            const { data: hostTokens } = await supabaseAdmin
              .from('user_tokens')
              .select('*')
              .eq('user_id', hostUserId)
              .maybeSingle()

            if (hostTokens) {
              let hostAccessToken = hostTokens.access_token
              const hostExpiresAt = new Date(hostTokens.expires_at)
              
              if (hostExpiresAt < new Date()) {
                const newToken = await refreshAccessToken(hostTokens.refresh_token)
                if (newToken) {
                  hostAccessToken = newToken
                  await supabaseAdmin
                    .from('user_tokens')
                    .update({
                      access_token: newToken,
                      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                      updated_at: new Date().toISOString(),
                    })
                    .eq('user_id', hostUserId)
                }
              }

              if (hostAccessToken) {
                hostDeleted = await deleteCalendarEvent(
                  hostAccessToken,
                  relatedBooking.host_calendar_event_id
                )
              }
            }
          }

          if (relatedBooking.guest_calendar_event_id && relatedBooking.guest_user_id) {
            const { data: guestTokens } = await supabaseAdmin
              .from('user_tokens')
              .select('*')
              .eq('user_id', relatedBooking.guest_user_id)
              .maybeSingle()

            if (guestTokens) {
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
                    .eq('user_id', relatedBooking.guest_user_id)
                }
              }

              if (guestAccessToken) {
                guestDeleted = await deleteCalendarEvent(
                  guestAccessToken,
                  relatedBooking.guest_calendar_event_id
                )
              }
            }
          }

          await supabaseAdmin
            .from('bookings')
            .update({ status: 'cancelled' })
            .eq('id', relatedBooking.id)
        }
      }

      const { error: updateError } = await supabaseAdmin
        .from('guest_responses')
        .update({
          is_confirmed: false,
          confirmed_slot: null
        })
        .eq('id', responseId)

      if (updateError) {
        console.error('❌ Failed to update response:', updateError)
        throw updateError
      }

      console.log('✅ Response status updated to unconfirmed')
    }

    console.log('\n=== DELETE EVENT API COMPLETED ===')
    console.log('📊 Summary:')
    console.log('   Host event deleted:', hostDeleted)
    console.log('   Guest event deleted:', guestDeleted)

    return NextResponse.json({ 
      success: true,
      hostDeleted,
      guestDeleted,
      message: '予約をキャンセルしました'
    })
    
  } catch (error: unknown) {
    console.error('\n=== DELETE EVENT API ERROR ===')
    console.error('Error type:', typeof error)
    console.error('Error:', error)
    
    if (error instanceof Error) {
      console.error('Message:', error.message)
      console.error('Stack:', error.stack)
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
