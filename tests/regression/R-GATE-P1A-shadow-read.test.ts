import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { compareContextGatewayShadowReadV1 } from '../../src/lib/context-gateway/shadow-read'
import { backfillResourceUidsV1 } from '../../src/lib/context-gateway/resource-identity'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import type { WorkspaceScope } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { stampNewRecord } from '../../src/lib/world-engine/scope'
import { buildRagLibrary } from '../../src/lib/retrieval/rag-library'
import { flushPendingEditsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { useWorldviewStore } from '../../src/stores/worldview'
import { useCharacterDrivenPlanStore } from '../../src/stores/character-driven-plan'

const NOW = 1_788_000_000_000

async function seedWorkspace(name: string) {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name, genre: 'fantasy', genres: ['fantasy'],
    status: 'drafting', description: '', targetWordCount: 1_000_000,
    createdAt: NOW, updatedAt: NOW,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  return { projectId, scope: ownership.scope }
}

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner?: 'world' | 'work',
): Promise<number> {
  return (db as any)[tableName].add(stampNewRecord(scope, tableName, {
    projectId: scope.projectId, createdAt: NOW, updatedAt: NOW, ...row,
  }, owner ? { owner } : {})) as Promise<number>
}

async function databaseHash(): Promise<string> {
  const tables = []
  for (const spec of PROJECT_TABLES) {
    tables.push({ table: spec.name, rows: await spec.table.toArray() })
  }
  return hashCanonicalValue(tables)
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useCharacterDrivenPlanStore.setState({ plans: [], currentPlanId: null, activePlanId: null, loading: false })
})
afterEach(async () => { await db.delete() })

describe('GATE-P1A · shadow read phase gate', () => {
  it('compares legacy and Gateway selection with zero model/tool/write side effects and stable evidence', async () => {
    const fixture = await seedWorkspace('盐海纪事')
    const groupA = await addScoped(fixture.scope, 'worldGroups', {
      name: '盐海', description: '主世界', type: 'primary', order: 0,
      entryCondition: '', exitCondition: '', powerRestriction: '', takeawayRules: '',
    }, 'world')
    const groupB = await addScoped(fixture.scope, 'worldGroups', {
      name: '镜界', description: '隔离世界', type: 'parallel', order: 1,
      entryCondition: '', exitCondition: '', powerRestriction: '', takeawayRules: '',
    }, 'world')
    const worldviewAId = await addScoped(fixture.scope, 'worldviews', {
      worldGroupId: groupA, races: '潮民与盐翼族共同守护航道。', cultureOverview: '誓言由潮钟见证。',
    }, 'world')
    const worldviewBId = await addScoped(fixture.scope, 'worldviews', {
      worldGroupId: groupB, races: '镜裔只存在于镜界。', cultureOverview: '倒影议会统治。',
    }, 'world')
    await addScoped(fixture.scope, 'storyCores', {
      logline: '潮民领航员寻找失落海图。', centralConflict: '族群存续与个人记忆冲突。',
    }, 'work')
    await addScoped(fixture.scope, 'characters', {
      homeWorldGroupId: groupA, isCrossWorld: false, name: '岚舟', role: 'protagonist',
      roleWeight: 'main', shortDescription: '失忆领航员', identity: '潮民', goals: '找回航路。',
    }, 'world')
    const foreign = await seedWorkspace('不应进入的项目')
    const foreignWorldviewId = await addScoped(foreign.scope, 'worldviews', {
      worldGroupId: null, races: '外部项目的星民。',
    }, 'world')

    const worldviewA = await db.worldviews.get(worldviewAId)
    const worldviewB = await db.worldviews.get(worldviewBId)
    const foreignWorldview = await db.worldviews.get(foreignWorldviewId)
    const before = await databaseHash()
    const requiredSkill = getAgentSkillV1('world-origin.worldview-field')
    const shadowSkill = {
      ...requiredSkill,
      contextGateway: { ...requiredSkill.contextGateway!, rollout: 'shadow' as const },
    }
    const first = await compareContextGatewayShadowReadV1({
      skill: shadowSkill,
      scope: fixture.scope,
      worldGroupId: groupA,
      query: '为潮民与盐翼族扩展社会关系',
    })
    const after = await databaseHash()

    expect(after).toBe(before)
    expect(first.scope).toEqual({ ...fixture.scope, worldGroupId: groupA })
    expect(first.legacy.includedSourceKeys).toEqual(expect.arrayContaining(['projectStatus', 'worldview', 'storyCore', 'characters']))
    expect(first.gateway.canonTables).toEqual(expect.arrayContaining(['worldviews', 'storyCores', 'characters']))
    expect(first.gateway.selectedResourceKeys.some(key => key.includes(worldviewA!.ragDocumentId!))).toBe(true)
    expect(first.gateway.selectedResourceKeys.some(key => key.includes(worldviewB!.ragDocumentId!))).toBe(false)
    expect(first.gateway.selectedResourceKeys.some(key => key.includes(foreignWorldview!.ragDocumentId!))).toBe(false)
    expect(first.gateway.planningModelCalls).toBe(0)
    expect(first.gateway.toolCalls).toBe(0)
    expect(first.gateway.packetHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.gateway.traceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.comparison.reasonCodes).toContain('shadow-read-only')

    const replay = await compareContextGatewayShadowReadV1({
      skill: shadowSkill,
      scope: fixture.scope,
      worldGroupId: groupA,
      query: '为潮民与盐翼族扩展社会关系',
    })
    expect(replay.reportHash).toBe(first.reportHash)
    expect(await databaseHash()).toBe(before)
  })

  it('rejects use outside an explicitly shadowed Skill instead of becoming a second production path', async () => {
    const fixture = await seedWorkspace('非 shadow 禁止双读')
    const skill = getAgentSkillV1('world-origin.worldview-field')
    await expect(compareContextGatewayShadowReadV1({
      skill: { ...skill, contextGateway: { ...skill.contextGateway!, rollout: 'required' } },
      scope: fixture.scope,
      worldGroupId: null,
    })).rejects.toThrow('未处于 shadow')
  })

  it('flushes pending author edits before sidebar navigation can build a new read view', () => {
    const source = readFileSync('src/pages/WorkspacePage.tsx', 'utf8')
    expect(source).toContain('await flushPendingEditsV1()')
    expect(source).toContain('onSelect={selectModule}')
    expect(source.indexOf('await flushPendingEditsV1()')).toBeLessThan(source.indexOf('setActiveModule(module)'))
    expect(source).toContain('当前编辑未能保存，已阻止切换页面')
  })

  it('invalidates an already-read catalog when a pending worldview edit creates its first Canon row', async () => {
    const fixture = await seedWorkspace('切页保存目录更新')
    expect(await buildRagLibrary({ projectId: fixture.projectId, scope: fixture.scope })).toHaveLength(0)
    await useWorldviewStore.getState().loadAll(fixture.scope)
    void useWorldviewStore.getState().saveWorldview({
      projectId: fixture.projectId,
      worldOrigin: '潮汐退去后，第一座浮空城从海床升起。',
    })
    await flushPendingEditsV1()
    const library = await buildRagLibrary({ projectId: fixture.projectId, scope: fixture.scope })
    expect(library).toEqual(expect.arrayContaining([
      expect.objectContaining({ tableName: 'worldviews', fieldKey: 'worldOrigin', title: '主世界观' }),
    ]))
  })

  it('allocates a new portable resource identity when a character-driven plan is copied', async () => {
    const fixture = await seedWorkspace('角色驱动复制身份')
    const sourceId = await useCharacterDrivenPlanStore.getState().createPlan(fixture.projectId, '潮钟弧光')
    const copiedId = await useCharacterDrivenPlanStore.getState().copyAsNewVersion(sourceId)
    const [source, copied] = await Promise.all([
      db.characterDrivenPlans.get(sourceId),
      db.characterDrivenPlans.get(copiedId),
    ])

    expect(source?.ragDocumentId).toMatch(/^res:v1:character-driven-plan:/)
    expect(copied?.ragDocumentId).toMatch(/^res:v1:character-driven-plan:/)
    expect(copied?.ragDocumentId).not.toBe(source?.ragDocumentId)
    await expect(backfillResourceUidsV1(fixture.projectId)).resolves.toMatchObject({ written: 0 })
  })
})
