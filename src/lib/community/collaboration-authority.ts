import { hashCanonicalValue } from '../agent/run/hash'

export type CreatorTeamRoleV1 = 'owner' | 'editor' | 'reviewer'

export interface CreatorTeamV1 {
  teamId: string
  name: string
  description: string
  createdBy: string
  createdAt: number
  updatedAt: number
}

export interface CreatorTeamMemberV1 {
  teamId: string
  userId: string
  role: CreatorTeamRoleV1
  status: 'invited' | 'active' | 'removed'
  invitedBy: string
  createdAt: number
  updatedAt: number
}

interface CreatorTeamInviteV1 {
  inviteId: string
  teamId: string
  invitedUserId: string
  role: Exclude<CreatorTeamRoleV1, 'owner'>
  tokenHash: string
  expiresAt: number
  acceptedAt: number | null
}

export interface CreatorChangeProposalV1 {
  proposalId: string
  teamId: string
  authorId: string
  baseReleaseHash: string
  candidateReleaseHash: string
  title: string
  summary: string
  evidenceHashes: string[]
  status: 'open' | 'accepted' | 'rejected' | 'withdrawn'
  reviewedBy: string | null
  reviewReason: string | null
  createdAt: number
  updatedAt: number
}

interface CollaborationReceiptV1 { fingerprint: string; result: unknown }
export interface CreatorCollaborationAuditV1 {
  sequence: number
  kind: string
  actorId: string
  subjectId: string
  createdAt: number
}

export interface CreatorCollaborationSnapshotV1 {
  schema: 'storyforge.creator-collaboration-snapshot'
  version: 1
  revision: number
  teams: CreatorTeamV1[]
  members: CreatorTeamMemberV1[]
  invites: CreatorTeamInviteV1[]
  proposals: CreatorChangeProposalV1[]
  receipts: Array<[string, CollaborationReceiptV1]>
  audits: CreatorCollaborationAuditV1[]
  updatedAt: number
  integrityHash: string
}

export interface CreatorCollaborationPersistenceV1 {
  load(): Promise<CreatorCollaborationSnapshotV1 | null>
  compareAndSwap(input: { expectedRevision: number | null; snapshot: CreatorCollaborationSnapshotV1 }): Promise<boolean>
}

export interface CreatorTeamReleasePolicyV1 {
  canPropose(input: { userId: string; teamId: string; baseReleaseHash: string; candidateReleaseHash: string }): Promise<boolean>
}

export class CreatorCollaborationErrorV1 extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[creator-collaboration:${code}] ${message}`)
    this.name = 'CreatorCollaborationErrorV1'
  }
}

function fail(code: string, message: string): never { throw new CreatorCollaborationErrorV1(code, message) }
function clone<T>(value: T): T { return structuredClone(value) }
function key(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || value.length > maximum || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    fail('protocol', `${label} 无效`)
  }
  return value
}
function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') fail('protocol', `${label} 无效`)
  const result = value.trim().normalize('NFC')
  if (!result || result.length > maximum) fail('protocol', `${label} 无效`)
  return result
}
function sha(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!/^[0-9a-f]{64}$/.test(result)) fail('protocol', `${label} 必须是 sha256`)
  return result
}
function memberKey(teamId: string, userId: string): string { return `${teamId}\u0000${userId}` }
function inviteToken(): string { return `${crypto.randomUUID()}.${crypto.randomUUID()}` }

export async function verifyCreatorCollaborationSnapshotV1(snapshot: CreatorCollaborationSnapshotV1): Promise<void> {
  if (snapshot.schema !== 'storyforge.creator-collaboration-snapshot' || snapshot.version !== 1
    || !Number.isInteger(snapshot.revision) || snapshot.revision < 1 || !Array.isArray(snapshot.teams)
    || !Array.isArray(snapshot.members) || !Array.isArray(snapshot.invites) || !Array.isArray(snapshot.proposals)
    || !Array.isArray(snapshot.receipts) || !Array.isArray(snapshot.audits)) {
    fail('snapshot_invalid', '创作者协作快照结构无效')
  }
  const { integrityHash, ...body } = snapshot
  if (await hashCanonicalValue(body) !== integrityHash) fail('snapshot_corrupt', '创作者协作快照完整性校验失败')
}

export class CreatorCollaborationAuthorityV1 {
  private revision = 0
  private readonly teams = new Map<string, CreatorTeamV1>()
  private readonly members = new Map<string, CreatorTeamMemberV1>()
  private readonly invites = new Map<string, CreatorTeamInviteV1>()
  private readonly proposals = new Map<string, CreatorChangeProposalV1>()
  private readonly receipts = new Map<string, CollaborationReceiptV1>()
  private readonly audits: CreatorCollaborationAuditV1[] = []
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly persistence: CreatorCollaborationPersistenceV1,
    private readonly releasePolicy: CreatorTeamReleasePolicyV1,
    private readonly now: () => number,
  ) {}

  static async create(input: {
    persistence: CreatorCollaborationPersistenceV1
    releasePolicy: CreatorTeamReleasePolicyV1
    now?: () => number
  }): Promise<CreatorCollaborationAuthorityV1> {
    const authority = new CreatorCollaborationAuthorityV1(input.persistence, input.releasePolicy, input.now ?? (() => Date.now()))
    await authority.persist(null)
    return authority
  }

  static async restore(input: {
    persistence: CreatorCollaborationPersistenceV1
    releasePolicy: CreatorTeamReleasePolicyV1
    now?: () => number
  }): Promise<CreatorCollaborationAuthorityV1> {
    const snapshot = await input.persistence.load()
    if (!snapshot) fail('snapshot_missing', '创作者协作快照不存在')
    await verifyCreatorCollaborationSnapshotV1(snapshot)
    const authority = new CreatorCollaborationAuthorityV1(input.persistence, input.releasePolicy, input.now ?? (() => Date.now()))
    authority.restoreLocal(snapshot)
    return authority
  }

  createTeam(input: { userId: string; requestId: string; name: string; description: string }): Promise<CreatorTeamV1> {
    const userId = key(input.userId, 'userId')
    return this.command(userId, input.requestId, input, async () => {
      const createdAt = this.now()
      const team: CreatorTeamV1 = {
        teamId: `team.${crypto.randomUUID()}`, name: text(input.name, 'name', 200),
        description: text(input.description, 'description', 2_000), createdBy: userId, createdAt, updatedAt: createdAt,
      }
      this.teams.set(team.teamId, team)
      this.members.set(memberKey(team.teamId, userId), {
        teamId: team.teamId, userId, role: 'owner', status: 'active', invitedBy: userId,
        createdAt, updatedAt: createdAt,
      })
      this.audit('team.created', userId, team.teamId)
      return clone(team)
    })
  }

  inviteMember(input: {
    userId: string
    requestId: string
    teamId: string
    invitedUserId: string
    role: Exclude<CreatorTeamRoleV1, 'owner'>
    expiresAt: number
  }): Promise<{ inviteId: string; inviteToken: string }> {
    const userId = key(input.userId, 'userId')
    return this.command(userId, input.requestId, input, async () => {
      const teamId = key(input.teamId, 'teamId')
      this.requireRole(teamId, userId, ['owner'])
      const invitedUserId = key(input.invitedUserId, 'invitedUserId')
      if (invitedUserId === userId || !['editor', 'reviewer'].includes(input.role)
        || !Number.isInteger(input.expiresAt) || input.expiresAt <= this.now()) fail('protocol', '邀请字段无效')
      const existing = this.members.get(memberKey(teamId, invitedUserId))
      if (existing?.status === 'active') fail('member_exists', '用户已经是团队成员')
      const token = inviteToken()
      const invite: CreatorTeamInviteV1 = {
        inviteId: `team-invite.${crypto.randomUUID()}`, teamId, invitedUserId, role: input.role,
        tokenHash: await hashCanonicalValue(token), expiresAt: input.expiresAt, acceptedAt: null,
      }
      this.invites.set(invite.inviteId, invite)
      const createdAt = this.now()
      this.members.set(memberKey(teamId, invitedUserId), {
        teamId, userId: invitedUserId, role: input.role, status: 'invited', invitedBy: userId,
        createdAt: existing?.createdAt ?? createdAt, updatedAt: createdAt,
      })
      this.audit('team.member.invited', userId, invitedUserId)
      return { inviteId: invite.inviteId, inviteToken: token }
    })
  }

  acceptInvite(input: { userId: string; requestId: string; inviteId: string; inviteToken: string }): Promise<CreatorTeamMemberV1> {
    const userId = key(input.userId, 'userId')
    return this.command(userId, input.requestId, { ...input, inviteToken: '[redacted]' }, async () => {
      const invite = this.invites.get(key(input.inviteId, 'inviteId'))
      if (!invite || invite.invitedUserId !== userId || invite.acceptedAt != null || invite.expiresAt <= this.now()
        || invite.tokenHash !== await hashCanonicalValue(text(input.inviteToken, 'inviteToken', 500))) {
        fail('invite_invalid', '团队邀请不存在、过期或凭据无效')
      }
      const member = this.members.get(memberKey(invite.teamId, userId))
      if (!member || member.status !== 'invited' || member.role !== invite.role) fail('invite_invalid', '团队邀请状态不一致')
      invite.acceptedAt = this.now()
      member.status = 'active'
      member.updatedAt = this.now()
      this.audit('team.member.joined', userId, invite.teamId)
      return clone(member)
    })
  }

  changeMember(input: {
    userId: string
    requestId: string
    teamId: string
    memberUserId: string
    role: Exclude<CreatorTeamRoleV1, 'owner'>
    status: 'active' | 'removed'
  }): Promise<CreatorTeamMemberV1> {
    const userId = key(input.userId, 'userId')
    return this.command(userId, input.requestId, input, async () => {
      const teamId = key(input.teamId, 'teamId')
      this.requireRole(teamId, userId, ['owner'])
      const target = this.members.get(memberKey(teamId, key(input.memberUserId, 'memberUserId')))
      if (!target || target.role === 'owner' || !['editor', 'reviewer'].includes(input.role)
        || !['active', 'removed'].includes(input.status)) fail('member_invalid', '成员变更无效')
      target.role = input.role
      target.status = input.status
      target.updatedAt = this.now()
      this.audit(`team.member.${input.status}`, userId, target.userId)
      return clone(target)
    })
  }

  createProposal(input: {
    userId: string
    requestId: string
    teamId: string
    baseReleaseHash: string
    candidateReleaseHash: string
    title: string
    summary: string
    evidenceHashes: string[]
  }): Promise<CreatorChangeProposalV1> {
    const userId = key(input.userId, 'userId')
    return this.command(userId, input.requestId, input, async () => {
      const teamId = key(input.teamId, 'teamId')
      this.requireRole(teamId, userId, ['owner', 'editor'])
      const baseReleaseHash = sha(input.baseReleaseHash, 'baseReleaseHash')
      const candidateReleaseHash = sha(input.candidateReleaseHash, 'candidateReleaseHash')
      if (baseReleaseHash === candidateReleaseHash) fail('proposal_invalid', '候选 Release 必须不同于基线')
      if (!await this.releasePolicy.canPropose({ userId, teamId, baseReleaseHash, candidateReleaseHash })) {
        fail('release_forbidden', '团队无权提交该 Release 变更')
      }
      if (!Array.isArray(input.evidenceHashes) || input.evidenceHashes.length < 1 || input.evidenceHashes.length > 100) {
        fail('protocol', 'evidenceHashes 无效')
      }
      const evidenceHashes = input.evidenceHashes.map((value, index) => sha(value, `evidenceHashes[${index}]`))
      if (new Set(evidenceHashes).size !== evidenceHashes.length) fail('protocol', 'evidenceHashes 不能重复')
      const createdAt = this.now()
      const proposal: CreatorChangeProposalV1 = {
        proposalId: `proposal.${crypto.randomUUID()}`, teamId, authorId: userId,
        baseReleaseHash, candidateReleaseHash, title: text(input.title, 'title', 300),
        summary: text(input.summary, 'summary', 4_000), evidenceHashes, status: 'open',
        reviewedBy: null, reviewReason: null, createdAt, updatedAt: createdAt,
      }
      this.proposals.set(proposal.proposalId, proposal)
      this.audit('proposal.created', userId, proposal.proposalId)
      return clone(proposal)
    })
  }

  reviewProposal(input: {
    userId: string
    requestId: string
    proposalId: string
    decision: 'accept' | 'reject'
    reason: string
  }): Promise<CreatorChangeProposalV1> {
    const userId = key(input.userId, 'userId')
    return this.command(userId, input.requestId, input, async () => {
      const proposal = this.requireProposal(input.proposalId)
      this.requireRole(proposal.teamId, userId, ['owner', 'reviewer'])
      if (proposal.status !== 'open') fail('invalid_transition', '提案已经结束')
      if (proposal.authorId === userId) fail('independent_review_required', '提案作者不能审阅自己的变更')
      if (!['accept', 'reject'].includes(input.decision)) fail('protocol', 'review decision 无效')
      proposal.status = input.decision === 'accept' ? 'accepted' : 'rejected'
      proposal.reviewedBy = userId
      proposal.reviewReason = text(input.reason, 'reason', 2_000)
      proposal.updatedAt = this.now()
      this.audit(`proposal.${proposal.status}`, userId, proposal.proposalId)
      return clone(proposal)
    })
  }

  withdrawProposal(input: { userId: string; requestId: string; proposalId: string }): Promise<CreatorChangeProposalV1> {
    const userId = key(input.userId, 'userId')
    return this.command(userId, input.requestId, input, async () => {
      const proposal = this.requireProposal(input.proposalId)
      if (proposal.authorId !== userId || proposal.status !== 'open') fail('invalid_transition', '只有作者可撤回开放提案')
      proposal.status = 'withdrawn'
      proposal.updatedAt = this.now()
      this.audit('proposal.withdrawn', userId, proposal.proposalId)
      return clone(proposal)
    })
  }

  team(teamId: string): CreatorTeamV1 | null { return clone(this.teams.get(key(teamId, 'teamId')) ?? null) }
  teamMembers(teamId: string): CreatorTeamMemberV1[] {
    const id = key(teamId, 'teamId')
    return [...this.members.values()].filter(row => row.teamId === id && row.status === 'active').map(clone)
  }
  teamProposals(teamId: string): CreatorChangeProposalV1[] {
    const id = key(teamId, 'teamId')
    return [...this.proposals.values()].filter(row => row.teamId === id).map(clone)
  }
  auditLog(): CreatorCollaborationAuditV1[] { return this.audits.map(clone) }

  private requireRole(teamId: string, userId: string, allowed: CreatorTeamRoleV1[]): CreatorTeamMemberV1 {
    if (!this.teams.has(teamId)) fail('team_not_found', '创作者团队不存在')
    const member = this.members.get(memberKey(teamId, userId))
    if (!member || member.status !== 'active' || !allowed.includes(member.role)) fail('forbidden', '团队角色无权执行此操作')
    return member
  }
  private requireProposal(proposalId: string): CreatorChangeProposalV1 {
    const proposal = this.proposals.get(key(proposalId, 'proposalId'))
    if (!proposal) fail('proposal_not_found', '变更提案不存在')
    return proposal
  }
  private audit(kind: string, actorId: string, subjectId: string): void {
    this.audits.push({ sequence: this.audits.length + 1, kind, actorId, subjectId, createdAt: this.now() })
  }
  private command<T>(actorId: string, requestIdValue: string, body: unknown, operation: () => Promise<T>): Promise<T> {
    const requestId = key(requestIdValue, 'requestId')
    return this.mutate(async () => {
      const receiptKey = `${actorId}\u0000${requestId}`
      const fingerprint = await hashCanonicalValue({ actorId, requestId, body })
      const prior = this.receipts.get(receiptKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('request_conflict', 'requestId 已被不同命令使用')
        return clone(prior.result) as T
      }
      const result = await operation()
      this.receipts.set(receiptKey, { fingerprint, result: clone(result) })
      return result
    })
  }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void
    const previous = this.mutationTail
    this.mutationTail = new Promise(resolve => { release = resolve })
    await previous
    const backup = await this.snapshot(this.revision)
    try {
      const result = await operation()
      await this.persist(this.revision)
      return result
    } catch (error) {
      this.restoreLocal(backup)
      throw error
    } finally { release() }
  }
  private async persist(expectedRevision: number | null): Promise<void> {
    const revision = expectedRevision == null ? 1 : expectedRevision + 1
    const snapshot = await this.snapshot(revision)
    if (!await this.persistence.compareAndSwap({ expectedRevision, snapshot })) fail('persistence_conflict', '创作者协作持久化版本冲突')
    this.revision = revision
  }
  private async snapshot(revision: number): Promise<CreatorCollaborationSnapshotV1> {
    const body: Omit<CreatorCollaborationSnapshotV1, 'integrityHash'> = {
      schema: 'storyforge.creator-collaboration-snapshot', version: 1, revision,
      teams: [...this.teams.values()].map(clone), members: [...this.members.values()].map(clone),
      invites: [...this.invites.values()].map(clone), proposals: [...this.proposals.values()].map(clone),
      receipts: clone([...this.receipts]), audits: this.audits.map(clone), updatedAt: this.now(),
    }
    return { ...body, integrityHash: await hashCanonicalValue(body) }
  }
  private restoreLocal(snapshot: CreatorCollaborationSnapshotV1): void {
    this.revision = snapshot.revision
    this.teams.clear(); this.members.clear(); this.invites.clear(); this.proposals.clear(); this.receipts.clear()
    for (const row of snapshot.teams) this.teams.set(row.teamId, clone(row))
    for (const row of snapshot.members) this.members.set(memberKey(row.teamId, row.userId), clone(row))
    for (const row of snapshot.invites) this.invites.set(row.inviteId, clone(row))
    for (const row of snapshot.proposals) this.proposals.set(row.proposalId, clone(row))
    for (const [receiptKey, receipt] of snapshot.receipts) this.receipts.set(receiptKey, clone(receipt))
    this.audits.splice(0, this.audits.length, ...snapshot.audits.map(clone))
  }
}
