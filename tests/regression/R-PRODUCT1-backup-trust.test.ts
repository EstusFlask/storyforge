import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'

describe('PRODUCT-1 · 备份可信预检', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('当前导出包含注册表登记的完整表集合，并给出可恢复摘要', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '可信备份项目', genre: 'fantasy', description: '', targetWordCount: 1000,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const backup = await exportProjectJSON(projectId)
    const report = inspectProjectBackup(backup)
    const exportable = PROJECT_TABLES
      .filter(spec => spec.exportable && spec.name !== 'projects')
      .map(spec => spec.name)

    expect(report.valid).toBe(true)
    expect(report.projectName).toBe('可信备份项目')
    expect(report.recordCount).toBe(0)
    expect(report.missingTables).toEqual([])
    expect(exportable.every(name => name in backup)).toBe(true)
  })

  it('错误根结构或错误表类型会在写库前被拒绝', async () => {
    const before = await db.projects.count()
    const malformed = {
      version: 3,
      exportedAt: Date.now(),
      project: { name: '坏备份' },
      chapters: '不是数组',
    }
    const report = inspectProjectBackup(malformed)
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toContain('chapters')
    await expect(importProjectJSON(malformed as any)).rejects.toThrow('备份预检失败')
    expect(await db.projects.count()).toBe(before)
  })

  it('旧版本缺少后来新增的表仍可兼容，但会明确显示警告', () => {
    const report = inspectProjectBackup({
      version: 2,
      exportedAt: Date.now(),
      project: { name: '旧备份' },
      worldviews: [],
      storyCores: [],
    })
    expect(report.valid).toBe(true)
    expect(report.missingTables.length).toBeGreaterThan(0)
    expect(report.warnings.join('；')).toContain('旧格式')
  })
})
