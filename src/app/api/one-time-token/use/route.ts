import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json(
        { error: 'token is required' },
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

    console.log('🔒 Marking token as used:', token)

    // 토큰을 사용됨으로 표시
    const { error } = await supabase
      .from('one_time_tokens')
      .update({
        is_used: true,
        used_at: new Date().toISOString()
      })
      .eq('token', token)

    if (error) {
      console.error('❌ Error marking token as used:', error)
      throw error
    }

    console.log('✅ Token marked as used:', token)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('❌ Error in use token API:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to mark token as used' },
      { status: 500 }
    )
  }
}
