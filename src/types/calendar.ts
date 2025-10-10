export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
}

export interface TimeSlot {
  date: string
  startTime: string
  endTime: string
}

export interface Schedule {
  id?: string
  title: string
  description?: string
  shareLink: string
  dateRangeStart: string
  dateRangeEnd: string
  timeSlotDuration: number
  availableSlots?: TimeSlot[]
  is_one_time_link?: boolean  // 추가
  is_used?: boolean            // 추가
  used_at?: string             // 추가
}
