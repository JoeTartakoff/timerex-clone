'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    // 로컬스토리지에서 리디렉션 URL 확인
    const redirectUrl = localStorage.getItem('booking_redirect_url')
    
    if (redirectUrl) {
      console.log('Redirecting to booking page:', redirectUrl)
      localStorage.removeItem('booking_redirect_url')
      window.location.href = redirectUrl
    } else {
      console.log('Redirecting to dashboard')
      router.push('/dashboard')
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-600">リダイレクト中...</p>
    </div>
  )
}