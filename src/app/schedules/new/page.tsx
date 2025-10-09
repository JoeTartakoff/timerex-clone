'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchCalendarEvents, calculateAvailableSlots } from '@/utils/calendar'
import { v4 as uuidv4 } from 'uuid'

export default function NewSchedulePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [accessToken, setAccessToken] = useState<string>('')
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    dateRangeStart: '',
    dateRangeEnd: '',
    timeSlotDuration: 30,
  })

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

    // Access Token 가져오기
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.provider_token) {
      setAccessToken(session.provider_token)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (!accessToken) {
        throw new Error('Google認証が必要です')
      }

      // Google Calendar에서 일정 가져오기
      const timeMin = new Date(formData.dateRangeStart).toISOString()
      const timeMax = new Date(formData.dateRangeEnd + 'T23:59:59').toISOString()
      
      const events = await fetchCalendarEvents(accessToken, timeMin, timeMax)

      // 빈 시간대 계산
      const availableSlots = calculateAvailableSlots(
        events,
        formData.dateRangeStart,
        formData.dateRangeEnd,
        '09:00',
        '18:00',
        '12:00',
        '13:00',
        formData.timeSlotDuration
      )

      // 공유 링크 생성
      const shareLink = uuidv4()

      // Supabase에 스케줄 저장
      const { data: schedule, error: scheduleError } = await supabase
        .from('schedules')
        .insert({
          user_id: user.id,
          title: formData.title,
          description: formData.description,
          share_link: shareLink,
          date_range_start: formData.dateRangeStart,
          date_range_end: formData.dateRangeEnd,
          time_slot_duration: formData.timeSlotDuration,
        })
        .select()
        .single()

      if (scheduleError) throw scheduleError

      // 가능한 시간대 저장
      const slotsToInsert = availableSlots.map(slot => ({
        schedule_id: schedule.id,
        date: slot.date,
        start_time: slot.startTime,
        end_time: slot.endTime,
      }))

      const { error: slotsError } = await supabase
        .from('availability_slots')
        .insert(slotsToInsert)

      if (slotsError) throw slotsError

      alert('スケジュールを作成しました！')
      router.push('/dashboard')
    } catch (error: any) {
      console.error('Error:', error)
      alert(error.message || 'スケジュールの作成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
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
                新しいスケジュール作成
              </h1>
            </div>
            <div className="flex items-center">
              <button
                onClick={() => router.push('/dashboard')}
                className="text-gray-600 hover:text-gray-900"
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                スケジュールタイトル *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="例：打ち合わせ予約"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                説明（任意）
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="スケジュールの詳細を入力してください"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  開始日 *
                </label>
                <input
                  type="date"
                  required
                  value={formData.dateRangeStart}
                  onChange={(e) => setFormData({ ...formData, dateRangeStart: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  終了日 *
                </label>
                <input
                  type="date"
                  required
                  value={formData.dateRangeEnd}
                  onChange={(e) => setFormData({ ...formData, dateRangeEnd: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                予約枠の長さ
              </label>
              <select
                value={formData.timeSlotDuration}
                onChange={(e) => setFormData({ ...formData, timeSlotDuration: Number(e.target.value) })}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={30}>30分</option>
                <option value={60}>1時間</option>
              </select>
            </div>

            <div className="bg-blue-50 p-4 rounded-md">
              <p className="text-sm text-blue-800">
                <strong>設定内容：</strong>
              </p>
              <ul className="mt-2 text-sm text-blue-700 list-disc list-inside">
                <li>営業時間: 9:00 - 18:00</li>
                <li>休憩時間: 12:00 - 13:00</li>
                <li>Googleカレンダーの予定と重複しない時間のみ予約可能</li>
              </ul>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? '作成中...' : 'スケジュール作成'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
