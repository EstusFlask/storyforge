import { exportProjectJSON, importProjectJSON, type ProjectExportData } from '../export/json-export'
import { inspectProjectBackup } from '../export/backup-trust'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { CommunityWorldLicense, Project } from '../types'
import { generateWorldCode } from './world-identity'

export const WORLD_PACKAGE_FORMAT = 'storyforge.world-package'
export const WORLD_PACKAGE_VERSION = 1

export type WorldPackageUse = 'writing' | 'ttrpg' | 'characterChat' | 'textGame'

export interface WorldPackageManifest {
  packageId: string
  sourceWorldCode: string
  sourceWorldVersion: number
  name: string
  description: string
  authorName: string
  attribution: string
  license: CommunityWorldLicense
  allowedUses: Record<WorldPackageUse, boolean>
  contentWarnings: string[]
  publishedAt: number
}

export interface WorldPackage {
  format: typeof WORLD_PACKAGE_FORMAT
  packageVersion: typeof WORLD_PACKAGE_VERSION
  manifest: WorldPackageManifest
  portableProject: ProjectExportData
  integrity: { algorithm: 'SHA-256'; digest: string }
}

export interface WorldPackageTrustReport {
  valid: boolean
  manifest: WorldPackageManifest | null
  backupReport: ReturnType<typeof inspectProjectBackup> | null
  errors: string[]
  warnings: string[]
}

const LICENSES = new Set<CommunityWorldLicense>([
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'ALL-RIGHTS-RESERVED',
])

const SHAREABLE_TABLES = PROJECT_TABLES
  .filter(spec => spec.exportable && spec.communityShare === 'world' && spec.name !== 'projects')
  .map(spec => spec.name)

const PRIVATE_TABLES = PROJECT_TABLES
  .filter(spec => spec.exportable && spec.communityShare !== 'world' && spec.name !== 'projects')
  .map(spec => spec.name)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前环境不支持分享包完整性校验。')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function payloadForIntegrity(pkg: Pick<WorldPackage, 'format' | 'packageVersion' | 'manifest' | 'portableProject'>) {
  return { format: pkg.format, packageVersion: pkg.packageVersion, manifest: pkg.manifest, portableProject: pkg.portableProject }
}

function buildPortableProject(backup: ProjectExportData): ProjectExportData {
  const root = { ...backup.project } as Record<string, unknown>
  // 世界包不携带作者正文、封面、风格画像或当前角色驱动方案；项目表仍由统一导入入口创建。
  for (const key of ['currentWordCount', 'coverImage', 'writingStyleId', 'methodologyId', 'activeCharacterDrivenPlanId']) {
    delete root[key]
  }
  root.status = 'drafting'
  root.targetWordCount = 0
  root.updatedAt = Date.now()

  const portable: Record<string, unknown> = {
    version: backup.version,
    exportedAt: Date.now(),
    project: root,
  }
  const backupRecord = backup as unknown as Record<string, unknown>
  for (const tableName of SHAREABLE_TABLES) {
    portable[tableName] = JSON.parse(JSON.stringify(backupRecord[tableName] ?? []))
  }
  return portable as unknown as ProjectExportData
}

export async function createWorldPackage(
  projectId: number,
  options: {
    authorName: string
    attribution?: string
    license: CommunityWorldLicense
    allowedUses: Record<WorldPackageUse, boolean>
    contentWarnings?: string[]
  },
): Promise<WorldPackage> {
  const backup = await exportProjectJSON(projectId)
  const project = backup.project as Project
  if (!project.worldCode || !project.worldVersion) throw new Error('该项目还没有可发布的世界编号，请先回到世界引擎页面。')
  if (!options.authorName.trim()) throw new Error('请填写作者署名。')
  if (!LICENSES.has(options.license)) throw new Error('许可选项无效。')
  if (!Object.values(options.allowedUses).some(Boolean)) throw new Error('至少选择一种允许的使用方式。')

  const manifest: WorldPackageManifest = {
    packageId: `${project.worldCode}@v${project.worldVersion}`,
    sourceWorldCode: project.worldCode,
    sourceWorldVersion: project.worldVersion,
    name: project.name,
    description: project.description || '',
    authorName: options.authorName.trim(),
    attribution: options.attribution?.trim() || `${options.authorName.trim()} · ${project.name}`,
    license: options.license,
    allowedUses: { ...options.allowedUses },
    contentWarnings: (options.contentWarnings ?? []).map(item => item.trim()).filter(Boolean).slice(0, 12),
    publishedAt: Date.now(),
  }
  const withoutIntegrity = {
    format: WORLD_PACKAGE_FORMAT as typeof WORLD_PACKAGE_FORMAT,
    packageVersion: WORLD_PACKAGE_VERSION as typeof WORLD_PACKAGE_VERSION,
    manifest,
    portableProject: buildPortableProject(backup),
  }
  return {
    ...withoutIntegrity,
    integrity: { algorithm: 'SHA-256', digest: await sha256(canonicalStringify(payloadForIntegrity(withoutIntegrity))) },
  }
}

/** 只读验证包格式、分享范围和完整性；不写入 IndexedDB。 */
export async function inspectWorldPackage(input: unknown): Promise<WorldPackageTrustReport> {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input)) return { valid: false, manifest: null, backupReport: null, errors: ['分享包必须是 JSON 对象。'], warnings }
  if (input.format !== WORLD_PACKAGE_FORMAT) errors.push('这不是 StoryForge 世界分享包。')
  if (input.packageVersion !== WORLD_PACKAGE_VERSION) errors.push(`不支持的世界分享包版本：${String(input.packageVersion)}。`)

  const rawManifest = input.manifest
  let manifest: WorldPackageManifest | null = null
  if (!isRecord(rawManifest)) {
    errors.push('分享包缺少发布信息。')
  } else {
    const allowedUses = rawManifest.allowedUses
    const validUses = isRecord(allowedUses)
      && ['writing', 'ttrpg', 'characterChat', 'textGame'].every(key => typeof allowedUses[key] === 'boolean')
      && Object.values(allowedUses).some(value => value === true)
    if (typeof rawManifest.packageId !== 'string' || typeof rawManifest.sourceWorldCode !== 'string' || typeof rawManifest.name !== 'string') errors.push('发布信息缺少世界编号或名称。')
    if (typeof rawManifest.sourceWorldVersion !== 'number' || !Number.isInteger(rawManifest.sourceWorldVersion)) errors.push('世界版本无效。')
    if (typeof rawManifest.authorName !== 'string' || !rawManifest.authorName.trim()) errors.push('分享包缺少作者署名。')
    if (!LICENSES.has(rawManifest.license as CommunityWorldLicense)) errors.push('分享包许可无效。')
    if (!validUses) errors.push('分享包没有有效的二创用途声明。')
    if (!Array.isArray(rawManifest.contentWarnings) || rawManifest.contentWarnings.some(value => typeof value !== 'string')) errors.push('内容警告格式无效。')
    if (errors.length === 0) manifest = rawManifest as unknown as WorldPackageManifest
  }

  const backupReport = isRecord(input.portableProject) ? inspectProjectBackup(input.portableProject) : null
  if (!backupReport) errors.push('分享包缺少可导入的世界数据。')
  else if (!backupReport.valid) errors.push(...backupReport.errors)

  const portable = input.portableProject
  if (isRecord(portable)) {
    for (const tableName of SHAREABLE_TABLES) {
      if (!Array.isArray(portable[tableName])) errors.push(`分享包缺少世界表「${tableName}」。`)
    }
    for (const tableName of PRIVATE_TABLES) {
      if (Array.isArray(portable[tableName]) && portable[tableName].length > 0) {
        errors.push(`分享包包含未授权的私有表「${tableName}」，已拒绝导入。`)
      }
    }
  }

  const integrity = input.integrity
  if (!isRecord(integrity) || integrity.algorithm !== 'SHA-256' || typeof integrity.digest !== 'string') {
    errors.push('分享包缺少完整性校验。')
  } else if (manifest && isRecord(input.portableProject)) {
    const payload = {
      format: WORLD_PACKAGE_FORMAT as typeof WORLD_PACKAGE_FORMAT,
      packageVersion: WORLD_PACKAGE_VERSION as typeof WORLD_PACKAGE_VERSION,
      manifest,
      portableProject: input.portableProject as unknown as ProjectExportData,
    }
    if (await sha256(canonicalStringify(payloadForIntegrity(payload))) !== integrity.digest) errors.push('分享包完整性校验失败，文件可能已被修改。')
  }

  if (backupReport?.warnings.length) warnings.push(...backupReport.warnings)
  return { valid: errors.length === 0, manifest, backupReport, errors, warnings }
}

export async function importWorldPackage(input: unknown): Promise<number> {
  const report = await inspectWorldPackage(input)
  if (!report.valid || !report.manifest || !isRecord(input)) throw new Error(`世界分享包预检失败：${report.errors.join('；')}`)
  const packageData = input.portableProject as ProjectExportData
  const project = { ...(packageData.project as Record<string, unknown>) }
  project.worldCode = generateWorldCode()
  project.worldVersion = report.manifest.sourceWorldVersion
  project.communityOrigin = {
    packageId: report.manifest.packageId,
    sourceWorldCode: report.manifest.sourceWorldCode,
    sourceWorldVersion: report.manifest.sourceWorldVersion,
    authorName: report.manifest.authorName,
    license: report.manifest.license,
    importedAt: Date.now(),
  }
  project.status = 'drafting'
  project.targetWordCount = 0
  project.currentWordCount = 0
  const portable = { ...packageData, project } as ProjectExportData
  return importProjectJSON(portable)
}

export function downloadWorldPackage(pkg: WorldPackage, filename: string) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const WORLD_PACKAGE_SHAREABLE_TABLES = [...SHAREABLE_TABLES]
