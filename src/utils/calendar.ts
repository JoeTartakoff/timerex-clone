import { CalendarEvent, TimeSlot } from '@/types/calendar'

// Google Calendar API로 일정 가져오기 (페이지네이션 포함)
export async function fetchCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const allEvents: CalendarEvent[] = []
  let pageToken: string | undefined = undefined
  let pageCount = 0
  const maxPages = 10

  console.log('📅 Starting to fetch calendar events...')
  console.log('📅 Time range:', { timeMin, timeMax })

  do {
    try {
      pageCount++
      
      let url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
        `timeMin=${encodeURIComponent(timeMin)}&` +
        `timeMax=${encodeURIComponent(timeMax)}&` +
        `singleEvents=true&` +
        `orderBy=startTime&` +
        `maxResults=250`
      
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`
      }

      console.log(`📄 Fetching page ${pageCount}...`)

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      console.log(`📄 Page ${pageCount} response status:`, response.status)

      if (!response.ok) {
        const errorData = await response.json()
        console.error(`❌ Calendar API error:`, errorData)
        throw new Error(`カレンダーの取得に失敗しました: ${response.status}`)
      }

      const data = await response.json()
      const pageEvents = data.items || []
      
      console.log(`📄 Page ${pageCount}: ${pageEvents.length} events`)
      console.log(`📄 Has next page: ${!!data.nextPageToken}`)
      
      const formattedEvents = pageEvents.map((item: any) => ({
        id: item.id,
        summary: item.summary || '予定',
        start: item.start.dateTime || item.start.date,
        end: item.end.dateTime || item.end.date,
      }))
      
      allEvents.push(...formattedEvents)
      pageToken = data.nextPageToken

      if (pageCount >= maxPages) {
        console.warn(`⚠️ Reached max pages (${maxPages}), stopping`)
        break
      }
    } catch (error) {
      console.error(`❌ Error fetching page ${pageCount}:`, error)
      throw error
    }
  } while (pageToken)

  console.log(`✅ Total events fetched: ${allEvents.length}`)
  return allEvents
}

// 빈 시간대 계산
export function calculateAvailableSlots(
  events: CalendarEvent[],
  dateRangeStart: string,
  dateRangeEnd: string,
  workingHoursStart: string = '09:00',
  workingHoursEnd: string = '18:00',
  lunchStart: string = '12:00',
  lunchEnd: string = '13:00',
  slotDuration: number = 30
): TimeSlot[] {
  const availableSlots: TimeSlot[] = []
  const startDate = new Date(dateRangeStart)
  const endDate = new Date(dateRangeEnd)

  console.log('=== calculateAvailableSlots ===')
  console.log('Events:', events.length)
  console.log('Events detail:', events)

  // 날짜별로 반복
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().split('T')[0]
    
    // 해당 날짜의 이벤트 필터링
    const dayEvents = events.filter(event => {
      const eventStart = new Date(event.start)
      
      // 로컬 날짜로 변환해서 비교
      const eventYear = eventStart.getFullYear()
      const eventMonth = String(eventStart.getMonth() + 1).padStart(2, '0')
      const eventDay = String(eventStart.getDate()).padStart(2, '0')
      const eventDateStr = `${eventYear}-${eventMonth}-${eventDay}`
      
      console.log(`  Comparing: slot date ${dateStr} vs event date ${eventDateStr}`)
      
      return eventDateStr === dateStr
    })

    console.log(`Date: ${dateStr}, Events: ${dayEvents.length}`)
    dayEvents.forEach(event => {
      console.log(`  Event: ${event.summary} - ${event.start} to ${event.end}`)
    })

    // 근무 시간대를 슬롯으로 분할
    const slots = generateTimeSlots(
      dateStr,
      workingHoursStart,
      workingHoursEnd,
      lunchStart,
      lunchEnd,
      slotDuration
    )

    console.log(`  Generated ${slots.length} slots for ${dateStr}`)

    // 이벤트와 겹치지 않는 슬롯만 추가
    slots.forEach(slot => {
      const slotStart = new Date(`${slot.date}T${slot.startTime}`)
      const slotEnd = new Date(`${slot.date}T${slot.endTime}`)

      const isAvailable = !dayEvents.some(event => {
        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        
        const overlaps = (
          (slotStart >= eventStart && slotStart < eventEnd) ||
          (slotEnd > eventStart && slotEnd <= eventEnd) ||
          (slotStart <= eventStart && slotEnd >= eventEnd) ||
          (eventStart <= slotStart && eventEnd >= slotEnd)
        )

        if (overlaps) {
          console.log(`    Slot ${slot.startTime}-${slot.endTime} OVERLAPS with ${event.summary}`)
        }

        return overlaps
      })

      if (isAvailable) {
        availableSlots.push(slot)
      }
    })
  }

  console.log(`Total available slots: ${availableSlots.length}`)
  return availableSlots
}

// 시간 슬롯 생성
function generateTimeSlots(
  date: string,
  startTime: string,
  endTime: string,
  lunchStart: string,
  lunchEnd: string,
  duration: number
): TimeSlot[] {
  const slots: TimeSlot[] = []
  const start = parseTime(startTime)
  const end = parseTime(endTime)
  const lunchStartMin = parseTime(lunchStart)
  const lunchEndMin = parseTime(lunchEnd)

  let current = start

  while (current + duration <= end) {
    const slotEnd = current + duration

    // 점심시간과 겹치는지 확인
    const overlapLunch = (
      (current >= lunchStartMin && current < lunchEndMin) ||
      (slotEnd > lunchStartMin && slotEnd <= lunchEndMin) ||
      (current <= lunchStartMin && slotEnd >= lunchEndMin)
    )

    if (!overlapLunch) {
      slots.push({
        date,
        startTime: formatTime(current),
        endTime: formatTime(slotEnd),
      })
    }

    current += duration
  }

  return slots
}

// 시간을 분으로 변환 (09:00 -> 540)
function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// 분을 시간으로 변환 (540 -> 09:00:00)
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`
}
