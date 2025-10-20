'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthCompletePage() {
  const router = useRouter()

  useEffect(() => {
    console.log('=== Auth Complete Page ===')
    
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
    
    console.log('All cookies:', document.cookie)
    console.log('Stored redirect URL from cookie:', redirectUrl)
    
    if (redirectUrl) {
      console.log('Redirecting to:', redirectUrl)
      
      // 쿠키 삭제
      document.cookie = 'auth_redirect_url=; path=/; max-age=0; domain=' + window.location.hostname
      document.cookie = 'auth_redirect_url=; path=/; max-age=0'
      
      // 리디렉션 (router.push 대신 window.location.href 사용)
      setTimeout(() => {
        window.location.href = redirectUrl
      }, 100)
    } else {
      console.log('No redirect URL found in cookie, going to dashboard')
      setTimeout(() => {
        router.push('/dashboard')
      }, 100)
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
