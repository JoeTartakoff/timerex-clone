import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  console.log('=== Auth Callback ===')
  console.log('Code:', code ? 'exists' : 'missing')
  console.log('Request URL:', requestUrl.href)

  if (code) {
    const cookieStore = await cookies()
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      
      if (error) {
        console.error('Auth exchange error:', error)
        return NextResponse.redirect(requestUrl.origin + '/login?error=auth_failed')
      }

      console.log('Session exchanged successfully')
      console.log('User:', data.user?.email)
      console.log('Has provider token:', !!data.session?.provider_token)
      console.log('Has refresh token:', !!data.session?.provider_refresh_token)

      // 토큰 즉시 저장
      if (data.user && data.session?.provider_token && data.session?.provider_refresh_token) {
        try {
          const expiresAt = new Date(Date.now() + (data.session.expires_in || 3600) * 1000).toISOString()
          
          const { error: tokenError } = await supabase
            .from('user_tokens')
            .upsert({
              user_id: data.user.id,
              access_token: data.session.provider_token,
              refresh_token: data.session.provider_refresh_token,
              expires_at: expiresAt,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'user_id'
            })

          if (tokenError) {
            console.error('Failed to save tokens:', tokenError)
          } else {
            console.log('Tokens saved successfully for user:', data.user.id)
          }
        } catch (tokenError) {
          console.error('Failed to save tokens:', tokenError)
        }
      } else {
        console.log('Missing tokens in session')
      }

      // 대시보드로 리디렉션
      return NextResponse.redirect(requestUrl.origin + '/dashboard')
    } catch (error) {
      console.error('Callback error:', error)
      return NextResponse.redirect(requestUrl.origin + '/login?error=callback_failed')
    }
  }

  // code가 없으면 로그인 페이지로
  console.log('No code provided, redirecting to login')
  return NextResponse.redirect(requestUrl.origin + '/login')
}
