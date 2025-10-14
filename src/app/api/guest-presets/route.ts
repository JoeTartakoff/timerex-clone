import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { nanoid } from 'nanoid'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: Request) {
  try {
    const { scheduleId, guests } = await request.json()

    console.log('=== SAVE GUEST PRESETS ===')
    console.log('Schedule ID:', scheduleId)
    console.log('Guests:', guests)

    const guestPresets = guests.map((guest: any) => ({
      schedule_id: scheduleId,
      guest_name: guest.name,
      guest_email: guest.email,
      custom_token: nanoid(10),
    }))

    const { data, error } = await supabaseAdmin
      .from('guest_presets')
      .insert(guestPresets)
      .select()

    if (error) throw error

    console.log('✅ Saved guest presets:', data.length)

    return NextResponse.json({ 
      success: true,
      guests: data 
    })
  } catch (error) {
    console.log('❌ Error:', error)
    return NextResponse.json(
      { error: 'Failed to save guest presets' },
      { status: 500 }
    )
  }
}
