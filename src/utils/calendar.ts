import { CalendarEvent, TimeSlot } from '@/types/calendar'

// 모든 캘린더 목록 가져오기
async function fetchAllCalendars(accessToken: string): Promise<string[]> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      console.error('Failed to fetch calendar list:', response.status)
      return ['primary']
    }

    const data = await response.json()
    const calendarIds = data.items
      ?.filter((cal: any) => cal.selected !== false) // 선택된 캘린더만
      ?.map((cal: any) => cal.id) || ['primary']

    console.log('📋 Found calendars:', calendarIds.length)
    return calendarIds
  } catch (error) {
    console.error('Error fetching calendar list:', error)
    return ['primary']
  }
}

// 특정 캘린더에서 이벤트 가져오기
async function fetchEventsFromCalendar(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const allEvents: CalendarEvent[] = []
  let pageToken: string | undefined = undefined
  let pageCount = 0
  const maxPages = 10

  console.log(`📅 Fetching events from calendar: ${calendarId}`)

  do {
    try {
      pageCount++
      
      let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
        `timeMin=${encodeURIComponent(timeMin)}&` +
        `timeMax=${encodeURIComponent(timeMax)}&` +
        `singleEvents=true&` +
        `orderBy=startTime&` +
        `maxResults=250`
      
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        console.error(`❌ Failed to fetch from ${calendarId}:`, response.status)
        break
      }

      const data = await response.json()
      const pageEvents = data.items || []
      
      console.log(`📄 Calendar ${calendarId} - Page ${pageCount}: ${pageEvents.length} events`)
      
      const formattedEvents = pageEvents.map((item: any) => ({
        id: item.id,
        summary: item.summary || '予定',
        start: item.start.dateTime || item.start.date,
        end: item.end.dateTime || item.end.date,
      }))
      
      allEvents.push(...formattedEvents)
      pageToken = data.nextPageToken

      if (pageCount >= maxPages) {
        console.warn(`⚠️ Reached max pages for ${calendarId}`)
        break
      }
    } catch (error) {
      console.error(`❌ Error fetching from ${calendarId}:`, error)
      break
    }
  } while (pageToken)

  return allEvents
}

// Google Calendar API로 모든 캘린더의 일정 가져오기
export async function fetchCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  console.log('📅 Starting to fetch calendar events from all calendars...')
  console.log('📅 Time range:', { timeMin, timeMax })

  try {
    // 모든 캘린더 목록 가져오기
    const calendarIds = await fetchAllCalendars(accessToken)
    console.log(`📋 Total calendars to check: ${calendarIds.length}`)

    // 각 캘린더에서 이벤트 가져오기
    const allEventsPromises = calendarIds.map(calendarId =>
      fetchEventsFromCalendar(accessToken, calendarId, timeMin, timeMax)
    )

    const allEventsArrays = await Promise.all(allEventsPromises)
    const allEvents = allEventsArrays.flat()

    // 중복 제거 (같은 이벤트가 여러 캘린더에 있을 수 있음)
    const uniqueEvents = Array.from(
      new Map(allEvents.map(event => [event.id, event])).values()
    )

    console.log(`✅ Total unique events fetched: ${uniqueEvents.length}`)
    return uniqueEvents
  } catch (error) {
    console.error('❌ Error in fetchCalendarEvents:', error)
    // 실패 시 primary만 조회
    console.log('⚠️ Falling back to primary calendar only')
    return fetchEventsFromCalendar(accessToken, 'primary', timeMin, timeMax)
  }
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
      
      return eventDateStr === dateStr
    })

    console.log(`Date: ${dateStr}, Events: ${dayEvents.length}`)

    // 근무 시간대를 슬롯으로 분할
    const slots = generateTimeSlots(
      dateStr,
      workingHoursStart,
      workingHoursEnd,
      lunchStart,
      lunchEnd,
      slotDuration
    )

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
