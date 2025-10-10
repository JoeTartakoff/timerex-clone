'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthCompletePage() {
  const router = useRouter()

  useEffect(() => {
    console.log('=== Auth Complete Page ===')
    console.log('All cookies:', document.cookie)
    
    // 쿠키에서 리디렉션 URL 가져오기
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`
      const parts = value.split(`; ${name}=`)
      if (parts.length === 2) {
        const cookieValue = parts.pop()?.split(';').shift()
        return cookieValue ? decodeURIComponent(cookieValue) : null
      }
      return null
    }
    
    const redirectUrl = getCookie('auth_redirect_url')
    
    console.log('Stored redirect URL from cookie:', redirectUrl)
    
    if (redirectUrl) {
      console.log('Redirecting to:', redirectUrl)
      
      // 쿠키 삭제
      const isProduction = window.location.hostname !== 'localhost'
      const deleteCookie = isProduction
        ? 'auth_redirect_url=; path=/; max-age=0; Secure'
        : 'auth_redirect_url=; path=/; max-age=0'
      document.cookie = deleteCookie
      
      // 같은 origin인지 확인
      try {
        const url = new URL(redirectUrl)
        if (url.origin === window.location.origin) {
          console.log('Same origin, redirecting...')
          window.location.href = redirectUrl
          return
        } else {
          console.error('Cross-origin redirect blocked')
          router.push('/dashboard')
        }
      } catch (error) {
        console.error('Invalid URL:', error)
        router.push('/dashboard')
      }
    } else {
      console.log('No redirect URL found in cookie, going to dashboard')
      console.log('Available cookies:', document.cookie)
      router.push('/dashboard')
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">認証完了中...</p>
        <p className="text-sm text-gray-500 mt-2">リダイレクトしています...</p>
      </div>
    </div>
  )
}
