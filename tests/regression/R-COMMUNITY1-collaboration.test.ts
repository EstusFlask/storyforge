import { describe, expect, it } from 'vitest'
import {
  CreatorCollaborationAuthorityV1,
  type CreatorCollaborationPersistenceV1,
  type CreatorCollaborationSnapshotV1,
} from '../../src/lib/community/collaboration-authority'

class Store implements CreatorCollaborationPersistenceV1 {
  snapshot: CreatorCollaborationSnapshotV1 | null = null
  failNext = false
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CreatorCollaborationSnapshotV1 }) {
    if (this.failNext) { this.failNext = false; return false }
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

const BASE = '1'.repeat(64)
const CANDIDATE = '2'.repeat(64)
const EVIDENCE = '3'.repeat(64)

describe('COMMUNITY-1 · creator team permissions and review', () => {
  it('所有者邀请编辑与审阅者，编辑提交 Release 提案且必须由另一账号独立审阅', async () => {
    let now = 1_800_000_000_000
    const store = new Store()
    const authority = await CreatorCollaborationAuthorityV1.create({
      persistence: store, now: () => now,
      releasePolicy: { canPropose: async ({ teamId }) => teamId.startsWith('team.') },
    })
    const team = await authority.createTeam({
      userId: 'user.owner', requestId: 'team.create', name: '雾港工坊', description: '共同维护战役。',
    })
    const editorInvite = await authority.inviteMember({
      userId: 'user.owner', requestId: 'invite.editor', teamId: team.teamId,
      invitedUserId: 'user.editor', role: 'editor', expiresAt: now + 60_000,
    })
    await expect(authority.acceptInvite({
      userId: 'user.editor', requestId: 'accept.bad', inviteId: editorInvite.inviteId,
      inviteToken: 'invalid-token-at-least-16',
    })).rejects.toThrow('凭据无效')
    await authority.acceptInvite({
      userId: 'user.editor', requestId: 'accept.editor', ...editorInvite,
    })
    const reviewerInvite = await authority.inviteMember({
      userId: 'user.owner', requestId: 'invite.reviewer', teamId: team.teamId,
      invitedUserId: 'user.reviewer', role: 'reviewer', expiresAt: now + 60_000,
    })
    await authority.acceptInvite({ userId: 'user.reviewer', requestId: 'accept.reviewer', ...reviewerInvite })

    const proposal = await authority.createProposal({
      userId: 'user.owner', requestId: 'proposal.create', teamId: team.teamId,
      baseReleaseHash: BASE, candidateReleaseHash: CANDIDATE, title: '修复第二幕线索锁死',
      summary: '增加失败前进路径，并保留旧存档兼容。', evidenceHashes: [EVIDENCE],
    })
    await expect(authority.reviewProposal({
      userId: 'user.owner', requestId: 'proposal.self-review', proposalId: proposal.proposalId,
      decision: 'accept', reason: '我自己确认。',
    })).rejects.toThrow('不能审阅自己的变更')
    const accepted = await authority.reviewProposal({
      userId: 'user.reviewer', requestId: 'proposal.review', proposalId: proposal.proposalId,
      decision: 'accept', reason: '回归、兼容与来源证据完整。',
    })
    expect(accepted).toMatchObject({ status: 'accepted', reviewedBy: 'user.reviewer' })
    expect(authority.teamMembers(team.teamId).map(member => member.role).sort()).toEqual(['editor', 'owner', 'reviewer'])
    expect(JSON.stringify(authority.auditLog())).not.toContain(editorInvite.inviteToken)

    now += 1_000
    const restored = await CreatorCollaborationAuthorityV1.restore({
      persistence: store, now: () => now, releasePolicy: { canPropose: async () => true },
    })
    expect(restored.teamProposals(team.teamId)).toMatchObject([{ proposalId: proposal.proposalId, status: 'accepted' }])
  })

  it('角色越权、过期邀请、Release 越权与 CAS 冲突均回滚', async () => {
    let now = 1_800_000_100_000
    const store = new Store()
    const authority = await CreatorCollaborationAuthorityV1.create({
      persistence: store, now: () => now, releasePolicy: { canPropose: async () => false },
    })
    const team = await authority.createTeam({
      userId: 'user.owner', requestId: 'team.create', name: '测试团队', description: '验证边界。',
    })
    const invite = await authority.inviteMember({
      userId: 'user.owner', requestId: 'invite.editor', teamId: team.teamId,
      invitedUserId: 'user.editor', role: 'editor', expiresAt: now + 1,
    })
    now += 2
    await expect(authority.acceptInvite({
      userId: 'user.editor', requestId: 'accept.expired', ...invite,
    })).rejects.toThrow('过期')
    await expect(authority.inviteMember({
      userId: 'user.stranger', requestId: 'invite.unauthorized', teamId: team.teamId,
      invitedUserId: 'user.other', role: 'reviewer', expiresAt: now + 60_000,
    })).rejects.toThrow('无权')
    await expect(authority.createProposal({
      userId: 'user.owner', requestId: 'proposal.forbidden', teamId: team.teamId,
      baseReleaseHash: BASE, candidateReleaseHash: CANDIDATE, title: '无权版本',
      summary: '策略必须拒绝。', evidenceHashes: [EVIDENCE],
    })).rejects.toThrow('无权提交')

    store.failNext = true
    await expect(authority.createTeam({
      userId: 'user.owner', requestId: 'team.rollback', name: '不应残留', description: 'CAS 冲突。',
    })).rejects.toThrow('持久化版本冲突')
    expect(store.snapshot!.teams).toHaveLength(1)
    store.snapshot!.teams[0].name = '被篡改'
    await expect(CreatorCollaborationAuthorityV1.restore({
      persistence: store, releasePolicy: { canPropose: async () => true },
    })).rejects.toThrow('完整性校验失败')
  })
})
