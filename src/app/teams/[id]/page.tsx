'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Team {
  id: string
  name: string
  description: string | null
  owner_id: string
  created_at: string
}

interface TeamMember {
  id: string
  team_id: string
  user_id: string
  email: string
  role: string
  joined_at: string
}

export default function TeamDetailPage() {
  const router = useRouter()
  const params = useParams()
  const teamId = params.id as string

  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [teamMembersCount, setTeamMembersCount] = useState<Record<string, number>>({})

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
    await fetchTeamData(user.id, user.email!)
    setLoading(false)
  }

  const fetchTeamData = async (userId: string, userEmail: string) => {
    // 현재 팀 정보 가져오기
    const { data: teamData, error: teamError } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (teamError || !teamData) {
      alert('チームが見つかりません')
      router.push('/teams')
      return
    }

    setTeam(teamData)
    setIsOwner(teamData.owner_id === userId)

    // 팀원 목록 가져오기
    const { data: membersData } = await supabase
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .order('joined_at', { ascending: true })

    setMembers(membersData || [])

    // 사이드바용 전체 팀 목록 가져오기
    const { data: ownedTeams } = await supabase
      .from('teams')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    const { data: memberTeamsByUserId } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    const { data: memberTeamsByEmail } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('email', userEmail)

    const allMemberTeams = [
      ...(memberTeamsByUserId || []),
      ...(memberTeamsByEmail || [])
    ]

    if (allMemberTeams.length > 0) {
      const memberTeamIds = [...new Set(allMemberTeams.map(m => m.team_id))]

      const { data: memberTeamsData } = await supabase
        .from('teams')
        .select('*')
        .in('id', memberTeamIds)
        .order('created_at', { ascending: false })

      const allTeamsData = [...(ownedTeams || []), ...(memberTeamsData || [])]
      const uniqueTeams = Array.from(new Map(allTeamsData.map(t => [t.id, t])).values())
      
      setAllTeams(uniqueTeams)

      // 팀별 멤버 수 가져오기
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
      setAllTeams(ownedTeams || [])
      
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

  const addMember = async () => {
    if (!newMemberEmail.trim()) {
      alert('メールアドレスを入力してください')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(newMemberEmail)) {
      alert('正しいメールアドレスを入力してください')
      return
    }

    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('email', newMemberEmail.toLowerCase())

    if (existing && existing.length > 0) {
      alert('このメールアドレスは既にチームに追加されています')
      return
    }

    try {
      const { data, error: insertError } = await supabase
        .from('team_members')
        .insert({
          team_id: teamId,
          user_id: null,
          email: newMemberEmail.toLowerCase(),
          role: 'member',
        })
        .select()

      if (insertError) {
        if (insertError.code === '23505') {
          alert('このメールアドレスは既にチームに追加されています')
        } else {
          console.error('Error adding member:', insertError)
          alert('メンバーの追加に失敗しました')
        }
        return
      }

      alert('チームメンバーを追加しました')
      setNewMemberEmail('')
      setShowAddModal(false)
      
      if (user) {
        await fetchTeamData(user.id, user.email!)
      }
    } catch (error) {
      console.error('Error adding member:', error)
      alert('メンバーの追加に失敗しました')
    }
  }

  const removeMember = async (memberId: string, memberEmail: string) => {
    if (!confirm(`${memberEmail}をチームから削除しますか？`)) return

    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId)

      if (error) throw error

      alert('メンバーを削除しました')
      
      if (user) {
        await fetchTeamData(user.id, user.email!)
      }
    } catch (error) {
      console.error('Error removing member:', error)
      alert('メンバーの削除に失敗しました')
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

  if (!team) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 왼쪽 사이드바 */}
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
              {allTeams.length === 0 ? (
                <p className="text-xs text-gray-500 px-3 py-2">
                  チームがありません
                </p>
              ) : (
                allTeams.map((t) => (
                  <Link
                    key={t.id}
                    href={`/teams/${t.id}`}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      t.id === teamId
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span>👥</span>
                      <span className="truncate">{t.name}</span>
                    </div>
                    <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">
                      {teamMembersCount[t.id] || 0}
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
          <div className="mb-6">
            <Link
              href="/teams"
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              ← チーム一覧に戻る
            </Link>
          </div>

          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {team.name}
                </h2>
                {team.description && (
                  <p className="text-gray-600">{team.description}</p>
                )}
              </div>
              {isOwner && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  Owner
                </span>
              )}
            </div>
          </div>

          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                チームメンバー ({members.length}名)
              </h3>
              {isOwner && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                >
                  + メンバー追加
                </button>
              )}
            </div>

            {members.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-gray-500">
                  まだメンバーがいません。メンバーを追加してください。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {members.map((member) => (
                  <div key={member.id} className="px-6 py-4 flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {member.email}
                      </p>
                      <p className="text-xs text-gray-500">
                        参加日: {new Date(member.joined_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        member.role === 'owner' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {member.role === 'owner' ? 'Owner' : 'Member'}
                      </span>
                      {isOwner && member.role !== 'owner' && (
                        <button
                          onClick={() => removeMember(member.id, member.email)}
                          className="ml-2 px-3 py-1 border border-red-300 rounded-md text-xs font-medium text-red-700 bg-white hover:bg-red-50"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              メンバーを追加
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                メールアドレス
              </label>
              <input
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                placeholder="例：member@example.com"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                autoFocus
              />
              <p className="mt-2 text-xs text-gray-500">
                追加するメンバーのメールアドレスを入力してください
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowAddModal(false)
                  setNewMemberEmail('')
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={addMember}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
