import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            TimerEx Clone
          </h1>
          <p className="text-gray-600 mb-8">
            Googleカレンダーと連携して簡単にスケジュールを共有
          </p>
        </div>
        
        <div className="space-y-4">
          <Link
            href="/login"
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Googleでログイン
          </Link>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p className="mb-2">✓ Googleカレンダーの予定を自動読み取り</p>
          <p className="mb-2">✓ 空いている時間を簡単に共有</p>
          <p>✓ 予約を自動でカレンダーに追加</p>
        </div>

        <div className="mt-8 text-center text-xs text-gray-400">
          <p>初回ログイン時にGoogleカレンダーへの</p>
          <p>アクセス権限の許可が必要です</p>
        </div>
      </div>
    </div>
  )
}
