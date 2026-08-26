import type { WorldGameProductionHandoffV2 } from '../types'

const PRODUCT_TYPES = new Set<WorldGameProductionHandoffV2['productType']>([
  'ttrpg', 'storygame', 'text-adventure', 'avg', 'chatgame', 'textsimulation', 'textworld',
])

export function parseWorldGameProductionHandoffV2(value: unknown): WorldGameProductionHandoffV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[game-production-handoff] 交接必须是对象')
  }
  const row = value as Record<string, unknown>
  const expected = ['productType', 'schema', 'version', 'worldContentHash', 'worldReleaseId']
  if (Object.keys(row).sort().join(',') !== expected.sort().join(',')) {
    throw new Error('[game-production-handoff] 交接字段不精确')
  }
  if (row.schema !== 'storyforge.world-game-production-handoff' || row.version !== 2
    || !PRODUCT_TYPES.has(row.productType as WorldGameProductionHandoffV2['productType'])
    || !Number.isInteger(row.worldReleaseId) || Number(row.worldReleaseId) < 1
    || typeof row.worldContentHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.worldContentHash)) {
    throw new Error('[game-production-handoff] 交接身份、产品、release ID 或 hash 无效')
  }
  return {
    schema: 'storyforge.world-game-production-handoff', version: 2,
    productType: row.productType as WorldGameProductionHandoffV2['productType'],
    worldReleaseId: Number(row.worldReleaseId), worldContentHash: row.worldContentHash,
  }
}
