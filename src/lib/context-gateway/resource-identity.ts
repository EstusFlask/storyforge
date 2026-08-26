import Dexie from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import {
  ContextResourceIdentityError,
  createPortableResourceUidV1,
  isPortableResourceUidV1,
} from './resource-uid'

export interface ResourceIdentityBackfillReceiptV1 {
  version: 1
  projectId: number
  scanned: number
  written: number
  preserved: number
  byTable: Readonly<Record<string, { scanned: number; written: number; preserved: number }>>
}

function resourceSpecs() {
  return PROJECT_TABLES.filter(spec => spec.resourceIdentity != null)
}

/**
 * Explicit, all-or-nothing legacy migration. It never runs while a catalog is
 * being read, never touches Canon timestamps, and is safe to repeat.
 */
export async function backfillResourceUidsV1(
  projectId: number,
  options: {
    beforeWrite?: (tableName: string, recordId: number, nextUid: string) => void | Promise<void>
  } = {},
): Promise<ResourceIdentityBackfillReceiptV1> {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new ContextResourceIdentityError('project', 'projectId 必须是正整数')
  }
  const specs = resourceSpecs()
  return db.transaction('rw', specs.map(spec => spec.table), () => (
    backfillResourceUidsInCurrentTransactionV1(projectId, options)
  ))
}

/** @internal Import already owns the all-table transaction and reuses this exact migration body. */
export async function backfillResourceUidsInCurrentTransactionV1(
  projectId: number,
  options: {
    beforeWrite?: (tableName: string, recordId: number, nextUid: string) => void | Promise<void>
  } = {},
): Promise<ResourceIdentityBackfillReceiptV1> {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new ContextResourceIdentityError('project', 'projectId 必须是正整数')
  }
  const specs = resourceSpecs()
  const seen = new Set<string>()
  let scanned = 0
  let written = 0
  let preserved = 0
  const byTable: Record<string, { scanned: number; written: number; preserved: number }> = {}
  for (const spec of specs) {
    const identity = spec.resourceIdentity!
    const rows = await spec.table.where('projectId').equals(projectId).toArray() as Array<Record<string, unknown>>
    const tableReceipt = { scanned: rows.length, written: 0, preserved: 0 }
    scanned += rows.length
    for (const row of rows) {
      if (!Number.isInteger(row.id)) {
        throw new ContextResourceIdentityError('record', `${spec.name} 存在缺少 numeric id 的记录`)
      }
      const current = row[identity.field]
      if (isPortableResourceUidV1(current, identity.resourceKind)) {
        if (seen.has(current)) {
          throw new ContextResourceIdentityError('duplicate', `项目内 resource UID 重复: ${current}`)
        }
        seen.add(current)
        preserved++
        tableReceipt.preserved++
        continue
      }
      if (typeof current === 'string' && current.trim() && !current.startsWith('rag:')) {
        throw new ContextResourceIdentityError(
          'invalid',
          `${spec.name}#${row.id} 含未知格式的 resource UID，拒绝静默覆盖`,
        )
      }
      let nextUid = createPortableResourceUidV1(identity.resourceKind)
      while (seen.has(nextUid)) nextUid = createPortableResourceUidV1(identity.resourceKind)
      if (options.beforeWrite) {
        await Dexie.waitFor(options.beforeWrite(spec.name, row.id as number, nextUid))
      }
      await spec.table.update(row.id as number, { [identity.field]: nextUid })
      seen.add(nextUid)
      written++
      tableReceipt.written++
    }
    byTable[spec.name] = tableReceipt
  }
  return { version: 1, projectId, scanned, written, preserved, byTable }
}

export function resourceIdentityTableNamesV1(): readonly string[] {
  return resourceSpecs().map(spec => spec.name)
}
