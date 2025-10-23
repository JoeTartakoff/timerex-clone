import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  try {
    console.log('📅 Fetching public schedules...')
    
    const { data: schedules, error } = await supabase
      .from('schedules')
      .select('id, title, description, share_link, date_range_start, date_range_end, is_candidate_mode, is_interview_mode')
      .eq('is_one_time_link', false)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Supabase error:', error)
      throw error
    }

    console.log(`✅ Found ${schedules?.length || 0} schedules`)

    return NextResponse.json({
      success: true,
      schedules: schedules || []
    })
  } catch (error: any) {
    console.error('❌ Error fetching schedules:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
