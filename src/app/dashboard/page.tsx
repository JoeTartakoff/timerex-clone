'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Schedule {
  id: string
  title: string
  description: string
  share_link: string
  date_range_start: string
  date_range_end: string
  time_slot_duration: number
  created_at: string
  is_one_time_link: boolean
  is_used: boolean
  used_at: string | null
}

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const router = useRouter()

  useEffect(() => {
    checkUser()
  }, [])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login')
      return
    }
    
    setUser(user)

    const { data: { session } } = await supabase.auth.getSession()
    if (session?.provider_token && session?.provider_refresh_token) {
      try {
        const expiresAt = new Date(Date.now() + (session.expires_in || 3600) * 1000).toISOString()
        
        await supabase
          .from('user_tokens')
          .upsert({
            user_id: user.id,
            access_token: session.provider_token,
            refresh_token: session.provider_refresh_token,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id'
          })
      } catch (error) {
        console.error('Failed to save tokens:', error)
      }
    }

    await fetchSchedules(user.id)
    setLoading(false)
  }

  const fetchSchedules = async (userId: string) => {
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_one_time_link', false) // 원타임 전용 스케줄 제외
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching schedules:', error)
      return
    }

    setSchedules(data || [])
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const copyOneTimeLink = (shareLink: string) => {
    // 고유한 토큰 생성
    const oneTimeToken = crypto.randomUUID()
    const url = `${window.location.origin}/book/${shareLink}?mode=onetime&token=${oneTimeToken}`
    navigator.clipboard.writeText(url)
    alert('ワンタイムリンクをコピーしました！\n1回だけ予約可能なリンクです。')
  }

  const copyFixedLink = (shareLink: string) => {
    const url = `${window.location.origin}/book/${shareLink}`
    navigator.clipboard.writeText(url)
    alert('固定リンクをコピーしました！\n何度でも予約可能なリンクです。')
  }

  const deleteSchedule = async (id: string) => {
    if (!confirm('このスケジュールを削除しますか？')) return

    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', id)

    if (error) {
      alert('削除に失敗しました')
      return
    }

    alert('削除しました')
    if (user) {
      await fetchSchedules(user.id)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">
                スケジュール管理
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">{user?.email}</span>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-6">
            <Link
              href="/schedules/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              + 新しいスケジュール作成
            </Link>
          </div>

          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">
                作成したスケジュール
              </h2>
            </div>

            {schedules.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-gray-500">
                  まだスケジュールがありません。新しいスケジュールを作成してください。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {schedules.map((schedule) => (
                  <div key={schedule.id} className="px-6 py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-medium text-gray-900">
                            {schedule.title}
                          </h3>
                        </div>
                        {schedule.description && (
                          <p className="text-sm text-gray-500 mb-2">
                            {schedule.description}
                          </p>
                        )}
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span>
                            📅 {schedule.date_range_start} ～ {schedule.date_range_end}
                          </span>
                          <span>
                            ⏱️ {schedule.time_slot_duration}分枠
                          </span>
                        </div>
                      </div>
                      
                      <div className="ml-4 flex items-center gap-2">
                        <button
                          onClick={() => copyOneTimeLink(schedule.share_link)}
                          className="px-3 py-2 border border-yellow-300 bg-yellow-50 rounded-md text-sm font-medium text-yellow-700 hover:bg-yellow-100 whitespace-nowrap"
                        >
                          ワンタイムリンクコピー
                        </button>
                        <button
                          onClick={() => copyFixedLink(schedule.share_link)}
                          className="px-3 py-2 border border-blue-300 bg-blue-50 rounded-md text-sm font-medium text-blue-700 hover:bg-blue-100 whitespace-nowrap"
                        >
                          固定リンクコピー
                        </button>
                        <button
                          onClick={() => deleteSchedule(schedule.id)}
                          className="px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 whitespace-nowrap"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
