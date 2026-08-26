import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
} from '../../src/lib/ttrpg/authoring'
import { parseTtrpgCampaignContentV1 } from '../../src/lib/ttrpg/campaign'
import {
  adoptTtrpgCharacterSheetCandidateFromRunV2,
  generateTtrpgCharacterSheetCandidateV2,
  rejectTtrpgCharacterSheetCandidateV2,
} from '../../src/lib/ttrpg/character-sheet-harness'
import { parseRulePackV1 } from '../../src/lib/ttrpg/rule-pack'
import type { WorkspaceScope, WorldReleaseManifestV2 } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

const now = 1_791_200_000_000

function manifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      { _exportId: 0, name: '林舟', identity: '谨慎的档案调查员', roleWeight: 'main' },
      { _exportId: 1, name: '守潮人', identity: '掌握旧港秘密', roleWeight: 'npc' },
    ],
    characterRelations: [], importantLocations: [{ _exportId: 0, name: '雾港', description: '旧港' }],
    storyArcs: [], itemLedger: [], codexEntries: [], avgMediaAssets: [], narrativeModules: [], narrativeNodes: [],
  }
  return {
    schema: 'storyforge.world-package', version: 2,
    worldCode: 'character-ai', worldName: '潮汐界', workTitle: '雾港纪事',
    selectedTables: Object.keys(records), selectedNarrativeModules: [], dependencies: [], records, portableProject: {},
  }
}

async function setup(): Promise<{ scope: WorkspaceScope; campaignModuleId: number; characterKey: string }> {
  const projectId = await db.projects.add({
    name: 'AI 车卡验收', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  const scope = (await ensureWorkspaceOwnership(projectId)).scope
  const world = manifest()
  const contentHash = await hashGameProductionValueV2(world)
  const worldReleaseId = await db.worldReleases.add({
    projectId, worldId: scope.worldId, revisionId: 1, version: 1, label: '潮汐界 v1',
    manifestJson: JSON.stringify(world), contentHash, sourceWorldCode: world.worldCode, createdAt: now,
  }) as number
  const rule = await installStoryForgeRulePackV1(scope)
  const campaign = await compileWorldReleaseToTtrpgCampaignDraftV1({
    scope, worldReleaseId, rulePackId: rule.id, fixtureOnly: true, confirmDefaultMappings: true,
  })
  return { scope, campaignModuleId: campaign.id!, characterKey: 'release-character:0' }
}

function output(input: { name?: string; body?: number; mind?: number; presence?: number } = {}): string {
  return JSON.stringify({
    identity: {
      name: input.name ?? '林舟', pronouns: '她/她', gender: '女性', age: '27', ancestry: '潮汐界人',
      occupation: '档案调查员', appearance: '深色雨衣与旧式录音机', origin: '雾港北岸',
      background: '曾参与潮门失踪信号研究，习惯先核对证据。', personalityTraits: ['谨慎', '执着'],
      beliefs: ['证据应当经得起交叉验证'], flaws: ['不愿及时求助'], fears: ['重复导师的失踪'],
      desires: ['找到失踪导师'], boundaries: ['不替其他玩家角色决定'], shortTermGoal: '找到导师留下的记录',
      longTermGoal: '重建公开档案网络', publicKnowledge: ['她是雾港档案调查员'],
      privateKnowledge: ['她曾隐藏一段失真的录音'], safetyNotes: ['遵守暂停信号'],
      portrayal: '先观察，再用短句指出矛盾。', voice: '语速克制，提及导师时停顿', sampleLines: ['这段记录的时间对不上。'],
    },
    attributes: { body: input.body ?? 1, mind: input.mind ?? 2, presence: input.presence ?? 0 },
  })
}

describe('R-TTRPG-3F · AI full character-card candidate', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只读安全上下文不含 GM 场景秘密，生成不写 Campaign，作者采用后才 CAS 写入完整车卡', async () => {
    const target = await setup()
    const before = await db.ttrpgCampaignModules.get(target.campaignModuleId)
    const assembled = await assembleContext({
      projectId: target.scope.projectId, scope: target.scope,
      ttrpgCampaignModuleId: target.campaignModuleId, ttrpgCharacterKey: target.characterKey,
      sourceKeys: ['ttrpg.character-authoring'],
    })
    expect(assembled.included).toEqual(['ttrpg.character-authoring'])
    expect(assembled.text).not.toContain('gmSecret')
    expect(assembled.text).not.toContain('failureForward')
    expect(assembled.text).not.toContain('ending.reveal')

    const generated = await generateTtrpgCharacterSheetCandidateV2({
      ...target, objective: '保留林舟姓名和体魄，生成偏调查的完整角色卡。',
      lockedFields: ['identity.name', 'attribute.body'], runAI: async () => output(),
    })
    expect((await db.ttrpgCampaignModules.get(target.campaignModuleId))?.contentHash).toBe(before?.contentHash)
    expect(generated.candidate).toMatchObject({
      characterKey: target.characterKey, lockedFields: ['attribute.body', 'identity.name'],
      draft: { identity: { name: '林舟', privateKnowledge: ['她曾隐藏一段失真的录音'] }, attributes: { body: 1, mind: 2, presence: 0 } },
    })
    const adopted = await adoptTtrpgCharacterSheetCandidateFromRunV2({ scope: target.scope, runId: generated.candidate.runId })
    const campaignRow = await db.ttrpgCampaignModules.get(target.campaignModuleId)
    expect(campaignRow?.contentHash).toBe(adopted.contentHash)
    const ruleRow = await db.gameRulePacks.get(campaignRow!.rulePackId)
    const rule = parseRulePackV1(ruleRow!.rulePackJson)
    const campaign = parseTtrpgCampaignContentV1(campaignRow!.contentJson, rule)
    const character = campaign.characterTemplates.find(item => item.characterKey === target.characterKey)!
    expect(character.characterSheet).toMatchObject({
      authoring: { mode: 'ai', lockedFields: ['attribute.body', 'identity.name'] },
      identity: { occupation: '档案调查员', privateKnowledge: ['她曾隐藏一段失真的录音'] },
      rules: { attributes: { body: 1, mind: 2, presence: 0 } },
      gates: { characterComplete: true, ruleLegal: true, playableRole: true, secretScope: true },
    })
    expect(character.attributeMappings.mind.derivationRule).toContain(`Run #${generated.candidate.runId}`)
  })

  it('模型改锁定字段会触发一次协议修复；拒绝不写入，两个同基线候选只能采用一个', async () => {
    const target = await setup()
    let calls = 0
    const repaired = await generateTtrpgCharacterSheetCandidateV2({
      ...target, objective: '生成调查型车卡', lockedFields: ['identity.name', 'attribute.body'],
      runAI: async () => (++calls === 1 ? output({ name: '越界改名', body: 2, mind: 1 }) : output()),
    })
    expect(calls).toBe(2)
    expect(repaired.candidate.repairApplied).toBe(true)
    const beforeReject = (await db.ttrpgCampaignModules.get(target.campaignModuleId))!.contentHash
    await rejectTtrpgCharacterSheetCandidateV2({ scope: target.scope, runId: repaired.candidate.runId })
    expect((await db.ttrpgCampaignModules.get(target.campaignModuleId))!.contentHash).toBe(beforeReject)

    const first = await generateTtrpgCharacterSheetCandidateV2({
      ...target, objective: '候选一', runAI: async () => output(),
    })
    const second = await generateTtrpgCharacterSheetCandidateV2({
      ...target, objective: '候选二', runAI: async () => output({ mind: 1, presence: 1 }),
    })
    await adoptTtrpgCharacterSheetCandidateFromRunV2({ scope: target.scope, runId: first.candidate.runId })
    await expect(adoptTtrpgCharacterSheetCandidateFromRunV2({
      scope: target.scope, runId: second.candidate.runId,
    })).rejects.toThrow('已过期')
  })
})
