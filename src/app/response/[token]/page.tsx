'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface GuestResponse {
  id: string
  schedule_id: string
  guest_name: string
  guest_email: string
  selected_slots: Array<{
    date: string
    startTime: string
    endTime: string
  }>
  is_confirmed: boolean
  confirmed_slot: {
    date: string
    startTime: string
    endTime: string
  } | null
  created_at: string
}

interface Schedule {
  id: string
  title: string
  description: string
  user_id: string
}

export default function ResponsePage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [response, setResponse] = useState<GuestResponse | null>(null)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [user, setUser] = useState<any>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    loadData()
  }, [token])

  const loadData = async () => {
    try {
      // 게스트 응답 가져오기
      const { data: responseData, error: responseError } = await supabase
        .from('guest_responses')
        .select('*')
        .eq('share_token', token)
        .single()

      if (responseError) throw responseError

      setResponse(responseData)

      // 스케줄 가져오기
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('schedules')
        .select('*')
        .eq('id', responseData.schedule_id)
        .single()

      if (scheduleError) throw scheduleError

      setSchedule(scheduleData)

      // 사용자 확인
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

    } catch (error) {
      console.error('Error loading data:', error)
      alert('データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const confirmSlot = async (slot: { date: string, startTime: string, endTime: string }) => {
    if (!response || !schedule || !user) return
    
    // 권한 확인
    if (user.id !== schedule.user_id) {
      alert('この操作を実行する権限がありません')
      return
    }

    if (!confirm('この時間で確定しますか？\n両方のGoogleカレンダーに予定が追加されます。')) return

    setConfirming(true)

    try {
      // 1. guest_responses 테이블 업데이트
      const { error: updateError } = await supabase
        .from('guest_responses')
        .update({
          is_confirmed: true,
          confirmed_slot: slot
        })
        .eq('id', response.id)

      if (updateError) throw updateError

      // 2. 캘린더 이벤트 추가 API 호출
      const apiResponse = await fetch('/api/calendar/add-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: schedule.id,
          bookingDate: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          guestName: response.guest_name,
          guestEmail: response.guest_email,
        })
      })

      if (!apiResponse.ok) throw new Error('カレンダーへの追加に失敗しました')

      alert('予定を確定しました！\n両方のカレンダーに追加されました。')
      
      // 대시보드로 이동
      router.push('/dashboard')
    } catch (error) {
      console.error('Error confirming slot:', error)
      alert('確定に失敗しました')
    } finally {
      setConfirming(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  if (!response || !schedule) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            応答が見つかりません
          </h2>
        </div>
      </div>
    )
  }

  // 권한 확인
  const isOwner = user && user.id === schedule.user_id

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {schedule.title}
              </h1>
              {schedule.description && (
                <p className="text-gray-600">{schedule.description}</p>
              )}
            </div>
            {response.is_confirmed && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                ✅ 確定済み
              </span>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              ゲスト情報
            </h2>
            <div className="bg-gray-50 p-4 rounded-md">
              <p className="text-sm font-medium text-gray-900">{response.guest_name}</p>
              <p className="text-sm text-gray-500">{response.guest_email}</p>
            </div>
          </div>

          {response.is_confirmed && response.confirmed_slot ? (
            <div className="bg-green-50 p-6 rounded-lg border-2 border-green-200">
              <h3 className="text-lg font-medium text-green-900 mb-3">
                ✅ 確定した時間
              </h3>
              <div className="bg-white p-4 rounded-md">
                <p className="text-sm font-medium text-gray-900">
                  {new Date(response.confirmed_slot.date).toLocaleDateString('ja-JP', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long',
                  })}
                </p>
<p className="text-lg font-bold text-green-700 mt-1">
  {response.confirmed_slot.startTime.slice(0, 5)} - {response.confirmed_slot.endTime.slice(0, 5)}
</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  希望時間 ({response.selected_slots.length}個)
                </h3>
                {!isOwner && (
                  <span className="text-sm text-amber-600">
                    ⚠️ ホストのみ確定できます
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {response.selected_slots.map((slot, idx) => (
                  <div
                    key={idx}
                    className="bg-purple-50 p-4 rounded-lg border border-purple-200"
                  >
                    <p className="text-sm font-medium text-purple-900 mb-1">
                      {new Date(slot.date).toLocaleDateString('ja-JP', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                      })}
                    </p>
<p className="text-lg font-bold text-purple-700 mb-3">
  {slot.startTime.slice(0, 5)} - {slot.endTime.slice(0, 5)}
</p>
                    
                    {isOwner && (
                      <button
                        onClick={() => confirmSlot(slot)}
                        disabled={confirming}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-md disabled:bg-gray-400"
                      >
                        {confirming ? '確定中...' : 'この時間で確定'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {isOwner && (
          <div className="mt-6 text-center">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              ← ダッシュボードに戻る
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
