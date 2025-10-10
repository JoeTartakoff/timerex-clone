import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  try {
    console.log('=== TEST CALENDAR API ===')
    
    // 모든 토큰 조회
    const { data: allTokens, error: allError } = await supabaseAdmin
      .from('user_tokens')
      .select('*')

    if (allError) {
      return NextResponse.json({ error: 'Failed to fetch tokens', details: allError })
    }

    console.log('📊 Total tokens in database:', allTokens?.length || 0)

    if (!allTokens || allTokens.length === 0) {
      return NextResponse.json({ 
        error: 'No tokens found in database',
        message: 'Please log in first to save tokens'
      })
    }

    // 첫 번째 토큰으로 테스트
    const tokens = allTokens[0]
    console.log('🔑 Testing with user:', tokens.user_id)

    // 간단한 Calendar API 테스트
    const testUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5'
    
    const response = await fetch(testUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    })

    const data = await response.json()

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      tokenUserId: tokens.user_id,
      tokenExpiresAt: tokens.expires_at,
      tokenExpired: new Date(tokens.expires_at) < new Date(),
      eventsCount: data.items?.length || 0,
      hasError: !!data.error,
      error: data.error,
      sampleEvent: data.items?.[0],
      allTokensCount: allTokens.length,
      allUsers: allTokens.map(t => ({
        user_id: t.user_id,
        expires_at: t.expires_at,
        expired: new Date(t.expires_at) < new Date(),
      })),
    })
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
    })
  }
}