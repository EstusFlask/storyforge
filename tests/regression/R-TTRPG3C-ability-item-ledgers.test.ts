import { describe, expect, it } from 'vitest'
import {
  createTtrpgAbilityRuntimeStateV2,
  resetTtrpgAbilityUsageV2,
  consumeTtrpgAbilityV2,
} from '../../src/lib/ttrpg/ability-ledger'
import {
  applyTtrpgItemCommandV2,
  createEmptyTtrpgInventoryV2,
  inventoryItemsForOwnerV2,
} from '../../src/lib/ttrpg/item-ledger'
import type { TtrpgAbilityDefinitionV2, TtrpgItemDefinitionV2 } from '../../src/lib/types'

const charges: TtrpgAbilityDefinitionV2 = {
  abilityKey: 'ability.flash', actionDefinitionKey: 'action.flash',
  usage: {
    mode: 'charges', maximum: 2, resourceKey: null, cost: null,
    sharedPoolKey: null, cooldownRounds: null, reset: ['scene', 'long-rest'],
  },
}

const item: TtrpgItemDefinitionV2 = {
  itemKey: 'item.lantern', title: '调查灯', category: 'tool', tags: ['light'],
  stackPolicy: 'unique', maxStack: 1, weight: 1, equipSlots: ['hand'], requiresAttunement: false,
  maximumCharges: 3, maximumDurability: 5, useActions: ['action.illuminate'],
  publicDescription: '能照亮隐蔽痕迹。', secretPropertyKeys: [],
}

describe('TTRPG-3C · ability usage and ItemInstance ledgers', () => {
  it('次数消耗幂等、耗尽拒绝，并且只由声明的 reset trigger 恢复', () => {
    let state = createTtrpgAbilityRuntimeStateV2({ actorInstanceId: 'actor.chen', definition: charges })
    const first = consumeTtrpgAbilityV2({ definition: charges, state, eventId: 'event.use.1', currentRound: 1 })
    state = first.state
    expect(state.remainingUses).toBe(1)
    const replay = consumeTtrpgAbilityV2({ definition: charges, state, eventId: 'event.use.1', currentRound: 1 })
    expect(replay).toMatchObject({ replayed: true })
    expect(replay.state.remainingUses).toBe(1)
    state = consumeTtrpgAbilityV2({ definition: charges, state, eventId: 'event.use.2', currentRound: 1 }).state
    expect(state.remainingUses).toBe(0)
    expect(() => consumeTtrpgAbilityV2({ definition: charges, state, eventId: 'event.use.3', currentRound: 1 })).toThrow('耗尽')
    expect(resetTtrpgAbilityUsageV2({ definition: charges, state, trigger: 'round', eventId: 'event.round.2' }).remainingUses).toBe(0)
    expect(resetTtrpgAbilityUsageV2({ definition: charges, state, trigger: 'scene', eventId: 'event.scene.2' }).remainingUses).toBe(2)
  })

  it('资源、共享池和冷却分别使用自己的真相，不靠技能描述猜测', () => {
    const resourceDefinition: TtrpgAbilityDefinitionV2 = {
      abilityKey: 'ability.focus', actionDefinitionKey: 'action.focus',
      usage: { mode: 'resource-cost', maximum: null, resourceKey: 'focus', cost: 2, sharedPoolKey: null, cooldownRounds: null, reset: [] },
    }
    const resourceState = createTtrpgAbilityRuntimeStateV2({ actorInstanceId: 'actor.chen', definition: resourceDefinition })
    expect(consumeTtrpgAbilityV2({ definition: resourceDefinition, state: resourceState, eventId: 'event.focus.1', currentRound: 1, resourceCurrent: 2 }).resourceDelta).toBe(-2)
    expect(() => consumeTtrpgAbilityV2({ definition: resourceDefinition, state: resourceState, eventId: 'event.focus.2', currentRound: 1, resourceCurrent: 1 })).toThrow('资源不足')

    const cooldownDefinition: TtrpgAbilityDefinitionV2 = {
      abilityKey: 'ability.guard', actionDefinitionKey: 'action.guard',
      usage: { mode: 'cooldown', maximum: null, resourceKey: null, cost: null, sharedPoolKey: null, cooldownRounds: 2, reset: ['scene'] },
    }
    let cooldownState = createTtrpgAbilityRuntimeStateV2({ actorInstanceId: 'actor.chen', definition: cooldownDefinition })
    cooldownState = consumeTtrpgAbilityV2({ definition: cooldownDefinition, state: cooldownState, eventId: 'event.guard.1', currentRound: 3 }).state
    expect(cooldownState.cooldownUntilRound).toBe(5)
    expect(() => consumeTtrpgAbilityV2({ definition: cooldownDefinition, state: cooldownState, eventId: 'event.guard.2', currentRound: 4 })).toThrow('冷却')
    expect(() => consumeTtrpgAbilityV2({ definition: cooldownDefinition, state: cooldownState, eventId: 'event.guard.2', currentRound: 5 })).not.toThrow()

    const poolDefinition: TtrpgAbilityDefinitionV2 = {
      abilityKey: 'ability.party-luck', actionDefinitionKey: 'action.party-luck',
      usage: { mode: 'shared-pool', maximum: null, resourceKey: null, cost: 1, sharedPoolKey: 'pool.luck', cooldownRounds: null, reset: ['session'] },
    }
    const poolState = createTtrpgAbilityRuntimeStateV2({ actorInstanceId: 'actor.chen', definition: poolDefinition })
    const poolUse = consumeTtrpgAbilityV2({
      definition: poolDefinition, state: poolState, eventId: 'event.luck.1', currentRound: 1,
      sharedPool: { poolKey: 'pool.luck', maximum: 2, remaining: 2, lastChangedEventId: null },
    })
    expect(poolUse.sharedPool).toMatchObject({ remaining: 1, lastChangedEventId: 'event.luck.1' })
  })

  it('物品定义与实例分离；grant/transfer/use/damage/repair/equip 原子且重试不复制', () => {
    const definitions = { [item.itemKey]: item }
    let state = createEmptyTtrpgInventoryV2()
    const grant = applyTtrpgItemCommandV2({
      state, definitions,
      command: { commandId: 'cmd.grant.1', kind: 'grant', instanceId: 'instance.lantern.1', definitionRef: item.itemKey, ownerRef: 'actor.chen', locationRef: null, quantity: 1, eventId: 'event.grant.1' },
    })
    state = grant.state
    expect(inventoryItemsForOwnerV2(state, 'actor.chen')).toHaveLength(1)
    const replay = applyTtrpgItemCommandV2({
      state, definitions,
      command: { commandId: 'cmd.grant.1', kind: 'grant', instanceId: 'instance.lantern.1', definitionRef: item.itemKey, ownerRef: 'actor.chen', locationRef: null, quantity: 1, eventId: 'event.grant.1' },
    })
    expect(replay.replayed).toBe(true)
    expect(Object.keys(replay.state.items)).toHaveLength(1)

    state = applyTtrpgItemCommandV2({ state, definitions, command: { commandId: 'cmd.equip.1', kind: 'equip', instanceId: 'instance.lantern.1', expectedOwnerRef: 'actor.chen', slots: ['hand'] } }).state
    expect(state.items['instance.lantern.1'].equippedSlots).toEqual(['hand'])
    state = applyTtrpgItemCommandV2({ state, definitions, command: { commandId: 'cmd.use.1', kind: 'use', instanceId: 'instance.lantern.1', expectedOwnerRef: 'actor.chen', amount: 1 } }).state
    expect(state.items['instance.lantern.1'].charges).toBe(2)
    state = applyTtrpgItemCommandV2({ state, definitions, command: { commandId: 'cmd.damage.1', kind: 'damage', instanceId: 'instance.lantern.1', amount: 5 } }).state
    expect(state.items['instance.lantern.1']).toMatchObject({ durability: 0, stateTags: ['broken'] })
    state = applyTtrpgItemCommandV2({ state, definitions, command: { commandId: 'cmd.repair.1', kind: 'repair', instanceId: 'instance.lantern.1', amount: 2 } }).state
    expect(state.items['instance.lantern.1']).toMatchObject({ durability: 2, stateTags: [] })

    state = applyTtrpgItemCommandV2({ state, definitions, command: { commandId: 'cmd.transfer.1', kind: 'transfer', instanceId: 'instance.lantern.1', expectedOwnerRef: 'actor.chen', destinationOwnerRef: 'actor.lin' } }).state
    expect(state.items['instance.lantern.1']).toMatchObject({ ownerRef: 'actor.lin', equippedSlots: [] })
    expect(() => applyTtrpgItemCommandV2({ state, definitions, command: { commandId: 'cmd.transfer.stale', kind: 'transfer', instanceId: 'instance.lantern.1', expectedOwnerRef: 'actor.chen', destinationOwnerRef: 'actor.wu' } })).toThrow('所有者已变化')
    expect(Object.keys(state.items)).toHaveLength(1)
  })
})
