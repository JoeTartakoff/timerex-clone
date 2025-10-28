'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
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
  is_candidate_mode: boolean
  candidate_slots: Array<{
    date: string
    startTime: string
    endTime: string
  }> | null
  is_interview_mode: boolean
  interview_time_start: string | null
  interview_time_end: string | null
  folder_id: string | null
  team_id: string | null
  user_id: string
}

interface GuestPreset {
  id: string
  schedule_id: string
  guest_name: string
  guest_email: string
  custom_token: string
  created_at: string
}

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
  share_token: string
  is_confirmed: boolean
  confirmed_slot: {
    date: string
    startTime: string
    endTime: string
  } | null
  created_at: string
}

interface Booking {
  id: string
  schedule_id: string
  booking_date: string
  start_time: string
  end_time: string
  guest_name: string
  guest_email: string
  status: string
  host_calendar_event_id: string | null
  guest_calendar_event_id: string | null
  guest_user_id: string | null
  assigned_user_id: string | null
  created_at: string
}

export default function ScheduleDetailPage() {
  const router = useRouter()
  const params = useParams()
  const scheduleId = params.id as string

  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [guestPresets, setGuestPresets] = useState<GuestPreset[]>([])
  const [guestResponses, setGuestResponses] = useState<GuestResponse[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])

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
    await fetchScheduleDetail(scheduleId)
    setLoading(false)
  }

  const fetchScheduleDetail = async (scheduleId: string) => {
    try {
      // 스케줄 정보 가져오기
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('schedules')
        .select('*')
        .eq('id', scheduleId)
        .single()

      if (scheduleError) throw scheduleError
      setSchedule(scheduleData)

      // 게스트 프리셋 가져오기
      const { data: presetsData } = await supabase
        .from('guest_presets')
        .select('*')
        .eq('schedule_id', scheduleId)
        .order('created_at', { ascending: true })
      
      setGuestPresets(presetsData || [])

      // 후보모드 응답 가져오기
      if (scheduleData.is_candidate_mode || scheduleData.is_interview_mode) {
        const { data: responsesData } = await supabase
          .from('guest_responses')
          .select('*')
          .eq('schedule_id', scheduleId)
          .order('created_at', { ascending: false })
        
        setGuestResponses(responsesData || [])
      }

      // 통상모드 예약 가져오기
      if (!scheduleData.is_candidate_mode && !scheduleData.is_interview_mode) {
        const { data: bookingsData } = await supabase
          .from('bookings')
          .select('*')
          .eq('schedule_id', scheduleId)
          .eq('status', 'confirmed')
          .order('booking_date', { ascending: false })
          .order('start_time', { ascending: false })
        
        setBookings(bookingsData || [])
      }
    } catch (error) {
      console.error('Error fetching schedule detail:', error)
      alert('スケジュール情報の取得に失敗しました')
      router.push('/dashboard')
    }
  }

  const confirmGuestResponse = async (responseId: string, slot: { date: string, startTime: string, endTime: string }) => {
    if (!confirm('この時間で確定しますか？\n両方のGoogleカレンダーに予定が追加されます。')) return

    try {
      const guestResponse = guestResponses.find(r => r.id === responseId)
      if (!guestResponse) {
        alert('ゲスト情報が見つかりません')
        return
      }

      console.log('🔵 Confirming guest response...')

      const { error: updateError } = await supabase
        .from('guest_responses')
        .update({
          is_confirmed: true,
          confirmed_slot: slot
        })
        .eq('id', responseId)

      if (updateError) throw updateError

      console.log('✅ guest_responses updated')

      const response = await fetch('/api/calendar/add-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: schedule?.id,
          bookingDate: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          guestName: guestResponse.guest_name,
          guestEmail: guestResponse.guest_email,
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('❌ Calendar API error:', errorData)
        throw new Error('カレンダーへの追加に失敗しました')
      }

      const result = await response.json()
      console.log('✅ Calendar API result:', result)

      console.log('💾 Saving to bookings table...')
      const { error: bookingError } = await supabase
        .from('bookings')
        .insert({
          schedule_id: schedule?.id,
          guest_name: guestResponse.guest_name,
          guest_email: guestResponse.guest_email,
          booking_date: slot.date,
          start_time: slot.startTime,
          end_time: slot.endTime,
          status: 'confirmed',
          host_calendar_event_id: result.hostEventIds?.[0] || null,
          guest_calendar_event_id: result.guestEventId || null,
          assigned_user_id: result.assignedUserId || null,
        })

      if (bookingError) {
        console.error('⚠️ Failed to save booking:', bookingError)
        alert('予定を確定しました！\n（データベースへの保存に一部失敗しましたが、カレンダーには追加されています）')
      } else {
        console.log('✅ Booking saved to database')
        alert('予定を確定しました！\n両方のカレンダーに追加されました。')
      }
      
      await fetchScheduleDetail(scheduleId)
    } catch (error) {
      console.error('Error confirming response:', error)
      alert('確定に失敗しました')
    }
  }

  const cancelBooking = async (bookingId: string, guestName: string) => {
    if (!confirm(`${guestName}様の予約をキャンセルしますか？\n\n両方のGoogleカレンダーから予定が削除されます。`)) {
      return
    }

    try {
      console.log('🗑️ Cancelling booking:', bookingId)
      
      const response = await fetch('/api/calendar/delete-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          bookingId,
          type: 'booking'
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'キャンセルに失敗しました')
      }

      console.log('✅ Booking cancelled:', result)

      let message = '予約をキャンセルしました\n\n'
      
      if (result.hostDeleted && result.guestDeleted) {
        message += '✅ ホストとゲストのカレンダーから削除されました'
      } else if (result.hostDeleted) {
        message += '✅ ホストのカレンダーから削除されました\n⚠️ ゲストのカレンダーは手動で削除が必要です'
      } else if (result.guestDeleted) {
        message += '✅ ゲストのカレンダーから削除されました\n⚠️ ホストのカレンダーは手動で削除が必要です'
      } else {
        message += '⚠️ カレンダーからの削除に失敗しました\n手動で削除してください'
      }

      alert(message)
      await fetchScheduleDetail(scheduleId)
    } catch (error) {
      console.error('❌ Cancel booking error:', error)
      alert('予約のキャンセルに失敗しました')
    }
  }

  const cancelGuestResponse = async (responseId: string, guestName: string) => {
    if (!confirm(`${guestName}様の確定をキャンセルしますか？\n\n両方のGoogleカレンダーから予定が削除され、未確定状態に戻ります。`)) {
      return
    }

    try {
      console.log('🗑️ Cancelling guest response:', responseId)
      
      const response = await fetch('/api/calendar/delete-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          responseId,
          type: 'response'
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'キャンセルに失敗しました')
      }

      console.log('✅ Response cancelled:', result)

      let message = '確定をキャンセルしました\n未確定状態に戻りました\n\n'
      
      if (result.hostDeleted && result.guestDeleted) {
        message += '✅ ホストとゲストのカレンダーから削除されました'
      } else if (result.hostDeleted) {
        message += '✅ ホストのカレンダーから削除されました\n⚠️ ゲストのカレンダーは手動で削除が必要です'
      } else if (result.guestDeleted) {
        message += '✅ ゲストのカレンダーから削除されました\n⚠️ ホストのカレンダーは手動で削除が必要です'
      } else {
        message += '⚠️ カレンダーからの削除に失敗しました\n手動で削除してください'
      }

      alert(message)
      await fetchScheduleDetail(scheduleId)
    } catch (error) {
      console.error('❌ Cancel response error:', error)
      alert('キャンセルに失敗しました')
    }
  }

  const copyPersonalizedLink = (shareLink: string, guestToken: string, guestName: string) => {
    const url = `${window.location.origin}/book/${shareLink}?guest=${guestToken}`
    navigator.clipboard.writeText(url)
    alert(`${guestName}様専用リンクをコピーしました！`)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  if (!schedule) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">スケジュールが見つかりません</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* ヘッダー */}
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700 mb-4"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            ダッシュボードに戻る
          </Link>
          
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  {schedule.title}
                </h1>
                {schedule.description && (
                  <p className="text-gray-600">{schedule.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                {schedule.is_candidate_mode && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800">
                    🟣 候補時間提示
                  </span>
                )}
                {schedule.is_interview_mode && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                    🟠 候補日受取
                  </span>
                )}
                {!schedule.is_candidate_mode && !schedule.is_interview_mode && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                    🔵 通常モード
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <span>📅</span>
                <span>{schedule.date_range_start} ～ {schedule.date_range_end}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>⏱️</span>
                <span>{schedule.time_slot_duration}分枠</span>
              </div>
            </div>
          </div>
        </div>

        {/* 통상모드: 확정 예약 목록 */}
        {!schedule.is_candidate_mode && !schedule.is_interview_mode && bookings.length > 0 && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              ✅ 確定済み予約 ({bookings.length}件)
            </h2>
            <div className="space-y-3">
              {bookings.map((booking) => (
                <div key={booking.id} className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{booking.guest_name}</p>
                      <p className="text-sm text-gray-600">{booking.guest_email}</p>
                      <p className="text-sm text-blue-900 mt-1">
                        📅 {new Date(booking.booking_date).toLocaleDateString('ja-JP')} | 
                        🕐 {booking.start_time.slice(0, 5)} - {booking.end_time.slice(0, 5)}
                      </p>
                    </div>
                    <button
                      onClick={() => cancelBooking(booking.id, booking.guest_name)}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 후보모드: 게스트 응답 목록 */}
        {(schedule.is_candidate_mode || schedule.is_interview_mode) && guestResponses.length > 0 && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              📬 ゲスト応答 ({guestResponses.length}件)
            </h2>
            <div className="space-y-4">
              {guestResponses.map((response) => (
                <div 
                  key={response.id} 
                  className={`border rounded-lg p-4 ${
                    schedule.is_interview_mode 
                      ? 'border-orange-200 bg-orange-50' 
                      : 'border-purple-200 bg-purple-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-medium text-gray-900">{response.guest_name}</p>
                      <p className="text-sm text-gray-600">{response.guest_email}</p>
                    </div>
                    {response.is_confirmed && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                        ✅ 確定済み
                      </span>
                    )}
                  </div>
                  
                  {response.is_confirmed && response.confirmed_slot ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-green-800">
                          確定時間: {new Date(response.confirmed_slot.date).toLocaleDateString('ja-JP')} {response.confirmed_slot.startTime.slice(0, 5)} - {response.confirmed_slot.endTime.slice(0, 5)}
                        </p>
                        <button
                          onClick={() => cancelGuestResponse(response.id, response.guest_name)}
                          className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium transition-colors"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-700 mb-2 font-medium">
                        希望時間 ({response.selected_slots.length}個):
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {response.selected_slots.map((slot, idx) => (
                          <button
                            key={idx}
                            onClick={() => confirmGuestResponse(response.id, slot)}
                            className={`text-left p-3 rounded-lg border transition-colors ${
                              schedule.is_interview_mode 
                                ? 'bg-white hover:bg-orange-100 border-orange-300' 
                                : 'bg-white hover:bg-purple-100 border-purple-300'
                            }`}
                          >
                            <div className={`font-medium ${
                              schedule.is_interview_mode ? 'text-orange-900' : 'text-purple-900'
                            }`}>
                              {new Date(slot.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' })}
                            </div>
                            <div className={`text-sm ${
                              schedule.is_interview_mode ? 'text-orange-700' : 'text-purple-700'
                            }`}>
                              {slot.startTime.slice(0, 5)} - {slot.endTime.slice(0, 5)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 게스트 프리셋 목록 */}
        {guestPresets.length > 0 && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              👥 登録済みゲスト ({guestPresets.length}名)
            </h2>
            <div className="space-y-2">
              {guestPresets.map((guest) => (
                <div key={guest.id} className="flex items-center justify-between border border-green-200 rounded-lg p-3 bg-green-50">
                  <div>
                    <p className="font-medium text-gray-900">{guest.guest_name}</p>
                    <p className="text-sm text-gray-600">{guest.guest_email}</p>
                  </div>
                  <button
                    onClick={() => copyPersonalizedLink(schedule.share_link, guest.custom_token, guest.guest_name)}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    専用リンクコピー
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
