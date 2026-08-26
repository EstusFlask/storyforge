import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  candidateDraftDiagnosticsV1,
  flushCandidateDraftV1,
  hasPendingCandidateDraftsV1,
  queueCandidateDraftV1,
  resetCandidateDraftCoordinatorForTestsV1,
} from '../../src/lib/agent/candidate-draft-coordinator'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
  updateAgentEventCandidate,
} from '../../src/lib/agent/conversations'
import { db } from '../../src/lib/db/schema'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('WEH-0D candidate draft coordinator', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.add({
      id: 98004,
      name: '候选串行测试',
      genre: 'fantasy',
      genres: ['fantasy'],
      description: '',
      status: 'drafting',
      targetWordCount: 100_000,
      createdAt: 1,
      updatedAt: 1,
    } as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    resetCandidateDraftCoordinatorForTestsV1()
    db.close()
  })

  it('1000 次快速输入只把最终文本作为 durable 结果落库', async () => {
    const conversation = await getOrCreateAgentConversation({
      projectId: 98004,
      worldGroupId: null,
    })
    const candidate = await appendAgentEvent({
      projectId: 98004,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: '初稿',
      payload: { label: '测试候选' },
    })
    for (let index = 0; index < 1000; index += 1) {
      queueCandidateDraftV1({
        key: 'scope:conversation:7:candidate:11',
        draft: `版本-${index}`,
        debounceMs: 60_000,
        persist: draft => updateAgentEventCandidate(candidate.id!, 98004, draft),
      })
    }

    await flushCandidateDraftV1('scope:conversation:7:candidate:11')

    const restored = await readAgentEvents(conversation.id!)
    expect(restored.find(event => event.id === candidate.id)?.content).toBe('版本-999')
    expect(hasPendingCandidateDraftsV1()).toBe(false)
  })

  it('在旧写入进行时收到新输入，会严格串行并以新文本收尾', async () => {
    const gate = deferred()
    const writes: string[] = []
    queueCandidateDraftV1({
      key: 'candidate:a',
      draft: '旧草稿',
      debounceMs: 60_000,
      persist: async draft => {
        writes.push(draft)
        if (draft === '旧草稿') await gate.promise
      },
    })
    const flushing = flushCandidateDraftV1('candidate:a')
    await Promise.resolve()
    queueCandidateDraftV1({
      key: 'candidate:a',
      draft: '最终草稿',
      debounceMs: 60_000,
      persist: async draft => { writes.push(draft) },
    })
    gate.resolve()

    await flushing
    await flushCandidateDraftV1('candidate:a')
    expect(writes).toEqual(['旧草稿', '最终草稿'])
  })

  it('两个候选拥有独立队列，不互相等待或串写', async () => {
    const gate = deferred()
    const writes: string[] = []
    queueCandidateDraftV1({
      key: 'candidate:a',
      draft: 'A',
      debounceMs: 60_000,
      persist: async draft => { await gate.promise; writes.push(`a:${draft}`) },
    })
    queueCandidateDraftV1({
      key: 'candidate:b',
      draft: 'B',
      debounceMs: 60_000,
      persist: async draft => { writes.push(`b:${draft}`) },
    })

    const aFlush = flushCandidateDraftV1('candidate:a')
    await flushCandidateDraftV1('candidate:b')
    expect(writes).toEqual(['b:B'])
    gate.resolve()
    await aFlush
    expect(writes).toEqual(['b:B', 'a:A'])
  })

  it('失败保持未同步状态；后续成功版本才解除决策屏障', async () => {
    let fail = true
    const writes: string[] = []
    const persist = async (draft: string) => {
      if (fail) throw new Error('IndexedDB unavailable')
      writes.push(draft)
    }
    queueCandidateDraftV1({ key: 'candidate:a', draft: '未同步', debounceMs: 60_000, persist })

    await expect(flushCandidateDraftV1('candidate:a')).rejects.toThrow('已阻止后续操作')
    expect(candidateDraftDiagnosticsV1()).toMatchObject([{
      key: 'candidate:a',
      failed: true,
      persistedVersion: 0,
      version: 1,
    }])

    fail = false
    queueCandidateDraftV1({ key: 'candidate:a', draft: '恢复后的最终稿', debounceMs: 60_000, persist })
    await flushCandidateDraftV1('candidate:a')
    expect(writes).toEqual(['恢复后的最终稿'])
    expect(hasPendingCandidateDraftsV1()).toBe(false)
  })
})
