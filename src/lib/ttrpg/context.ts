import { db } from '../db/schema'
import { hashGameProductionValueV2 } from '../game-production/hash'
import type { AssembleContextInput } from '../registry/types'
import { assertRecordInScope, resolveScope } from '../world-engine/scope'
import { parseTtrpgCampaignContentV1 } from './campaign'
import { parseRulePackV1 } from './rule-pack'

export async function readTtrpgProductContext(input: AssembleContextInput): Promise<string> {
  if (input.ttrpgRulePackId == null && input.ttrpgCampaignModuleId == null) return ''
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const ruleRow = input.ttrpgRulePackId == null ? null : await db.gameRulePacks.get(input.ttrpgRulePackId)
  if (input.ttrpgRulePackId != null
    && (!ruleRow || !await assertRecordInScope(scope, 'gameRulePacks', ruleRow, { owner: 'work' }))) {
    throw new Error('[ttrpg-context] RulePack 不存在或跨 Work')
  }
  const campaignRow = input.ttrpgCampaignModuleId == null
    ? null
    : await db.ttrpgCampaignModules.get(input.ttrpgCampaignModuleId)
  if (input.ttrpgCampaignModuleId != null
    && (!campaignRow || !await assertRecordInScope(scope, 'ttrpgCampaignModules', campaignRow, { owner: 'work' }))) {
    throw new Error('[ttrpg-context] CampaignPack 不存在或跨 Work')
  }
  const effectiveRuleRow = ruleRow ?? (campaignRow ? await db.gameRulePacks.get(campaignRow.rulePackId) : null)
  if (!effectiveRuleRow || !await assertRecordInScope(scope, 'gameRulePacks', effectiveRuleRow, { owner: 'work' })) {
    throw new Error('[ttrpg-context] CampaignPack 绑定的 RulePack 不存在')
  }
  const rulePack = parseRulePackV1(effectiveRuleRow.rulePackJson)
  if (await hashGameProductionValueV2(rulePack) !== effectiveRuleRow.contentHash) {
    throw new Error('[ttrpg-context] RulePack 内容 hash 校验失败')
  }
  const campaign = campaignRow ? parseTtrpgCampaignContentV1(campaignRow.contentJson, rulePack) : null
  if (campaign && await hashGameProductionValueV2(campaign) !== campaignRow!.contentHash) {
    throw new Error('[ttrpg-context] CampaignPack 内容 hash 校验失败')
  }
  return JSON.stringify({
    schema: 'storyforge.ttrpg-authoring-context', version: 1,
    rulePack: {
      id: effectiveRuleRow.id, title: effectiveRuleRow.title,
      contentHash: effectiveRuleRow.contentHash, content: rulePack,
    },
    campaign: campaignRow && campaign ? {
      id: campaignRow.id, title: campaignRow.title,
      contentHash: campaignRow.contentHash, content: campaign,
    } : null,
  })
}

/** Player-card authoring projection: deliberately excludes scenes, clues, endings and GM profiles. */
export async function readTtrpgCharacterAuthoringContextV2(input: AssembleContextInput): Promise<string> {
  const characterKey = input.ttrpgCharacterKey?.trim()
  if (!characterKey || input.ttrpgCampaignModuleId == null) return ''
  const full = await readTtrpgProductContext(input)
  if (!full) return ''
  const parsed = JSON.parse(full) as {
    rulePack: { id: number; title: string; contentHash: string; content: ReturnType<typeof parseRulePackV1> }
    campaign: null | { id: number; title: string; contentHash: string; content: ReturnType<typeof parseTtrpgCampaignContentV1> }
  }
  const campaign = parsed.campaign?.content
  const character = campaign?.characterTemplates.find(item => item.characterKey === characterKey && item.role === 'player')
  if (!campaign || !character) throw new Error('[ttrpg-context] AI 车卡目标不是当前 CampaignPack 的玩家角色')
  const { gmProfile: _gmProfile, ...safeCharacter } = character
  return JSON.stringify({
    schema: 'storyforge.ttrpg-character-authoring-context', version: 2,
    campaign: {
      id: parsed.campaign!.id, title: campaign.title, pitch: campaign.pitch,
      contentHash: parsed.campaign!.contentHash, tags: campaign.tags,
      difficulty: campaign.difficulty, playerCount: campaign.playerCount,
      sessionZero: campaign.sessionZero,
      roster: campaign.characterTemplates.map(item => ({ characterKey: item.characterKey, name: item.name, role: item.role })),
    },
    rulePack: parsed.rulePack,
    character: safeCharacter,
  })
}
