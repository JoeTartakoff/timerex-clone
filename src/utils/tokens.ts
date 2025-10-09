import { supabase } from '@/lib/supabase'

export async function saveUserTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  const { error } = await supabase
    .from('user_tokens')
    .upsert({
      user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    console.error('Error saving tokens:', error)
    throw error
  }
}

export async function getUserTokens(userId: string) {
  const { data, error } = await supabase
    .from('user_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) {
    console.error('Error getting tokens:', error)
    return null
  }

  return data
}

export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
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

    const data = await response.json()

    if (data.access_token) {
      return data.access_token
    }

    return null
  } catch (error) {
    console.error('Error refreshing token:', error)
    return null
  }
}
