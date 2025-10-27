import { NextResponse } from 'next/server'
import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

export async function GET() {
  try {
    console.log('📧 Testing SendGrid...')
    console.log('From:', process.env.SENDGRID_FROM_EMAIL)
    console.log('Name:', process.env.SENDGRID_FROM_NAME)
    
    const msg = {
      to: 'gogumatruck@gmail.com',
      from: {
        email: process.env.SENDGRID_FROM_EMAIL!,
        name: process.env.SENDGRID_FROM_NAME!,
      },
      subject: 'SendGrid テスト - Yakusoku-AI',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h1 style="color: #3B82F6;">✅ SendGrid 動作確認</h1>
          <p>このメールが届いたら、SendGridの設定が正常に完了しています！</p>
          <hr>
          <p style="color: #6B7280; font-size: 14px;">
            From: ${process.env.SENDGRID_FROM_EMAIL}<br>
            Name: ${process.env.SENDGRID_FROM_NAME}
          </p>
        </body>
        </html>
      `,
    }

    await sgMail.send(msg)
    
    console.log('✅ Test email sent successfully!')
    
    return NextResponse.json({ 
      success: true,
      message: 'Test email sent!',
      from: process.env.SENDGRID_FROM_EMAIL,
      fromName: process.env.SENDGRID_FROM_NAME,
      to: 'gogumatruck@gmail.com'
    })
    
  } catch (error: any) {
    console.error('❌ SendGrid error:', error)
    
    return NextResponse.json({ 
      success: false,
      error: error.message,
      details: error.response?.body,
      code: error.code
    }, { status: 500 })
  }
}
