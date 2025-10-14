import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    console.log('=== GET GUEST PRESET ===')
    console.log('Token:', token)

    const { data, error } = await supabaseAdmin
      .from('guest_presets')
      .select('guest_name, guest_email')
      .eq('custom_token', token)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      )
    }

    console.log('✅ Found:', data.guest_name)

    return NextResponse.json({
      success: true,
      guestName: data.guest_name,
      guestEmail: data.guest_email,
    })
  } catch (error) {
    console.log('❌ Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch' },
      { status: 500 }
    )
  }
}
