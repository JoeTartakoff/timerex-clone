import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json(
        { valid: false, message: 'トークンが必要です' },
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

    console.log('🔍 Verifying token:', token)

    // 토큰 조회
    const { data, error } = await supabase
      .from('one_time_tokens')
      .select('*')
      .eq('token', token)
      .single()

    if (error || !data) {
      console.log('❌ Token not found:', token)
      return NextResponse.json(
        { valid: false, message: 'トークンが無効です' },
        { status: 404 }
      )
    }

    // 이미 사용됨
    if (data.is_used) {
      console.log('⚠️ Token already used:', token)
      return NextResponse.json(
        { valid: false, message: 'このリンクは既に使用されました' },
        { status: 403 }
      )
    }

    // 만료됨
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      console.log('⚠️ Token expired:', token)
      return NextResponse.json(
        { valid: false, message: 'このリンクは期限切れです（24時間経過）' },
        { status: 403 }
      )
    }

    // 유효함
    console.log('✅ Token valid:', token)
    return NextResponse.json({
      valid: true,
      scheduleId: data.schedule_id
    })
  } catch (error: any) {
    console.error('❌ Error in verify token API:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to verify token' },
      { status: 500 }
    )
  }
}
