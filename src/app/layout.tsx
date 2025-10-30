import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ⭐ PWA 메타데이터 추가
export const metadata: Metadata = {
  title: "ヤクソクAI",
  description: "AIを活用したスケジュール調整システム",
  manifest: '/manifest.json',
  themeColor: '#3b82f6',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ヤクソクAI',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    siteName: 'ヤクソクAI',
    title: 'ヤクソクAI',
    description: 'AIを活用したスケジュール調整システム',
  },
  twitter: {
    card: 'summary',
    title: 'ヤクソクAI',
    description: 'AIを活用したスケジュール調整システム',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        {/* ⭐ PWA 관련 메타 태그 */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        
        {/* ⭐ Apple 관련 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="ヤクソクAI" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        
        {/* ⭐ 아이콘 */}
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png" />
        
        {/* ⭐ DNS Prefetch */}
        <link rel="dns-prefetch" href="https://siyhjqjelkfgqznrpoqq.supabase.co" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
        <link rel="dns-prefetch" href="https://accounts.google.com" />
        
        {/* ⭐ Preconnect */}
        <link rel="preconnect" href="https://siyhjqjelkfgqznrpoqq.supabase.co" />
        <link rel="preconnect" href="https://www.googleapis.com" crossOrigin="anonymous" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        
        {/* ⭐ Service Worker 등록 스크립트 */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js')
                  .then(function(registration) {
                    console.log('✅ SW registered:', registration.scope);
                  })
                  .catch(function(error) {
                    console.log('❌ SW registration failed:', error);
                  });
              });
            }
          `
        }} />
      </body>
    </html>
  );
}
