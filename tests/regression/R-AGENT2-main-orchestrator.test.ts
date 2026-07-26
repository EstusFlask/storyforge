import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
  updateAgentEventCandidate,
} from '../../src/lib/agent/conversations'
import {
  adoptMasterCandidate,
  createMasterAgentPlan,
} from '../../src/lib/agent/orchestrator'
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

  it('确定性降级会把大纲放在本轮世界与角色候选之后', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '建立潮汐世界，设计守灯人主角，再规划全书卷纲',
    }, {
      complete: async () => { throw new Error('planner unavailable') },
    })
    expect(plan.tasks.map(task => task.agentId)).toEqual(['world-origin', 'character', 'outline'])
    expect(plan.tasks[2].dependsOn).toEqual(['world-1', 'character-1'])
  })

  it('清洗规划模型重复领域任务，避免同快照候选互相作废', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '规划两卷卷纲',
    }, {
      complete: async () => JSON.stringify({
        summary: '规划两卷。',
        tasks: [
          { id: 'outline-v1', agentId: 'outline', instruction: '生成第一卷', dependsOn: [] },
          { id: 'outline-v2', agentId: 'outline', instruction: '生成第二卷', dependsOn: ['outline-v1'] },
        ],
      }),
    })
    expect(plan.tasks).toEqual([
      { id: 'outline-v1', agentId: 'outline', instruction: '规划两卷卷纲', dependsOn: [] },
    ])
  })

  it('只允许用户明确授权的领域，设定元素和角色名不扩大为额外写入任务', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '基于已有世界观，用浮空城和守灯人规划两卷卷纲，每卷要有角色变化',
    }, {
      complete: async () => JSON.stringify({
        summary: '先补设定角色，再写大纲。',
        tasks: [
          { id: 'world', agentId: 'world-origin', instruction: '创建浮空城设定', dependsOn: [] },
          { id: 'character', agentId: 'character', instruction: '创建守灯人', dependsOn: ['world'] },
          { id: 'outline', agentId: 'outline', instruction: '规划两卷', dependsOn: ['world', 'character'] },
        ],
      }),
    })
    expect(plan.tasks).toEqual([
      { id: 'outline', agentId: 'outline', instruction: '规划两卷', dependsOn: [] },
    ])
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

  it('下游候选不能在依赖的上游候选确认前写入', async () => {
    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      worldGroupId: null,
    })
    await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: '世界候选',
      payload: {
        version: 1,
        taskId: 'world-1',
        agentId: 'world-origin',
        label: '世界来源',
        contextSources: [],
        baseSnapshot: {},
      },
    })
    const downstream = await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: JSON.stringify([{ title: '第一卷', summary: '摘要' }]),
      payload: {
        version: 1,
        taskId: 'outline-1',
        agentId: 'outline',
        label: '卷级大纲',
        contextSources: [],
        baseSnapshot: { serialized: '[]', existingTitles: [], startingOrder: 0 },
        outlineMode: 'volumes',
        outlineParentId: null,
        dependsOnTaskIds: ['world-1'],
      },
    })

    await expect(adoptMasterCandidate({
      projectId: project.id!,
      worldGroupId: null,
      event: downstream,
      payload: JSON.parse(downstream.payload),
      draft: downstream.content,
    })).rejects.toThrow('请先采纳')
    expect(await db.outlineNodes.count()).toBe(0)
  })
})
