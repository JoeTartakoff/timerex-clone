import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const { scheduleId } = await request.json()

    if (!scheduleId) {
      return NextResponse.json(
        { error: 'scheduleId is required' },
        { status: 400 }
      )
    }

    // ⭐ Supabase Service Role Client 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // 토큰 생성
    const token = crypto.randomUUID()

    console.log('🔑 Creating token for schedule:', scheduleId)

    // DB에 저장
    const { data, error } = await supabase
      .from('one_time_tokens')
      .insert({
        token,
        schedule_id: scheduleId,
        is_used: false,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24시간 후 만료
      })
      .select()
      .single()

    if (error) {
      console.error('❌ Error creating token:', error)
      throw error
    }

    console.log('✅ One-time token created:', token)

    return NextResponse.json({ token })
  } catch (error: any) {
    console.error('❌ Error in create token API:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create token' },
      { status: 500 }
    )
  }
}
