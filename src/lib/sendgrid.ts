import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

interface BookingEmailData {
  scheduleTitle: string
  guestName: string
  guestEmail: string
  hostName: string
  hostEmail: string
  bookingDate: string
  startTime: string
  endTime: string
  meetLink?: string
  bookingMode: 'normal' | 'propose_times' | 'receive_proposals'
}

export async function sendHostBookingNotification(data: BookingEmailData) {
  const {
    scheduleTitle,
    guestName,
    guestEmail,
    hostName,
    hostEmail,
    bookingDate,
    startTime,
    endTime,
    meetLink,
    bookingMode
  } = data

  const modeText = {
    normal: '通常予約',
    propose_times: '候補時間を提示',
    receive_proposals: '候補日を受取'
  }[bookingMode]

  const meetSection = meetLink
    ? `
    <div style="margin: 20px 0; padding: 15px; background-color: #EFF6FF; border-radius: 8px;">
      <p style="margin: 0 0 10px 0; font-weight: bold; color: #1E40AF;">
        🎥 Google Meet
      </p>
      <a href="${meetLink}" 
         style="color: #2563EB; text-decoration: none; word-break: break-all;">
        ${meetLink}
      </a>
    </div>
    `
    : ''

  const msg = {
    to: hostEmail,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL!,
      name: process.env.SENDGRID_FROM_NAME!,
    },
    subject: `【予約完了】${guestName}様からの予約 - ${scheduleTitle}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #3B82F6; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">📅 新しい予約が入りました</h1>
        </div>
        
        <div style="background-color: #F9FAFB; padding: 30px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            ${hostName}様
          </p>
          
          <p style="font-size: 16px; margin-bottom: 30px;">
            以下の予約が完了しました。Googleカレンダーに自動的に追加されています。
          </p>
          
          <div style="background-color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3B82F6;">
            <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #1F2937;">
              ${scheduleTitle}
            </h2>
            
            <div style="margin-bottom: 10px;">
              <strong>予約タイプ:</strong> ${modeText}
            </div>
            
            <div style="margin-bottom: 10px;">
              <strong>ゲスト:</strong> ${guestName}
            </div>
            
            <div style="margin-bottom: 10px;">
              <strong>メールアドレス:</strong> 
              <a href="mailto:${guestEmail}" style="color: #2563EB; text-decoration: none;">
                ${guestEmail}
              </a>
            </div>
            
            <div style="margin-bottom: 10px;">
              <strong>日時:</strong> ${bookingDate}
            </div>
            
            <div style="margin-bottom: 0;">
              <strong>時間:</strong> ${startTime} - ${endTime}
            </div>
          </div>
          
          ${meetSection}
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
            <p style="font-size: 14px; color: #6B7280; margin: 0;">
              このメールは予約完了時に自動送信されています。<br>
              Googleカレンダーをご確認ください。
            </p>
          </div>
        </div>
        
        <div style="text-align: center; margin-top: 20px; padding: 20px;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" 
             style="display: inline-block; background-color: #3B82F6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            ダッシュボードを見る
          </a>
        </div>
      </body>
      </html>
    `,
  }

  try {
    await sgMail.send(msg)
    console.log('✅ Host notification email sent to:', hostEmail)
    return { success: true }
  } catch (error) {
    console.error('❌ Failed to send host notification email:', error)
    return { success: false, error }
  }
}

export async function sendGuestBookingConfirmation(data: BookingEmailData) {
  const {
    scheduleTitle,
    guestName,
    guestEmail,
    hostName,
    bookingDate,
    startTime,
    endTime,
    meetLink,
    bookingMode
  } = data

  const modeText = {
    normal: '予約が確定しました',
    propose_times: '候補時間から選択されました',
    receive_proposals: 'ホストが承認しました'
  }[bookingMode]

  const meetSection = meetLink
    ? `
    <div style="margin: 20px 0; padding: 15px; background-color: #EFF6FF; border-radius: 8px;">
      <p style="margin: 0 0 10px 0; font-weight: bold; color: #1E40AF;">
        🎥 Google Meet に参加
      </p>
      <a href="${meetLink}" 
         style="display: inline-block; background-color: #2563EB; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin-top: 10px;">
        ミーティングに参加
      </a>
    </div>
    `
    : ''

  const calendarSection = `
    <div style="margin: 20px 0;">
      <p style="margin: 0 0 10px 0; font-weight: bold;">
        📅 カレンダーに追加
      </p>
      <p style="font-size: 14px; color: #6B7280; margin: 0;">
        ${hostName}様からのカレンダー招待メールをご確認ください。<br>
        「はい」をクリックすると、あなたのGoogleカレンダーに自動的に追加されます。
      </p>
    </div>
  `

  const msg = {
    to: guestEmail,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL!,
      name: process.env.SENDGRID_FROM_NAME!,
    },
    subject: `【予約確認】${scheduleTitle} - ${bookingDate} ${startTime}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #10B981; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">✅ 予約が完了しました</h1>
        </div>
        
        <div style="background-color: #F9FAFB; padding: 30px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            ${guestName}様
          </p>
          
          <p style="font-size: 16px; margin-bottom: 30px;">
            ${modeText}。以下の内容で予約が確定しました。
          </p>
          
          <div style="background-color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #10B981;">
            <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #1F2937;">
              ${scheduleTitle}
            </h2>
            
            <div style="margin-bottom: 10px;">
              <strong>ホスト:</strong> ${hostName}
            </div>
            
            <div style="margin-bottom: 10px;">
              <strong>日時:</strong> ${bookingDate}
            </div>
            
            <div style="margin-bottom: 0;">
              <strong>時間:</strong> ${startTime} - ${endTime}
            </div>
          </div>
          
          ${meetSection}
          
          ${calendarSection}
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
            <p style="font-size: 14px; color: #6B7280; margin: 0;">
              ご不明な点がございましたら、ホストに直接お問い合わせください。
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  }

  try {
    await sgMail.send(msg)
    console.log('✅ Guest confirmation email sent to:', guestEmail)
    return { success: true }
  } catch (error) {
    console.error('❌ Failed to send guest confirmation email:', error)
    return { success: false, error }
  }
}

export async function sendBookingNotifications(data: BookingEmailData) {
  console.log('\n📧 === SENDING BOOKING NOTIFICATIONS ===')
  
  const [hostResult, guestResult] = await Promise.all([
    sendHostBookingNotification(data),
    sendGuestBookingConfirmation(data),
  ])

  console.log('📧 Host email:', hostResult.success ? '✅ Sent' : '❌ Failed')
  console.log('📧 Guest email:', guestResult.success ? '✅ Sent' : '❌ Failed')
  console.log('📧 === NOTIFICATIONS COMPLETED ===\n')

  return {
    host: hostResult,
    guest: guestResult,
    allSuccess: hostResult.success && guestResult.success,
  }
}
