import {
  GAME_PLATFORM_PRODUCTION_DEPENDENCIES_V1,
  evaluateGamePlatformProductionReadinessV1,
  type GamePlatformProductionDependencyV1,
  type GamePlatformReadinessV1,
}
  from './service-router'

export interface GamePlatformProductionProbeResultV1 {
  ok: boolean
  /** Stable, non-sensitive operational code. Exceptions and free text are never exposed. */
  code: string
}

export interface GamePlatformProductionDependencyAdapterV1<
  Dependency extends GamePlatformProductionDependencyV1 = GamePlatformProductionDependencyV1,
> {
  dependency: Dependency
  adapterId: string
  deployment: 'external' | 'memory'
  probe(input: { signal: AbortSignal }): Promise<GamePlatformProductionProbeResultV1>
}

export type GamePlatformProductionDependencyAdaptersV1 = Partial<{
  [Dependency in GamePlatformProductionDependencyV1]: GamePlatformProductionDependencyAdapterV1<Dependency>
}>

export interface GamePlatformProductionProbeAuditV1 {
  dependency: GamePlatformProductionDependencyV1
  adapterId: string | null
  status: GamePlatformReadinessV1['checks'][string]
  code: string
  latencyMs: number
  observedAt: number
}

export interface GamePlatformActiveReadinessV1 {
  read(input?: { force?: boolean }): Promise<GamePlatformReadinessV1>
  peek(): GamePlatformReadinessV1 | null
}

function validAdapterId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value)
}

function validCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(value)
}

async function probeOne(input: {
  dependency: GamePlatformProductionDependencyV1
  evidence: 'configured' | 'memory' | undefined
  adapter: GamePlatformProductionDependencyAdapterV1 | undefined
  timeoutMs: number
  now: () => number
  audit?: (entry: GamePlatformProductionProbeAuditV1) => void | Promise<void>
}): Promise<GamePlatformReadinessV1['checks'][string]> {
  const startedAt = input.now()
  let status: GamePlatformReadinessV1['checks'][string]
  let code: string
  let adapterId: string | null = null
  if (input.evidence === 'memory') {
    status = 'development-only'
    code = 'memory-evidence'
  } else if (input.evidence !== 'configured' || !input.adapter) {
    status = 'missing'
    code = input.evidence === 'configured' ? 'active-probe-missing' : 'configuration-missing'
  } else {
    adapterId = validAdapterId(input.adapter.adapterId) ? input.adapter.adapterId : null
    if (input.adapter.dependency !== input.dependency || !adapterId) {
      status = 'unhealthy'
      code = 'adapter-contract-invalid'
    } else if (input.adapter.deployment !== 'external') {
      status = 'development-only'
      code = 'memory-adapter'
    } else {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          input.adapter.probe({ signal: controller.signal }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort()
              reject(new Error('probe-timeout'))
            }, input.timeoutMs)
          }),
        ])
        if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean' || !validCode(result.code)) {
          status = 'unhealthy'
          code = 'probe-result-invalid'
        } else {
          status = result.ok ? 'ready' : 'unhealthy'
          code = result.code
        }
      } catch (error) {
        status = 'unhealthy'
        code = error instanceof Error && error.message === 'probe-timeout' ? 'probe-timeout' : 'probe-failed'
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  }
  try {
    await input.audit?.({
      dependency: input.dependency,
      adapterId,
      status,
      code,
      latencyMs: Math.max(0, input.now() - startedAt),
      observedAt: input.now(),
    })
  } catch {
    // An explicitly configured observation sink is part of the operational
    // path. Its outage removes readiness without letting health itself throw.
    status = 'unhealthy'
  }
  return status
}

/**
 * Active production readiness. A caller-supplied `configured` flag is only an
 * intent declaration: production becomes ready after every matching external
 * adapter answers a bounded live probe. Results are coalesced and briefly
 * cached for normal traffic; health checks can force a fresh observation.
 */
export function createGamePlatformActiveReadinessV1(input: {
  serviceVersion: string
  environment: 'development' | 'production'
  dependencyEvidence: Partial<Record<GamePlatformProductionDependencyV1, 'configured' | 'memory'>>
  adapters?: GamePlatformProductionDependencyAdaptersV1
  probeTimeoutMs?: number
  cacheTtlMs?: number
  now?: () => number
  audit?: (entry: GamePlatformProductionProbeAuditV1) => void | Promise<void>
}): GamePlatformActiveReadinessV1 {
  const now = input.now ?? (() => Date.now())
  const probeTimeoutMs = input.probeTimeoutMs ?? 2_000
  const cacheTtlMs = input.cacheTtlMs ?? 10_000
  if (!Number.isInteger(probeTimeoutMs) || probeTimeoutMs < 50 || probeTimeoutMs > 30_000) {
    throw new Error('[game-platform-readiness:configuration] probeTimeoutMs 无效')
  }
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 60_000) {
    throw new Error('[game-platform-readiness:configuration] cacheTtlMs 无效')
  }
  // Reuse the legacy validator and preserve development semantics.
  const development = evaluateGamePlatformProductionReadinessV1({
    serviceVersion: input.serviceVersion,
    environment: input.environment,
    dependencies: input.dependencyEvidence,
  })
  let latest: GamePlatformReadinessV1 | null = null
  let inFlight: Promise<GamePlatformReadinessV1> | null = null

  const observe = async (): Promise<GamePlatformReadinessV1> => {
    const checkedAt = now()
    if (input.environment === 'development') {
      latest = { ...development, checkedAt }
      return structuredClone(latest)
    }
    const states = await Promise.all(GAME_PLATFORM_PRODUCTION_DEPENDENCIES_V1.map(async dependency => [
      dependency,
      await probeOne({
        dependency,
        evidence: input.dependencyEvidence[dependency],
        adapter: input.adapters?.[dependency],
        timeoutMs: probeTimeoutMs,
        now,
        audit: input.audit,
      }),
    ] as const))
    const checks = Object.fromEntries(states) as GamePlatformReadinessV1['checks']
    latest = {
      ready: Object.values(checks).every(value => value === 'ready'),
      serviceVersion: input.serviceVersion,
      checks,
      checkedAt,
    }
    return structuredClone(latest)
  }

  return {
    async read(options = {}) {
      const cacheFresh = latest && cacheTtlMs > 0 && now() - (latest.checkedAt ?? 0) < cacheTtlMs
      if (!options.force && cacheFresh && latest) return structuredClone(latest)
      if (inFlight) return structuredClone(await inFlight)
      inFlight = observe().finally(() => { inFlight = null })
      return structuredClone(await inFlight)
    },
    peek: () => latest ? structuredClone(latest) : null,
  }
}
