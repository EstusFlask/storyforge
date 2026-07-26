import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
  updateAgentEventCandidate,
} from '../../src/lib/agent/conversations'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { db } from '../../src/lib/db/schema'
import type { Project } from '../../src/lib/types'

const project: Project = {
  id: 73001,
  name: '主 Agent 测试',
  genre: 'fantasy',
  genres: ['fantasy'],
  status: 'drafting',
  description: '',
  targetWordCount: 100_000,
  enableMultiWorld: false,
  createdAt: 1,
  updatedAt: 1,
}

describe('AGENT-2 · 主 Agent 编排与持久会话', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.put(project)
  })

  afterEach(() => db.close())

  it('主 Agent 把一个用户目标拆成有依赖的幕后领域任务', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '建立潮汐世界，并设计一个守灯人主角',
    }, {
      complete: async () => JSON.stringify({
        summary: '先设定世界，再创建角色。',
        tasks: [
          {
            id: 'world',
            agentId: 'world-origin',
            instruction: '建立潮汐世界',
            dependsOn: [],
          },
          {
            id: 'hero',
            agentId: 'character',
            instruction: '设计守灯人主角',
            dependsOn: ['world', 'missing', 'hero'],
          },
          {
            id: 'ignored',
            agentId: 'unknown-domain',
            instruction: '不应进入计划',
            dependsOn: [],
          },
        ],
      }),
    })
    expect(plan.summary).toBe('先设定世界，再创建角色。')
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[1]).toMatchObject({
      id: 'hero',
      agentId: 'character',
      dependsOn: ['world'],
    })
  })

  it('规划模型失败时仍按用户目标做确定性领域路由', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '补充世界起源并设计主角',
    }, {
      complete: async () => { throw new Error('planner unavailable') },
    })
    expect(plan.tasks.map(task => task.agentId)).toEqual(['world-origin', 'character'])
    expect(plan.tasks[1].dependsOn).toEqual(['world-1'])
  })

  it('事件按严格序号持久化，候选编辑和刷新恢复不丢失', async () => {
    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      worldGroupId: null,
    })
    const first = await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'message',
      role: 'user',
      content: '建立潮汐世界',
    })
    const candidate = await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: '初稿',
      payload: { label: '世界来源' },
    })
    await updateAgentEventCandidate(candidate.id!, project.id!, '作者修订稿')
    const restored = await readAgentEvents(conversation.id!)
    expect(restored.map(event => event.sequence)).toEqual([1, 2])
    expect(restored[0].id).toBe(first.id)
    expect(restored[1].content).toBe('作者修订稿')
    expect((await db.agentConversations.get(conversation.id!))?.title).toBe('建立潮汐世界')
  })
})
