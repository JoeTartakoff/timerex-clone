const CACHE_NAME = 'yakusoku-ai-v1'
const OFFLINE_URL = '/offline.html'

// 캐시할 정적 파일들
const STATIC_CACHE = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

// 설치 이벤트: 정적 파일 캐싱
self.addEventListener('install', (event) => {
  console.log('[SW] Install event')
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static files')
        return cache.addAll(STATIC_CACHE)
      })
      .then(() => self.skipWaiting())
  )
})

// 활성화 이벤트: 오래된 캐시 삭제
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event')
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name)
            return caches.delete(name)
          })
      )
    }).then(() => self.clients.claim())
  )
})

// Fetch 이벤트: 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // API 요청은 네트워크만 사용 (캐시 안 함)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Offline', useStaticSlots: true }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
    return
  }

  // HTML 페이지: 네트워크 우선, 실패 시 오프라인 페이지
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(OFFLINE_URL))
    )
    return
  }

  // 기타 리소스: 캐시 우선, 없으면 네트워크
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[SW] Serving from cache:', request.url)
          return cachedResponse
        }

        return fetch(request)
          .then((response) => {
            // 성공한 응답만 캐싱
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response
            }

            const responseToCache = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache)
            })

            return response
          })
          .catch(() => {
            // 이미지 등 리소스 실패 시 기본 응답
            return new Response('Offline')
          })
      })
  )
})

// 백그라운드 동기화 (선택)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag)
  
  if (event.tag === 'sync-bookings') {
    event.waitUntil(
      // 오프라인에서 만든 예약을 동기화
      syncBookings()
    )
  }
})

async function syncBookings() {
  // 오프라인 예약 동기화 로직
  console.log('[SW] Syncing bookings...')
}

// 푸시 알림 (선택)
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event.data?.text())
  
  const options = {
    body: event.data?.text() || '新しい通知があります',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  }

  event.waitUntil(
    self.registration.showNotification('Yakusoku-AI', options)
  )
})
