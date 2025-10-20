'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { nanoid } from 'nanoid'

interface Schedule {
  id: string
  title: string
  description: string
  date_range_start: string
  date_range_end: string
  candidate_slots: Array<{
    date: string
    startTime: string
    endTime: string
  }>
}

export default function CandidatePage() {
  const params = useParams()
  const shareLink = params.shareLink as string

  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [selectedSlots, setSelectedSlots] = useState<Array<{
    date: string
    startTime: string
    endTime: string
  }>>([])
  const [guestInfo, setGuestInfo] = useState({
    name: '',
    email: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [responseLink, setResponseLink] = useState<string | null>(null)

  useEffect(() => {
    loadSchedule()
  }, [shareLink])

  // ⭐ URL에서 게스트 정보 읽기
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const nameParam = urlParams.get('name')
    const emailParam = urlParams.get('email')
    
    if (nameParam && emailParam) {
      setGuestInfo({
        name: decodeURIComponent(nameParam),
        email: decodeURIComponent(emailParam),
      })
    }
  }, [])

  const loadSchedule = async () => {
    try {
      const { data, error } = await supabase
        .from('schedules')
        .select('*')
        .eq('share_link', shareLink)
        .eq('is_candidate_mode', true)
        .single()

      if (error) throw error

      setSchedule(data)
    } catch (error) {
      console.error('Error loading schedule:', error)
      alert('スケジュールの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const toggleSlot = (slot: { date: string, startTime: string, endTime: string }) => {
    const exists = selectedSlots.some(
      s => s.date === slot.date && s.startTime === slot.startTime
    )

    if (exists) {
      setSelectedSlots(selectedSlots.filter(
        s => !(s.date === slot.date && s.startTime === slot.startTime)
      ))
    } else {
      setSelectedSlots([...selectedSlots, slot])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!schedule || selectedSlots.length === 0) return

    setSubmitting(true)

    try {
      const shareToken = nanoid(10)

      const { error } = await supabase
        .from('guest_responses')
        .insert({
          schedule_id: schedule.id,
          guest_name: guestInfo.name,
          guest_email: guestInfo.email,
          selected_slots: selectedSlots,
          share_token: shareToken,
          is_confirmed: false,
        })

      if (error) throw error

      const link = `${window.location.origin}/response/${shareToken}`
      setResponseLink(link)

      alert('候補時間を送信しました！\nリンクをホストに共有してください。')
    } catch (error) {
      console.error('Error submitting response:', error)
      alert('送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const copyResponseLink = () => {
    if (responseLink) {
      navigator.clipboard.writeText(responseLink)
      alert('リンクをコピーしました！')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  if (!schedule) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            スケジュールが見つかりません
          </h2>
        </div>
      </div>
    )
  }

  if (responseLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <svg className="h-10 w-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              送信完了！
            </h2>
            <p className="text-gray-600 mb-4">
              以下のリンクをホストに共有してください
            </p>
            <div className="bg-gray-50 p-3 rounded-md mb-4">
              <p className="text-sm text-gray-800 break-all">{responseLink}</p>
            </div>
            <button
              onClick={copyResponseLink}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md"
            >
              リンクをコピー
            </button>
          </div>
        </div>
      </div>
    )
  }

  const slotsByDate = schedule.candidate_slots.reduce((acc, slot) => {
    if (!acc[slot.date]) {
      acc[slot.date] = []
    }
    acc[slot.date].push(slot)
    return acc
  }, {} as Record<string, typeof schedule.candidate_slots>)

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {schedule.title}
          </h1>
          {schedule.description && (
            <p className="text-gray-600">{schedule.description}</p>
          )}
          <div className="mt-4">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
              📋候補日提示モード
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                希望する時間を選択（複数選択可）
              </h2>

              <div className="space-y-6">
                {Object.entries(slotsByDate).map(([date, slots]) => (
                  <div key={date}>
                    <h3 className="text-sm font-medium text-gray-700 mb-3">
                      {new Date(date).toLocaleDateString('ja-JP', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                      })}
                    </h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {slots.map((slot, idx) => {
                        const isSelected = selectedSlots.some(
                          s => s.date === slot.date && s.startTime === slot.startTime
                        )

                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => toggleSlot(slot)}
                            className={`py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                              isSelected
                                ? 'bg-purple-600 text-white'
                                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {slot.startTime.slice(0, 5)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white shadow rounded-lg p-6 sticky top-8">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                あなたの情報
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {selectedSlots.length > 0 && (
                  <div className="bg-purple-50 p-3 rounded-md">
                    <p className="text-sm font-medium text-purple-900">
                      選択した時間: {selectedSlots.length}個
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    お名前 *
                  </label>
                  <input
                    type="text"
                    required
                    value={guestInfo.name}
                    onChange={(e) => setGuestInfo({ ...guestInfo, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    メールアドレス *
                  </label>
                  <input
                    type="email"
                    required
                    value={guestInfo.email}
                    onChange={(e) => setGuestInfo({ ...guestInfo, email: e.target.value })}
                    className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || selectedSlots.length === 0}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-md disabled:bg-gray-400"
                >
                  {submitting ? '送信中...' : '候補時間を送信'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
