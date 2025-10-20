'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // URL 해시에 access_token이 있으면 로그인 후 리디렉션 처리
    const hash = window.location.hash
    if (hash && hash.includes('access_token')) {
      console.log('=== Auth tokens detected in URL ===')
      
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
      console.log('Redirect URL from cookie:', redirectUrl)
      
      if (redirectUrl) {
        // 쿠키 삭제
        document.cookie = 'auth_redirect_url=; path=/; max-age=0'
        
        console.log('Redirecting to:', redirectUrl)
        
        // 해시를 제거하고 저장된 URL로 리디렉션
        window.history.replaceState(null, '', '/')
        setTimeout(() => {
          window.location.href = redirectUrl
        }, 100)
      } else {
        // 리디렉션 URL이 없으면 대시보드로
        console.log('No redirect URL, going to dashboard')
        window.history.replaceState(null, '', '/')
        router.push('/dashboard')
      }
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            ヤクソクーAI
          </h1>
          <p className="text-gray-600 mb-8">
            Googleカレンダーと連携して簡単にスケジュールを共有
          </p>
        </div>
        
        <div className="space-y-4">
          <Link
            href="/login"
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Googleでログイン
          </Link>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p className="mb-2">✓ Googleカレンダーの予定を自動読み取り</p>
          <p className="mb-2">✓ 空いている時間を簡単に共有</p>
          <p>✓ 予約を自動でカレンダーに追加</p>
        </div>

        <div className="mt-8 text-center text-xs text-gray-400">
          <p>初回ログイン時にGoogleカレンダーへの</p>
          <p>アクセス権限の許可が必要です</p>
        </div>
      </div>
    </div>
  )
}
