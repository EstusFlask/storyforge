import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  buildSimulationCanonSnapshot,
  loadSimulationCanonCandidates,
  parseSimulationCanonSnapshot,
  verifySimulationCanonSnapshot,
} from '../../src/lib/simulation/canon-snapshot'
import {
  branchSimulationSession,
  createSimulationSession,
  readSimulationState,
} from '../../src/lib/simulation/runtime'
import type { Character, Project } from '../../src/lib/types'
import { useSimulationRuntimeStore } from '../../src/stores/simulation-runtime'

const now = 1_720_000_000_000

async function seedCanon() {
  const projectId = await db.projects.add({
    name: '冻结测试项目',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '潮汐世界',
    targetWordCount: 80_000,
    enableMultiWorld: true,
    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '潮汐界',
    description: '潮位决定城市通行。',
    type: 'primary',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  const hiddenWorldGroupId = await db.worldGroups.add({
    projectId,
    name: '镜面界',
    description: '不应进入当前冻结候选。',
    type: 'parallel',
    order: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const characterId = await db.characters.add({
    projectId,
    homeWorldGroupId: worldGroupId,
    name: '林舟',
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    alignment: 'good',
    shortDescription: '潮汐旅人',
    appearance: '银灰斗篷',
    personality: '谨慎',
    background: '来自旧港',
    motivation: '寻找潮汐钥匙',
    abilities: '听潮',
    relationships: '',
    arc: '从逃避到承担',
    location: '雾港',
    createdAt: now,
    updatedAt: now,
  } as Character) as number
  await db.characters.add({
    projectId,
    homeWorldGroupId: hiddenWorldGroupId,
    name: '镜中人',
    role: 'npc',
    roleWeight: 'npc',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '另一世界角色',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '',
    arc: '',
    createdAt: now,
    updatedAt: now,
  } as Character)
  const locationId = await db.importantLocations.add({
    projectId,
    name: '雾港',
    tags: '["港口"]',
    description: '只在退潮时开放的港口。',
    significance: '故事起点',
    parentId: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.itemLedger.add({
    projectId,
    itemName: '潮汐钥匙',
    action: 'gain',
    quantity: 1,
    heldByName: '林舟',
    characterId,
    note: '旧港守门人交付',
    createdAt: now,
  })
  await db.worldviews.add({
    projectId,
    worldGroupId,
    geography: '环形群岛',
    history: '',
    society: '',
    culture: '',
    economy: '',
    rules: '潮位每十二小时轮换',
    summary: '潮汐驱动的群岛世界',
    createdAt: now,
    updatedAt: now,
  })
  await db.worldRulesProfiles.add({
    projectId,
    worldGroupId,
    entries: {
      'geography.water': {
        historicalAnchors: '',
        fictionalAdaptations: '潮位控制道路',
        priority: 'fictional',
      },
    },
    customNodes: [],
    globalNote: '潮位变化不可被普通角色停止。',
    createdAt: now,
    updatedAt: now,
  })
  return { projectId, worldGroupId, characterId, locationId }
}

describe('SIM-1B · Canon 冻结快照与运行时投影', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useSimulationRuntimeStore.setState({
      projectId: null,
      worldGroupId: null,
      sessions: [],
      selectedSessionId: null,
      events: [],
      checkpoints: [],
      runtimeState: {
        version: 1,
        clock: 0,
        entities: {},
        memories: [],
        narratives: [],
        lastSequence: 0,
      },
      loading: false,
      error: '',
    })
  })

  afterEach(() => db.close())

  it('只列出当前世界来源，并冻结字段、摘要、时间与内容 hash', async () => {
    const seeded = await seedCanon()
    const catalog = await loadSimulationCanonCandidates(seeded)
    expect(catalog.worldLabel).toBe('潮汐界')
    expect(catalog.candidates.map(candidate => candidate.name)).toEqual(expect.arrayContaining([
      '潮汐界',
      '潮汐界世界观',
      '林舟',
      '雾港',
      '潮汐钥匙',
      '潮汐界世界规则',
    ]))
    expect(catalog.candidates.map(candidate => candidate.name)).not.toContain('镜中人')

    const frozen = await buildSimulationCanonSnapshot({
      ...seeded,
      sourceKeys: catalog.candidates.map(candidate => candidate.sourceKey),
    })
    expect(frozen.snapshot.sources).toHaveLength(catalog.candidates.length)
    expect(frozen.snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(frozen.snapshot.sources.every(source => /^[0-9a-f]{64}$/.test(source.contentHash)))
      .toBe(true)
    expect(await verifySimulationCanonSnapshot(frozen.snapshot)).toBe(true)
    expect(await verifySimulationCanonSnapshot({
      ...frozen.snapshot,
      sources: frozen.snapshot.sources.map((source, index) => (
        index === 0 ? { ...source, summary: '被篡改' } : source
      )),
    })).toBe(false)
    expect(await verifySimulationCanonSnapshot({
      ...frozen.snapshot,
      sources: frozen.snapshot.sources.map((source, index) => (
        index === 0 ? { ...source, updatedAt: source.updatedAt + 1 } : source
      )),
    })).toBe(false)
    expect(await verifySimulationCanonSnapshot({
      ...frozen.snapshot,
      worldLabel: '被篡改的世界',
    })).toBe(false)
    expect(frozen.initialState.entities).toMatchObject({
      [`character:${seeded.characterId}`]: {
        name: '林舟',
        locationKey: `location:${seeded.locationId}`,
      },
      [`location:${seeded.locationId}`]: { name: '雾港' },
    })
    expect(Object.values(frozen.initialState.entities).find(entity => entity.kind === 'item'))
      .toMatchObject({ name: '潮汐钥匙', attributes: { quantity: 1 } })
  })

  it('源记录变化或删除不会改写既有快照，分支和导入后仍独立回放', async () => {
    const seeded = await seedCanon()
    const catalog = await loadSimulationCanonCandidates(seeded)
    const sourceKeys = catalog.candidates.map(candidate => candidate.sourceKey)
    const frozen = await buildSimulationCanonSnapshot({ ...seeded, sourceKeys })
    const parent = await createSimulationSession({
      projectId: seeded.projectId,
      worldGroupId: seeded.worldGroupId,
      kind: 'sandbox',
      title: '冻结前线',
      canonSnapshot: frozen.snapshot,
      initialState: frozen.initialState,
    })
    const originalSnapshotJson = parent.canonSnapshotJson

    await db.characters.update(seeded.characterId, {
      shortDescription: '已经离开潮汐界',
      updatedAt: now + 100,
    })
    const changed = await buildSimulationCanonSnapshot({ ...seeded, sourceKeys })
    expect(changed.snapshot.snapshotHash).not.toBe(frozen.snapshot.snapshotHash)
    expect((await db.simulationSessions.get(parent.id!))?.canonSnapshotJson).toBe(originalSnapshotJson)

    await db.characters.delete(seeded.characterId)
    expect((await readSimulationState(parent.id!)).entities[`character:${seeded.characterId}`].name)
      .toBe('林舟')
    const child = await branchSimulationSession({
      parentSessionId: parent.id!,
      throughSequence: 0,
      title: '恢复分支',
    })
    expect(child.canonSnapshotJson).toBe(originalSnapshotJson)

    const exported = await exportProjectJSON(seeded.projectId)
    const importedProjectId = await importProjectJSON(exported)
    const imported = await db.simulationSessions
      .where('projectId').equals(importedProjectId)
      .filter(session => session.title === '冻结前线')
      .first()
    expect(parseSimulationCanonSnapshot(imported!.canonSnapshotJson)?.snapshotHash)
      .toBe(frozen.snapshot.snapshotHash)
    expect(Object.values((await readSimulationState(imported!.id!)).entities)
      .some(entity => entity.name === '林舟')).toBe(true)
  })

  it('拒绝空选择、跨世界伪造来源和损坏检查点恢复', async () => {
    const seeded = await seedCanon()
    await expect(buildSimulationCanonSnapshot({ ...seeded, sourceKeys: [] }))
      .rejects.toThrow('至少选择')
    await expect(buildSimulationCanonSnapshot({
      ...seeded,
      sourceKeys: ['character:not-in-this-world'],
    })).rejects.toThrow('不存在或不属于当前世界')

    const catalog = await loadSimulationCanonCandidates(seeded)
    const store = useSimulationRuntimeStore.getState()
    await store.createSession({
      projectId: seeded.projectId,
      worldGroupId: seeded.worldGroupId,
      kind: 'sandbox',
      title: '检查点恢复',
      sourceKeys: catalog.candidates.map(candidate => candidate.sourceKey),
    })
    await store.advanceTime(2)
    await store.checkpoint('第二刻')
    const checkpoint = useSimulationRuntimeStore.getState().checkpoints[0]
    const restoredId = await useSimulationRuntimeStore.getState().restoreCheckpoint(checkpoint.id!)
    expect(await db.simulationSessions.get(restoredId)).toMatchObject({
      parentThroughSequence: 1,
      title: '检查点恢复 · 第二刻',
    })
    expect((await readSimulationState(restoredId)).clock).toBe(2)

    const parentId = (await db.simulationSessions
      .where('projectId').equals(seeded.projectId)
      .filter(session => session.title === '检查点恢复')
      .first())!.id!
    const badCheckpoint = await db.simulationCheckpoints
      .where('sessionId').equals(parentId).first()
    await db.simulationCheckpoints.update(badCheckpoint!.id!, { stateJson: '{"tampered":true}' })
    await useSimulationRuntimeStore.getState().select(parentId)
    await expect(useSimulationRuntimeStore.getState().restoreCheckpoint(badCheckpoint!.id!))
      .rejects.toThrow('校验失败')
    expect(await db.simulationSessions.where('projectId').equals(seeded.projectId).count()).toBe(2)
  })
})
