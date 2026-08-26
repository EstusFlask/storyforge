import { describe, expect, it, vi } from 'vitest'
import {
  createGamePlatformActiveReadinessV1,
  type GamePlatformProductionDependencyAdapterV1,
  type GamePlatformProductionDependencyAdaptersV1,
  type GamePlatformProductionProbeAuditV1,
} from '../../src/lib/game-platform/production-runtime'
import {
  GAME_PLATFORM_PRODUCTION_DEPENDENCIES_V1,
  type GamePlatformProductionDependencyV1,
} from '../../src/lib/game-platform/service-router'

function configuredEvidence() {
  return Object.fromEntries(GAME_PLATFORM_PRODUCTION_DEPENDENCIES_V1.map(dependency => [
    dependency, 'configured' as const,
  ]))
}

function externalAdapters(input: {
  health?: Partial<Record<GamePlatformProductionDependencyV1, boolean>>
  calls?: Partial<Record<GamePlatformProductionDependencyV1, number>>
} = {}): GamePlatformProductionDependencyAdaptersV1 {
  return Object.fromEntries(GAME_PLATFORM_PRODUCTION_DEPENDENCIES_V1.map(dependency => [
    dependency,
    {
      dependency,
      adapterId: `test.external.${dependency}`,
      deployment: 'external',
      async probe() {
        if (input.calls) input.calls[dependency] = (input.calls[dependency] ?? 0) + 1
        return { ok: input.health?.[dependency] ?? true, code: input.health?.[dependency] === false ? 'dependency-down' : 'ok' }
      },
    } satisfies GamePlatformProductionDependencyAdapterV1,
  ]))
}

describe('PLATFORM-1I · active production adapters and readiness', () => {
  it('configured 只是意图声明：没有匹配外部适配器时全部 fail-closed', async () => {
    const readiness = createGamePlatformActiveReadinessV1({
      serviceVersion: 'production-1',
      environment: 'production',
      dependencyEvidence: configuredEvidence(),
    })
    await expect(readiness.read({ force: true })).resolves.toMatchObject({
      ready: false,
      checks: {
        'identity-provider': 'missing',
        'payment-provider': 'missing',
        'realtime-fanout': 'missing',
      },
    })
  })

  it('只接受匹配的 external 活探针；缓存合并常规请求，强制健康检查可动态摘除', async () => {
    let clock = 10_000
    const calls: Partial<Record<GamePlatformProductionDependencyV1, number>> = {}
    const health: Partial<Record<GamePlatformProductionDependencyV1, boolean>> = {}
    const audits: GamePlatformProductionProbeAuditV1[] = []
    const readiness = createGamePlatformActiveReadinessV1({
      serviceVersion: 'production-2',
      environment: 'production',
      dependencyEvidence: configuredEvidence(),
      adapters: externalAdapters({ health, calls }),
      cacheTtlMs: 1_000,
      now: () => clock,
      audit: entry => { audits.push(entry) },
    })
    await expect(readiness.read()).resolves.toMatchObject({ ready: true, checkedAt: 10_000 })
    await readiness.read()
    expect(Object.values(calls).reduce((sum, count) => sum + (count ?? 0), 0)).toBe(11)

    health['payment-provider'] = false
    clock += 10
    await expect(readiness.read()).resolves.toMatchObject({ ready: true })
    await expect(readiness.read({ force: true })).resolves.toMatchObject({
      ready: false,
      checks: { 'payment-provider': 'unhealthy' },
      checkedAt: 10_010,
    })
    expect(readiness.peek()).toMatchObject({ ready: false })
    expect(audits).toHaveLength(22)
    expect(Object.keys(audits[0] ?? {}).sort()).toEqual([
      'adapterId', 'code', 'dependency', 'latencyMs', 'observedAt', 'status',
    ])
  })

  it('内存适配器、错误依赖绑定、非法结果和超时都不能变成 ready', async () => {
    vi.useFakeTimers()
    try {
      const adapters = externalAdapters()
      adapters['identity-provider'] = {
        dependency: 'identity-provider', adapterId: 'memory.identity', deployment: 'memory',
        probe: async () => ({ ok: true, code: 'ok' }),
      }
      adapters['payment-provider'] = {
        dependency: 'object-storage', adapterId: 'wrong.payment', deployment: 'external',
        probe: async () => ({ ok: true, code: 'ok' }),
      } as unknown as GamePlatformProductionDependencyAdapterV1<'payment-provider'>
      adapters['object-storage'] = {
        dependency: 'object-storage', adapterId: 'invalid.result', deployment: 'external',
        probe: async () => ({ ok: true, code: 'contains spaces' }),
      }
      adapters['realtime-fanout'] = {
        dependency: 'realtime-fanout', adapterId: 'slow.realtime', deployment: 'external',
        probe: async ({ signal }) => new Promise((_, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        }),
      }
      const readiness = createGamePlatformActiveReadinessV1({
        serviceVersion: 'production-3', environment: 'production',
        dependencyEvidence: configuredEvidence(), adapters, probeTimeoutMs: 50,
      })
      const observation = readiness.read({ force: true })
      await vi.advanceTimersByTimeAsync(50)
      await expect(observation).resolves.toMatchObject({
        ready: false,
        checks: {
          'identity-provider': 'development-only',
          'payment-provider': 'unhealthy',
          'object-storage': 'unhealthy',
          'realtime-fanout': 'unhealthy',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
