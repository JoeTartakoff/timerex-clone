import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const { membershipId, userId } = await request.json()

    console.log('🔄 API: Updating membership:', membershipId, '→', userId)

    const { data, error } = await supabaseAdmin
      .from('team_members')
      .update({ user_id: userId })
      .eq('id', membershipId)
      .select()

    if (error) {
      console.error('❌ API Error:', error)
      throw error
    }

    console.log('✅ API: Updated successfully:', data)

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error('❌ API Exception:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
