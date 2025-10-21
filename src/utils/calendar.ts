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
      ?.filter((cal: any) => cal.selected !== false)
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
      
      // ⭐ 하루 종일 이벤트 필터링 추가
      const formattedEvents = pageEvents
        .filter((item: any) => {
          // dateTime이 있으면 일반 이벤트 → 사용
          if (item.start.dateTime) {
            return true
          }
          
          // date만 있으면 하루 종일 이벤트 → 무시
          if (item.start.date && !item.start.dateTime) {
            console.log(`🚫 Skipping all-day event: "${item.summary}" on ${item.start.date}`)
            return false
          }
          
          return true
        })
        .map((item: any) => ({
          id: item.id,
          summary: item.summary || '予定',
          start: item.start.dateTime,  // ⭐ 이제 항상 dateTime
          end: item.end.dateTime,
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
    const calendarIds = await fetchAllCalendars(accessToken)
    console.log(`📋 Total calendars to check: ${calendarIds.length}`)

    const allEventsPromises = calendarIds.map(calendarId =>
      fetchEventsFromCalendar(accessToken, calendarId, timeMin, timeMax)
    )

    const allEventsArrays = await Promise.all(allEventsPromises)
    const allEvents = allEventsArrays.flat()

    const uniqueEvents = Array.from(
      new Map(allEvents.map(event => [event.id, event])).values()
    )

    console.log(`✅ Total unique events fetched: ${uniqueEvents.length}`)
    return uniqueEvents
  } catch (error) {
    console.error('❌ Error in fetchCalendarEvents:', error)
    console.log('⚠️ Falling back to primary calendar only')
    return fetchEventsFromCalendar(accessToken, 'primary', timeMin, timeMax)
  }
}

// ⭐ 날짜 문자열을 Asia/Tokyo 기준 Date 객체로 변환
function parseTokyoDate(dateStr: string, timeStr: string): Date {
  // YYYY-MM-DDTHH:mm:ss 형식으로 조합
  const isoString = `${dateStr}T${timeStr}`
  
  // 먼저 로컬 Date 객체 생성
  const localDate = new Date(isoString)
  
  // 로컬 타임존 오프셋 (분 단위)
  const localOffset = localDate.getTimezoneOffset()
  
  // Asia/Tokyo 오프셋 (UTC+9 = -540분)
  const tokyoOffset = -540
  
  // 오프셋 차이를 보정
  const offsetDiff = tokyoOffset - localOffset
  
  // 보정된 시간 반환
  return new Date(localDate.getTime() + offsetDiff * 60 * 1000)
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
  console.log('Server timezone offset (minutes):', new Date().getTimezoneOffset())

  // 날짜별로 반복
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().split('T')[0]
    
    // ⭐ Asia/Tokyo 기준으로 해당 날짜의 시작과 끝 계산
    const dayStart = parseTokyoDate(dateStr, '00:00:00')
    const dayEnd = parseTokyoDate(dateStr, '23:59:59')
    
    console.log(`\n📅 Processing date: ${dateStr}`)
    console.log(`  Day start: ${dayStart.toISOString()}`)
    console.log(`  Day end: ${dayEnd.toISOString()}`)
    
    // 해당 날짜와 겹치는 이벤트 필터링
    const dayEvents = events.filter(event => {
      const eventStart = new Date(event.start)
      const eventEnd = new Date(event.end)
      
      const overlapsDay = (
        (eventStart >= dayStart && eventStart < dayEnd) ||
        (eventEnd > dayStart && eventEnd <= dayEnd) ||
        (eventStart < dayStart && eventEnd > dayEnd)
      )
      
      if (overlapsDay) {
        console.log(`  ✓ Event: ${event.summary}`)
        console.log(`    Start: ${eventStart.toISOString()}`)
        console.log(`    End: ${eventEnd.toISOString()}`)
      }
      
      return overlapsDay
    })

    console.log(`  Found ${dayEvents.length} events on this day`)

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
      // ⭐ 슬롯 시간을 Asia/Tokyo 기준으로 파싱
      const slotStart = parseTokyoDate(slot.date, slot.startTime)
      const slotEnd = parseTokyoDate(slot.date, slot.endTime)

      const isAvailable = !dayEvents.some(event => {
        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        
        const slotStartMs = slotStart.getTime()
        const slotEndMs = slotEnd.getTime()
        const eventStartMs = eventStart.getTime()
        const eventEndMs = eventEnd.getTime()
        
        const overlaps = (
          (slotStartMs >= eventStartMs && slotStartMs < eventEndMs) ||
          (slotEndMs > eventStartMs && slotEndMs <= eventEndMs) ||
          (slotStartMs <= eventStartMs && slotEndMs >= eventEndMs)
        )

        return overlaps
      })

      if (isAvailable) {
        availableSlots.push(slot)
      }
    })
  }

  console.log(`\n✅ Total available slots: ${availableSlots.length}`)
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

    current += 30  // ✅ 수정! 항상 30분씩 점프!
  }

  return slots
}

function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`
}
