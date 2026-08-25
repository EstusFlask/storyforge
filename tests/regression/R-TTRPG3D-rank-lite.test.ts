import { describe, expect, it } from 'vitest'
import {
  createRankLiteQuickCardsV2,
  createRankLiteRulePackV1,
  rankLiteTierForPowerV2,
} from '../../src/lib/ttrpg/rank-lite-rule-pack'
import { consumeTtrpgAbilityV2, createTtrpgAbilityRuntimeStateV2, resetTtrpgAbilityUsageV2 } from '../../src/lib/ttrpg/ability-ledger'
import { previewTtrpgCheckProbabilityV2 } from '../../src/lib/ttrpg/house-rule'

describe('TTRPG-3D · Rank Lite complete first-party rules slice', () => {
  it('提供 D/C/B/A 四阶快速卡、完整车卡字段和合法的第一方商业规则包', () => {
    const pack = createRankLiteRulePackV1()
    const cards = createRankLiteQuickCardsV2()
    expect(cards.map(card => card.tier)).toEqual(['D', 'C', 'B', 'A'])
    expect(cards.map(card => rankLiteTierForPowerV2(card.attributes.rankPower))).toEqual(['D', 'C', 'B', 'A'])
    expect(cards.every(card => card.skills.length >= 2 && card.itemKeys.length >= 1 && card.actionKeys.includes('signature'))).toBe(true)
    expect(pack.license).toMatchObject({ commercialUse: true, derivativesAllowed: true })
    expect(Math.max(...pack.diceModels.map(model => model.sides))).toBeLessThanOrEqual(100)
    expect(pack.actions.some(action => action.phase === 'reaction')).toBe(true)
    expect(pack.actions.some(action => action.usage.mode === 'charges')).toBe(true)
    expect(pack.actions.some(action => action.usage.mode === 'cooldown')).toBe(true)
    expect(previewTtrpgCheckProbabilityV2({ rulePack: pack, checkKey: 'standard', attributeValue: 2 }).successProbability).toBeGreaterThan(0)
  })

  it('招牌技实际消耗两次场景次数，耗尽拒绝并在场景 reset 恢复', () => {
    const action = createRankLiteRulePackV1().actions.find(item => item.key === 'signature')!
    const definition = { abilityKey: action.key, actionDefinitionKey: action.key, usage: action.usage }
    let state = createTtrpgAbilityRuntimeStateV2({ actorInstanceId: 'actor.rank-b', definition })
    state = consumeTtrpgAbilityV2({ definition, state, eventId: 'event.1', currentRound: 1 }).state
    state = consumeTtrpgAbilityV2({ definition, state, eventId: 'event.2', currentRound: 1 }).state
    expect(state.remainingUses).toBe(0)
    expect(() => consumeTtrpgAbilityV2({ definition, state, eventId: 'event.3', currentRound: 1 })).toThrow('耗尽')
    state = resetTtrpgAbilityUsageV2({ definition, state, trigger: 'scene', eventId: 'event.4' })
    expect(state.remainingUses).toBe(2)
  })
})
