import { describe, expect, it } from 'vitest'
import { buildTtrpgGmPrompt, parseTtrpgTurnCandidate } from '../../src/lib/simulation/ttrpg'
import { EMPTY_SIMULATION_STATE, type SimulationRuntimeState } from '../../src/lib/types'

function state(): SimulationRuntimeState {
  return {
    ...structuredClone(EMPTY_SIMULATION_STATE),
    entities: {
      'character:linzhou': {
        entityKey: 'character:linzhou',
        kind: 'character',
        sourceId: 1,
        name: '林舟',
        locationKey: null,
        lifecycleStatus: 'active',
        attributes: {},
      },
      'npc:watcher': {
        entityKey: 'npc:watcher',
        kind: 'npc',
        sourceId: null,
        name: '守望者',
        locationKey: null,
        lifecycleStatus: 'active',
        attributes: {},
      },
    },
    ttrpg: {
      scene: { sceneId: 'scene:1', title: '门厅', description: '', locationKey: null, status: 'active' },
      round: 1,
      activeActorKey: 'character:linzhou',
      turnOrder: ['character:linzhou', 'npc:watcher'],
      actions: [],
      checks: [],
    },
    lastSequence: 3,
  }
}

describe('TTRPG-1 · AI GM 候选协议', () => {
  it('只允许结构化检定请求，并由调用方锁定行动者、动作和基线', () => {
    const candidate = parseTtrpgTurnCandidate({
      draft: JSON.stringify({
        actorKey: 'character:linzhou',
        narrative: '林舟把手伸向机关。',
        check: { skill: '调查', expression: '1d20+3', dc: 14, reason: '判断机关结构。' },
        outcomes: { success: '机关被安全解除。', failure: '机关发出警报声。' },
        nextActorKey: 'npc:watcher',
      }),
      state: state(),
      actorKey: 'character:linzhou',
      action: '尝试解除机关。',
      baseSequence: 3,
    })
    expect(candidate).toMatchObject({
      baseSequence: 3,
      actorKey: 'character:linzhou',
      action: '尝试解除机关。',
      check: { skill: '调查', expression: '1d20+3', dc: 14 },
      nextActorKey: 'npc:watcher',
    })
  })

  it('拒绝改写行动者、未知字段以及缺少成功/失败分支的检定', () => {
    const base = {
      state: state(),
      actorKey: 'character:linzhou',
      action: '观察。',
      baseSequence: 3,
    }
    expect(() => parseTtrpgTurnCandidate({
      ...base,
      draft: JSON.stringify({
        actorKey: 'npc:watcher', narrative: '越权。', check: null, outcomes: null, nextActorKey: null,
      }),
    })).toThrow('不能改写')
    expect(() => parseTtrpgTurnCandidate({
      ...base,
      draft: JSON.stringify({
        actorKey: 'character:linzhou', narrative: '观察。', check: null, outcomes: null, nextActorKey: null, hp: 99,
      }),
    })).toThrow('未知字段')
    expect(() => parseTtrpgTurnCandidate({
      ...base,
      draft: JSON.stringify({
        actorKey: 'character:linzhou',
        narrative: '观察。',
        check: { skill: '感知', expression: '1d20', dc: 10, reason: '查看暗处。' },
        outcomes: null,
        nextActorKey: null,
      }),
    })).toThrow('必须同时提供')
  })

  it('提示词明确 AI 不能写状态或决定骰点', () => {
    const prompt = buildTtrpgGmPrompt({
      actorKey: 'character:linzhou',
      actorName: '林舟',
      action: '观察石门。',
      runtimeContext: '冻结上下文',
    })
    expect(prompt[0].content).toContain('不能直接改变角色、地点、物品、生命状态或骰子结果')
    expect(prompt[0].content).toContain('结果由代码确定性掷骰')
    expect(prompt[1].content).toContain('冻结上下文')
  })
})
