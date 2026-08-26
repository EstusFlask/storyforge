import { AuthoritativeOnlineRoomV1, OnlineRoomAuthorityError } from './room-authority'

export interface OnlineRoomRealtimeSignalV1 {
  protocolVersion: 1
  type: 'cursor.advanced'
  roomId: string
  cursor: number
}

export interface OnlineRoomRealtimeSubscriptionV1 {
  subscriptionId: string
  roomId: string
  memberId: string
  cursor: number
  close(): void
}

export interface OnlineRoomRealtimeCoordinatorV1 {
  notify(roomId: string, cursor: number): Promise<void>
  waitForAdvance(input: {
    room: AuthoritativeOnlineRoomV1
    memberId: string
    authToken: string
    afterSequence: number
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<{ cursor: number; timedOut: boolean }>
}

export interface OnlineRoomRealtimeFanoutTransportV1 {
  /** Publishes cursor metadata only; game payloads are forbidden. */
  publish(signal: OnlineRoomRealtimeSignalV1): Promise<void>
  /**
   * Atomically observes the retained room cursor and subscribes for a newer
   * value, preventing the reconnect-to-subscribe race across service workers.
   */
  waitForCursor(input: {
    roomId: string
    afterSequence: number
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<{ cursor: number; timedOut: boolean }>
}

interface SubscriberV1 {
  subscriptionId: string
  roomId: string
  memberId: string
  cursor: number
  send(signal: OnlineRoomRealtimeSignalV1): void | Promise<void>
}

function fail(code: string, message: string): never {
  throw new OnlineRoomAuthorityError(code, message)
}

/**
 * Framework-neutral SSE/WebSocket coordination core. It emits cursor hints,
 * never game payloads, so every client must use authenticated reconnect to
 * retrieve its per-viewer event projection. Subscriptions retain no bearer
 * token after the initial room authentication succeeds.
 */
export class OnlineRoomRealtimeHubV1 implements OnlineRoomRealtimeCoordinatorV1 {
  private readonly subscribers = new Map<string, SubscriberV1>()

  constructor(private readonly limits: { total: number; perRoom: number } = { total: 2_000, perRoom: 20 }) {
    if (!Number.isInteger(limits.total) || limits.total < 1 || !Number.isInteger(limits.perRoom) || limits.perRoom < 1) {
      fail('configuration', '实时订阅容量无效')
    }
  }

  async subscribe(input: {
    room: AuthoritativeOnlineRoomV1
    memberId: string
    authToken: string
    afterSequence: number
    send(signal: OnlineRoomRealtimeSignalV1): void | Promise<void>
  }): Promise<OnlineRoomRealtimeSubscriptionV1> {
    if (this.subscribers.size >= this.limits.total) fail('service_unavailable', '实时订阅总容量已满')
    const roomCount = [...this.subscribers.values()].filter(row => row.roomId === input.room.roomId).length
    if (roomCount >= this.limits.perRoom) fail('service_unavailable', '房间实时订阅容量已满')
    if (typeof input.send !== 'function') fail('protocol', '实时发送回调无效')
    const authenticated = await input.room.reconnect({
      memberId: input.memberId,
      authToken: input.authToken,
      afterSequence: input.afterSequence,
    })
    const subscriptionId = `subscription.${crypto.randomUUID()}`
    const subscriber: SubscriberV1 = {
      subscriptionId,
      roomId: input.room.roomId,
      memberId: authenticated.member.memberId,
      cursor: input.afterSequence,
      send: input.send,
    }
    this.subscribers.set(subscriptionId, subscriber)
    if (authenticated.cursor > input.afterSequence) await this.deliver(subscriber, authenticated.cursor)
    return {
      subscriptionId,
      roomId: subscriber.roomId,
      memberId: subscriber.memberId,
      cursor: authenticated.cursor,
      close: () => { this.subscribers.delete(subscriptionId) },
    }
  }

  async notify(roomId: string, cursor: number): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(roomId)
      || !Number.isInteger(cursor) || cursor < 0) fail('protocol', '实时游标通知无效')
    const targets = [...this.subscribers.values()].filter(row => row.roomId === roomId && row.cursor < cursor)
    await Promise.all(targets.map(async subscriber => {
      try {
        await this.deliver(subscriber, cursor)
      } catch {
        this.subscribers.delete(subscriber.subscriptionId)
      }
    }))
  }

  /**
   * Authenticated long-poll primitive for browsers that cannot attach bearer
   * material to EventSource headers. It resolves with cursor metadata only;
   * callers still use reconnect for their per-viewer payload.
   */
  async waitForAdvance(input: {
    room: AuthoritativeOnlineRoomV1
    memberId: string
    authToken: string
    afterSequence: number
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<{ cursor: number; timedOut: boolean }> {
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 25_000) {
      fail('protocol', '实时等待 timeoutMs 无效')
    }
    let subscription: OnlineRoomRealtimeSubscriptionV1 | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    let resolveWait!: (value: { cursor: number; timedOut: boolean }) => void
    let rejectWait!: (reason: unknown) => void
    const wait = new Promise<{ cursor: number; timedOut: boolean }>((resolve, reject) => {
      resolveWait = resolve
      rejectWait = reject
    })
    // Abort can fire while subscribe() is still awaiting authentication. Mark
    // the internal promise as observed immediately; the returned async method
    // still propagates the same rejection to its caller.
    void wait.catch(() => undefined)
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      subscription?.close()
    }
    const finish = (value: { cursor: number; timedOut: boolean }) => {
      if (settled) return
      settled = true
      cleanup()
      resolveWait(value)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      rejectWait(new OnlineRoomAuthorityError('request_aborted', '实时等待已取消'))
    }
    if (input.signal?.aborted) onAbort()
    else input.signal?.addEventListener('abort', onAbort, { once: true })
    if (!settled) {
      try {
        subscription = await this.subscribe({
          room: input.room,
          memberId: input.memberId,
          authToken: input.authToken,
          afterSequence: input.afterSequence,
          send: signal => { finish({ cursor: signal.cursor, timedOut: false }) },
        })
        if (settled) subscription.close()
        else timer = setTimeout(() => finish({ cursor: input.afterSequence, timedOut: true }), input.timeoutMs)
      } catch (error) {
        if (!settled) {
          settled = true
          cleanup()
          rejectWait(error)
        }
      }
    }
    return wait
  }

  activeSubscriptions(roomId?: string): number {
    return roomId == null
      ? this.subscribers.size
      : [...this.subscribers.values()].filter(row => row.roomId === roomId).length
  }

  private async deliver(subscriber: SubscriberV1, cursor: number): Promise<void> {
    await subscriber.send({ protocolVersion: 1, type: 'cursor.advanced', roomId: subscriber.roomId, cursor })
    subscriber.cursor = cursor
  }
}

/**
 * Production-facing realtime coordinator backed by a deployment-owned,
 * retained fanout transport. Authentication is always checked against the
 * authoritative room before the transport receives a room/cursor wait.
 */
export class FanoutBackedOnlineRoomRealtimeV1 implements OnlineRoomRealtimeCoordinatorV1 {
  constructor(private readonly transport: OnlineRoomRealtimeFanoutTransportV1) {
    if (!transport || typeof transport.publish !== 'function' || typeof transport.waitForCursor !== 'function') {
      fail('configuration', '外部实时 fanout 配置无效')
    }
  }

  async notify(roomId: string, cursor: number): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(roomId)
      || !Number.isInteger(cursor) || cursor < 0) fail('protocol', '实时游标通知无效')
    try {
      await this.transport.publish({ protocolVersion: 1, type: 'cursor.advanced', roomId, cursor })
    } catch {
      fail('service_unavailable', '外部实时 fanout 发布失败')
    }
  }

  async waitForAdvance(input: {
    room: AuthoritativeOnlineRoomV1
    memberId: string
    authToken: string
    afterSequence: number
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<{ cursor: number; timedOut: boolean }> {
    if (!Number.isInteger(input.afterSequence) || input.afterSequence < 0
      || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 25_000) {
      fail('protocol', '实时等待参数无效')
    }
    if (input.signal?.aborted) fail('request_aborted', '实时等待已取消')
    const authenticated = await input.room.reconnect({
      memberId: input.memberId,
      authToken: input.authToken,
      afterSequence: input.afterSequence,
    })
    if (authenticated.cursor > input.afterSequence) {
      return { cursor: authenticated.cursor, timedOut: false }
    }
    let observed: { cursor: number; timedOut: boolean }
    try {
      observed = await this.transport.waitForCursor({
        roomId: input.room.roomId,
        afterSequence: input.afterSequence,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      })
    } catch {
      if (input.signal?.aborted) fail('request_aborted', '实时等待已取消')
      fail('service_unavailable', '外部实时 fanout 等待失败')
    }
    if (!observed || typeof observed !== 'object' || typeof observed.timedOut !== 'boolean'
      || !Number.isInteger(observed.cursor) || observed.cursor < input.afterSequence
      || (observed.timedOut ? observed.cursor !== input.afterSequence : observed.cursor === input.afterSequence)) {
      fail('service_unavailable', '外部实时 fanout 返回无效游标')
    }
    return { cursor: observed.cursor, timedOut: observed.timedOut }
  }
}
