'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Team {
  id: string
  name: string
  description: string | null
  owner_id: string
  created_at: string
  updated_at: string
}

interface TeamMember {
  id: string
  team_id: string
  user_id: string
  email: string
  role: string
  joined_at: string
}

export default function TeamsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamMembersCount, setTeamMembersCount] = useState<Record<string, number>>({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamDescription, setTeamDescription] = useState('')

  useEffect(() => {
    checkUser()
  }, [])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login')
      return
    }
    
    setUser(user)

    await updatePendingMemberships(user)
    await fetchTeams(user.id, user.email!)
    setLoading(false)
  }

  const updatePendingMemberships = async (user: any) => {
    try {
      console.log('🔍 updatePendingMemberships 시작')
      console.log('👤 User ID:', user.id)
      console.log('📧 User Email:', user.email)

      const { data: pendingMemberships, error: queryError } = await supabase
        .from('team_members')
        .select('*')
        .eq('email', user.email)
        .is('user_id', null)

      console.log('📊 Pending memberships:', pendingMemberships)
      if (queryError) console.error('❌ 조회 에러:', queryError)

      if (pendingMemberships && pendingMemberships.length > 0) {
        console.log(`✅ Found ${pendingMemberships.length} pending team memberships`)
        
        for (const membership of pendingMemberships) {
          console.log('🔄 Updating membership:', membership.id)
          
          const { data: updated, error: updateError } = await supabase
            .from('team_members')
            .update({ user_id: user.id })
            .eq('id', membership.id)
            .select()

          console.log('✅ Updated:', updated)
          if (updateError) console.error('❌ 업데이트 에러:', updateError)
        }
        
        console.log('✅ Team memberships updated!')
      } else {
        console.log('ℹ️ No pending memberships found')
      }
    } catch (error) {
      console.error('❌ Error updating memberships:', error)
    }
  }

  const fetchTeams = async (userId: string, userEmail: string) => {
    console.log('🔍 fetchTeams 시작')
    console.log('👤 userId:', userId)
    console.log('📧 userEmail:', userEmail)

    const { data: ownedTeams, error: ownedError } = await supabase
      .from('teams')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    console.log('✅ 소유한 팀:', ownedTeams?.length || 0)
    if (ownedError) console.error('❌ 소유 팀 조회 에러:', ownedError)

    const { data: memberTeamsByUserId, error: userIdError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    console.log('✅ user_id로 찾은 팀:', memberTeamsByUserId?.length || 0)
    if (userIdError) console.error('❌ user_id 조회 에러:', userIdError)

    const { data: memberTeamsByEmail, error: emailError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('email', userEmail)

    console.log('✅ email로 찾은 팀:', memberTeamsByEmail?.length || 0)
    if (emailError) console.error('❌ email 조회 에러:', emailError)

    const allMemberTeams = [
      ...(memberTeamsByUserId || []),
      ...(memberTeamsByEmail || [])
    ]

    console.log('✅ 전체 멤버 팀:', allMemberTeams.length)

    if (allMemberTeams.length > 0) {
      const memberTeamIds = [...new Set(allMemberTeams.map(m => m.team_id))]
      console.log('✅ 중복 제거 후 팀 ID:', memberTeamIds)

      const { data: memberTeamsData, error: teamsError } = await supabase
        .from('teams')
        .select('*')
        .in('id', memberTeamIds)
        .order('created_at', { ascending: false })

      console.log('✅ 멤버 팀 데이터:', memberTeamsData?.length || 0)
      if (teamsError) console.error('❌ 팀 데이터 조회 에러:', teamsError)

      const allTeams = [...(ownedTeams || []), ...(memberTeamsData || [])]
      const uniqueTeams = Array.from(new Map(allTeams.map(t => [t.id, t])).values())
      
      console.log('✅ 최종 팀 수:', uniqueTeams.length)
      setTeams(uniqueTeams)

      const counts: Record<string, number> = {}
      for (const team of uniqueTeams) {
        const { count } = await supabase
          .from('team_members')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', team.id)
        
        counts[team.id] = count || 0
      }
      setTeamMembersCount(counts)
    } else {
      console.log('⚠️ 멤버 팀 없음, 소유 팀만 표시')
      setTeams(ownedTeams || [])
      
      const counts: Record<string, number> = {}
      for (const team of (ownedTeams || [])) {
        const { count } = await supabase
          .from('team_members')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', team.id)
        
        counts[team.id] = count || 0
      }
      setTeamMembersCount(counts)
    }
  }

  const createTeam = async () => {
    if (!teamName.trim()) {
      alert('チーム名を入力してください')
      return
    }

    try {
      const { data: newTeam, error: teamError } = await supabase
        .from('teams')
        .insert({
          name: teamName,
          description: teamDescription || null,
          owner_id: user.id,
        })
        .select()
        .single()

      if (teamError) throw teamError

      const { error: memberError } = await supabase
        .from('team_members')
        .insert({
          team_id: newTeam.id,
          user_id: user.id,
          email: user.email,
          role: 'owner',
        })

      if (memberError) throw memberError

      alert('チームを作成しました')
      setTeamName('')
      setTeamDescription('')
      setShowCreateModal(false)
      
      await fetchTeams(user.id, user.email!)
    } catch (error) {
      console.error('Error creating team:', error)
      alert('チームの作成に失敗しました')
    }
  }

  const deleteTeam = async (teamId: string) => {
    if (!confirm('このチームを削除しますか？\nチーム内のスケジュールも削除されます。')) return

    try {
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', teamId)

      if (error) throw error

      alert('チームを削除しました')
      await fetchTeams(user.id, user.email!)
    } catch (error) {
      console.error('Error deleting team:', error)
      alert('チームの削除に失敗しました')
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 왼쪽 사이드바 - Navigation만 */}
      <aside className="w-64 bg-white shadow-lg flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">ヤクソクAI</h1>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                Navigation
              </h2>
            </div>
            <div className="space-y-1">
              <Link
                href="/dashboard"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                <span>📅</span>
                <span>スケジュール</span>
              </Link>
              <Link
                href="/teams"
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 font-medium"
              >
                <span>👥</span>
                <span>チーム管理</span>
              </Link>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                チーム一覧
              </h2>
            </div>
            <div className="space-y-1">
              {teams.length === 0 ? (
                <p className="text-xs text-gray-500 px-3 py-2">
                  チームがありません
                </p>
              ) : (
                teams.map((team) => (
                  <Link
                    key={team.id}
                    href={`/teams/${team.id}`}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span>👥</span>
                      <span className="truncate">{team.name}</span>
                    </div>
                    <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">
                      {teamMembersCount[team.id] || 0}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-700 truncate">{user?.email}</span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            ログアウト
          </button>
        </div>
      </aside>

      {/* 메인 컨텐츠 영역 */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">チーム管理</h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              + 新しいチーム作成
            </button>
          </div>

          {teams.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-8 text-center">
              <p className="text-gray-500 mb-4">
                まだチームがありません。新しいチームを作成してください。
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                + 新しいチーム作成
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((team) => (
                <div key={team.id} className="bg-white shadow rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                          {team.name}
                        </h3>
                        {team.description && (
                          <p className="text-sm text-gray-500 mb-3">
                            {team.description}
                          </p>
                        )}
                        <div className="flex items-center text-sm text-gray-500">
                          <span>👥 {teamMembersCount[team.id] || 0}名</span>
                        </div>
                      </div>
                      {team.owner_id === user.id && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Owner
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Link
                        href={`/teams/${team.id}`}
                        className="flex-1 text-center px-3 py-2 border border-blue-300 rounded-md text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100"
                      >
                        詳細
                      </Link>
                      {team.owner_id === user.id && (
                        <button
                          onClick={() => deleteTeam(team.id)}
                          className="px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              新しいチーム作成
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                チーム名 *
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="例：営業チーム"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                説明 (オプション)
              </label>
              <textarea
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                placeholder="例：営業部門のメンバー"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setTeamName('')
                  setTeamDescription('')
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={createTeam}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium"
              >
                作成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
