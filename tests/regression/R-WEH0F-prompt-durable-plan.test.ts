import { beforeEach, describe, expect, it } from 'vitest'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { usePromptStore } from '../../src/stores/prompt'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import {
  buildMasterAgentRunContractV1,
  parseMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { parseAgentRunContractV1 } from '../../src/lib/agent/run/contract'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'

function worldviewTemplate(id: number, name: string, systemPrompt: string): PromptTemplate {
  return {
    id,
    scope: 'user',
    moduleKey: 'worldview.dimension',
    promptType: 'generate',
    name,
    description: 'durable test',
    systemPrompt,
    userPromptTemplate: '用户模板 {{projectName}} {{worldContext}}',
    variables: ['projectName', 'worldContext'],
    isActive: true,
    createdAt: id,
    updatedAt: id,
  }
}

describe('WEH-0F durable Prompt plan binding', () => {
  beforeEach(() => {
    usePromptStore.setState({
      loaded: true,
      templates: [worldviewTemplate(101, '冻结模板 A', '冻结系统 A')],
    })
  })

  it('计划创建时冻结模板；随后切换激活模板不会改变旧计划', async () => {
    const plan = await createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: '生成种族与民族',
      pinnedTask: {
        agentId: 'world-origin',
        skillId: 'world-origin.worldview-field',
        instruction: '生成世界基座字段。目标字段=races；生成模式=expand。',
        promptExecution: { version: 1, moduleKey: 'worldview.dimension' },
      },
    })
    const frozen = plan.tasks[0].promptExecution!
    expect(frozen.template).toMatchObject({ id: 101, name: '冻结模板 A', systemPrompt: '冻结系统 A' })

    usePromptStore.setState({ templates: [worldviewTemplate(202, '新模板 B', '新系统 B')] })
    const restored = parseMasterAgentPlanV1(JSON.parse(JSON.stringify(plan)))
    expect(restored.tasks[0].promptExecution?.template).toMatchObject({
      id: 101,
      name: '冻结模板 A',
      systemPrompt: '冻结系统 A',
    })
  })

  it('Run Contract 显式绑定模板身份及模板、参数、覆盖项 hash', async () => {
    const plan = await createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: '生成种族与民族',
      pinnedTask: {
        agentId: 'world-origin',
        skillId: 'world-origin.worldview-field',
        instruction: '生成世界基座字段。目标字段=races；生成模式=expand。',
        promptExecution: {
          version: 1,
          moduleKey: 'worldview.dimension',
          systemOverride: '作者 system',
          userOverride: '作者 user',
        },
      },
    })
    const budgetEvidence = new AgentTeamBudgetTracker('balanced').snapshot()
    const contract = parseAgentRunContractV1(buildMasterAgentRunContractV1({
      scope: { projectId: 1, workId: 1, worldId: 1 },
      worldGroupId: null,
      plan,
      budgetEvidence,
    }))
    const binding = contract.executionBindings?.[0]?.promptExecution
    expect(binding).toMatchObject({
      version: 1,
      moduleKey: 'worldview.dimension',
      templateId: 101,
      templateName: '冻结模板 A',
    })
    expect(binding?.templateHash).toBe(plan.tasks[0].promptExecution?.templateHash)
    expect(binding?.parameterValuesHash).toBe(plan.tasks[0].promptExecution?.parameterValuesHash)
    expect(binding?.overridesHash).toBe(plan.tasks[0].promptExecution?.overridesHash)
  })
})
