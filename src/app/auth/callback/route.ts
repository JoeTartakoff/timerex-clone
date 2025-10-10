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

      // 토큰 저장
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
      }

      // 쿠키에서 리디렉션 URL 읽기
      const redirectCookie = cookieStore.get('auth_redirect_url')
      const redirectUrl = redirectCookie?.value ? decodeURIComponent(redirectCookie.value) : null
      
      console.log('Redirect URL from cookie:', redirectUrl)

      if (redirectUrl && redirectUrl.startsWith(requestUrl.origin)) {
        console.log('Redirecting to saved URL:', redirectUrl)
        return NextResponse.redirect(redirectUrl)
      }

      // 리디렉션 URL이 없으면 대시보드로
      console.log('No valid redirect URL, going to dashboard')
      return NextResponse.redirect(requestUrl.origin + '/dashboard')
    } catch (error) {
      console.error('Callback error:', error)
      return NextResponse.redirect(requestUrl.origin + '/login?error=callback_failed')
    }
  }

  console.log('No code provided, redirecting to login')
  return NextResponse.redirect(requestUrl.origin + '/login')
}
