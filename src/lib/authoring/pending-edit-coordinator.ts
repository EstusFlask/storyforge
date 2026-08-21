/**
 * WEH-0C · pending author edit barrier.
 *
 * UI drafts register a synchronous flusher while they are editable. Store writes
 * register their promise under a stable key. Formal generation calls flush() so
 * it cannot race ahead of blur/debounce persistence.
 */

export interface PendingEditFlushReceiptV1 {
  version: 1
  draftFlushersInvoked: number
  writesAwaited: number
}

interface PendingWriteV1 {
  id: number
  key: string
  promise: Promise<unknown>
}

const draftFlushers = new Map<symbol, () => void | Promise<void>>()
const pendingWrites = new Map<number, PendingWriteV1>()
const writeTails = new Map<string, Promise<void>>()
const unresolvedFailures = new Map<string, unknown>()
let nextWriteId = 1

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}

export function registerPendingDraftFlusherV1(
  flusher: () => void | Promise<void>,
): () => void {
  const id = Symbol('pending-author-draft')
  draftFlushers.set(id, flusher)
  return () => { draftFlushers.delete(id) }
}

/**
 * Serialize writes that target the same authoring record. A later successful
 * write clears an earlier failure for that key; until then every formal flush
 * keeps failing closed.
 */
export function coordinatePendingEditV1<T>(input: {
  key: string
  persist: () => Promise<T>
}): Promise<T> {
  const key = input.key.trim()
  if (!key) throw new Error('Pending edit key 不能为空')
  const previous = writeTails.get(key) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(input.persist)
  const id = nextWriteId++
  pendingWrites.set(id, { id, key, promise: operation })
  const tail = operation.then(
    () => {
      unresolvedFailures.delete(key)
    },
    error => {
      unresolvedFailures.set(key, error)
    },
  )
  writeTails.set(key, tail)
  const cleanup = () => {
    pendingWrites.delete(id)
    if (writeTails.get(key) === tail) writeTails.delete(key)
  }
  operation.then(cleanup, cleanup)
  // Store callers often intentionally fire-and-forget on blur. Attach a
  // rejection observer while keeping the returned promise rejectable.
  void operation.catch(() => undefined)
  return operation
}

export async function flushPendingEditsV1(): Promise<PendingEditFlushReceiptV1> {
  const flushers = [...draftFlushers.values()]
  const draftResults = await Promise.allSettled(flushers.map(flusher => flusher()))
  const draftFailures = draftResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason)

  // A draft flusher may synchronously enqueue a store write, and a completed
  // write may enqueue another write. Continue until the registry is quiescent.
  const awaitedIds = new Set<number>()
  while (pendingWrites.size) {
    const batch = [...pendingWrites.values()]
    batch.forEach(item => awaitedIds.add(item.id))
    await Promise.allSettled(batch.map(item => item.promise))
    await Promise.resolve()
  }

  const failures = [...draftFailures, ...unresolvedFailures.values()]
  if (failures.length) {
    throw new Error(`作者编辑保存失败，已阻止正式生成：${failures.map(message).join('；')}`)
  }
  return {
    version: 1,
    draftFlushersInvoked: flushers.length,
    writesAwaited: awaitedIds.size,
  }
}

export function pendingEditDiagnosticsV1(): {
  draftCount: number
  writeCount: number
  failedKeys: string[]
} {
  return {
    draftCount: draftFlushers.size,
    writeCount: pendingWrites.size,
    failedKeys: [...unresolvedFailures.keys()].sort(),
  }
}

/** Test-only reset; production flows resolve failures by a later successful write. */
export function resetPendingEditCoordinatorForTestsV1(): void {
  if (import.meta.env.PROD) throw new Error('生产环境不能重置 PendingEditCoordinator')
  draftFlushers.clear()
  pendingWrites.clear()
  writeTails.clear()
  unresolvedFailures.clear()
  nextWriteId = 1
}
