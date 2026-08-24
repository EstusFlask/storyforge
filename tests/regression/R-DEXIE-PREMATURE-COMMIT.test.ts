import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendAgentEvent, getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { db } from '../../src/lib/db/schema'
import type { AgentEvent, Character, WorkspaceScope } from '../../src/lib/types'
import { readOwnedRows, scopeTransactionTables } from '../../src/lib/world-engine/scope'

async function createWorkspace(): Promise<WorkspaceScope> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'Dexie transaction longevity',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'dexie-transaction-longevity',
    name: '事务世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '事务作品',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  return { projectId, worldId, workId }
}

describe.sequential('R-DEXIE-PREMATURE-COMMIT · large scoped reads keep write transactions alive', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('filters a populated World collection before writing in the same transaction', async () => {
    const scope = await createWorkspace()
    const now = Date.now()
    const characters = Array.from({ length: 96 }, (_, index) => ({
      projectId: scope.projectId,
      worldId: scope.worldId,
      name: `存量角色 ${index + 1}`,
      role: 'minor',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      homeWorldGroupId: null,
      isCrossWorld: false,
      createdAt: now,
      updatedAt: now,
    })) as Character[]
    await db.characters.bulkAdd(characters)

    await db.transaction('rw', scopeTransactionTables(db.characters), async () => {
      const owned = await readOwnedRows<Character>(scope, 'characters', { owner: 'world' })
      expect(owned).toHaveLength(96)
      await db.characters.add({
        ...characters[0],
        id: undefined,
        name: '事务末尾新增角色',
      })
    })

    expect(await db.characters.where('projectId').equals(scope.projectId).count()).toBe(97)
  })

  it('appends the next sequence after a long Agent conversation', async () => {
    const scope = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: scope.projectId,
      worldGroupId: null,
      scope,
    })
    const now = Date.now()
    const events = Array.from({ length: 160 }, (_, index) => ({
      projectId: scope.projectId,
      workId: scope.workId,
      conversationId: conversation.id!,
      durableRunId: null,
      sequence: index + 1,
      kind: 'message' as const,
      role: 'assistant' as const,
      content: `历史事件 ${index + 1}`,
      payload: '{}',
      createdAt: now + index,
    })) satisfies AgentEvent[]
    await db.agentEvents.bulkAdd(events)

    const appended = await appendAgentEvent({
      projectId: scope.projectId,
      scope,
      conversationId: conversation.id!,
      kind: 'message',
      role: 'user',
      content: '继续使用 AI',
    })

    expect(appended.sequence).toBe(161)
    expect(await db.agentEvents.where('conversationId').equals(conversation.id!).count()).toBe(161)
  })
})
