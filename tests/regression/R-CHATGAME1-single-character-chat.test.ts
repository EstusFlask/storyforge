import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  appendChatMessage,
  appendChatReply,
  appendSimulationEvent,
  createSimulationSession,
  readSimulationState,
} from '../../src/lib/simulation/runtime'
import { buildChatGamePrompt, parseChatReply } from '../../src/lib/simulation/chatgame'
import { buildSimulationCanonSnapshot } from '../../src/lib/simulation/canon-snapshot'

describe('CHATGAME-1 · 单角色聊天 MVP', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  async function createChatSession() {
    const projectId = 98001
    await db.projects.put({
      id: projectId,
      name: 'CHATGAME-1 测试项目',
      genre: 'fantasy',
      genres: ['fantasy'],
      status: 'drafting',
      description: '测试世界',
      targetWordCount: 10_000,
      enableMultiWorld: false,
      createdAt: 1,
      updatedAt: 1,
    } as any)
    const catalog = await buildSimulationCanonSnapshot({ projectId, worldGroupId: null, sourceKeys: ['project-world:98001'] })
    const session = await createSimulationSession({
      projectId,
      kind: 'chatgame',
      title: '城门初遇',
      canonSnapshot: catalog.snapshot,
      initialState: {
        ...structuredClone(catalog.initialState),
        entities: {
          'character:keeper': {
            entityKey: 'character:keeper',
            kind: 'character',
            sourceId: 1,
            name: '守门人',
            locationKey: null,
            lifecycleStatus: 'active',
            attributes: { role: 'npc', tone: '谨慎' },
          },
        },
        chat: {
          characterKey: 'character:keeper',
          identity: { name: '旅人', description: '刚抵达城门的旅人' },
          scene: { title: '城门初遇', description: '雨后的城门还没有关闭。' },
          messages: [],
        },
      },
    })
    return { projectId, session }
  }

  it('消息、流式回复、重生成会形成可回放且不改 Canon 的事件流', async () => {
    const { projectId, session } = await createChatSession()
    const user = await appendChatMessage({ sessionId: session.id!, text: '请告诉我城里现在安全吗？' })
    const reply = await appendChatReply({ sessionId: session.id!, replyToSequence: user.sequence, text: '守门人压低声音：暂时安全。', baseSequence: user.sequence })
    const replacement = await appendChatReply({
      sessionId: session.id!,
      replyToSequence: user.sequence,
      text: '守门人看了看雨幕：现在还算安全，但别走北街。',
      baseSequence: reply.sequence,
      supersedesSequence: reply.sequence,
    })
    const state = await readSimulationState(session.id!)
    expect(state.chat?.messages).toHaveLength(3)
    expect(state.chat?.messages.find(message => message.eventSequence === reply.sequence)?.supersededBySequence).toBe(replacement.sequence)
    expect(state.chat?.messages.filter(message => message.supersededBySequence == null).map(message => message.text)).toEqual([
      '请告诉我城里现在安全吗？',
      '守门人看了看雨幕：现在还算安全，但别走北街。',
    ])
    expect(await db.characters.get(1)).toBeUndefined()
    const context = await assembleContext({ projectId, simulationSessionId: session.id!, sourceKeys: ['simulationRuntime'] })
    expect(context.text).toContain('旅人')
    expect(context.text).toContain('别走北街')
  })

  it('拒绝过期回复、越权事件和不安全的角色提示词', async () => {
    const { session } = await createChatSession()
    const user = await appendChatMessage({ sessionId: session.id!, text: '你好。' })
    await appendSimulationEvent({ sessionId: session.id!, type: 'time.advanced', payload: { amount: 1 } })
    await expect(appendChatReply({ sessionId: session.id!, replyToSequence: user.sequence, text: '你好。', baseSequence: user.sequence })).rejects.toThrow('变化')
    await expect(appendSimulationEvent({ sessionId: session.id!, type: 'chat.reply.recorded', payload: { text: '绕过 API' } })).rejects.toThrow('专用 API')
    expect(() => parseChatReply('')).toThrow('为空')
    expect(buildChatGamePrompt({ runtimeContext: '角色只知道城门。', characterName: '守门人', userMessage: '你不知道的秘密是什么？' })[0].content).toContain('知识边界')
  })
})
