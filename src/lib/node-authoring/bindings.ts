import { assembleContext } from '../registry/assemble-context'
import { AUTHORING_NODE_BY_ID } from './catalog'
import { buildRagLibrary, makeRagEntryKey } from '../retrieval/rag-library'
import { createRagSelectionTrace, type RagLibraryEntry } from '../types/rag-library'
import { db } from '../db/schema'
import type { AuthoringNodeInstance } from './contracts'

/**
 * FLOW-3 Canon binding adapter.
 *
 * A node stores only stable RAG keys and a last-observed fingerprint. The current
 * value is always read through the RAG projection and assembleContext, so this
 * module never becomes a second content authority.
 */
export interface AuthoringBindingRead {
  content: string
  sourceHash: string
  sourceKeys: string[]
  included: string[]
  omitted: string[]
  trimmed: string[]
  missing: string[]
}

export interface AuthoringTargetFingerprint {
  hash: string
  key?: string
  ambiguous?: boolean
}

export function hashAuthoringText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function arrayConfig(node: AuthoringNodeInstance, key: string): string[] {
  const value = node.config[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
}

function sourceKeysFor(node: AuthoringNodeInstance): string[] {
  const configured = arrayConfig(node, 'sourceKeys')
  return configured.length ? configured : AUTHORING_NODE_BY_ID.get(node.templateId)?.reads?.sourceKeys ?? []
}

function exactEntryKeysFor(node: AuthoringNodeInstance): string[] {
  const configured = arrayConfig(node, 'ragEntryKeys')
  if (configured.length) return configured
  const ref = node.binding?.ref
  if (!ref?.documentId || !ref.fieldKey) return []
  return [makeRagEntryKey(ref.documentId, ref.fieldKey)]
}

function fingerprintEntries(entries: RagLibraryEntry[], keys: string[]): string {
  return hashAuthoringText(keys.map(key => {
    const entry = entries.find(item => item.key === key)
    return `${key}:${entry?.content ?? ''}`
  }).join('\n'))
}

async function resolveChapterScope(node: AuthoringNodeInstance, projectId: number, worldGroupId: number | null) {
  const title = typeof node.config.chapterTitle === 'string' ? node.config.chapterTitle.trim() : ''
  if (!title) return {}
  const [chapters, outlines] = await Promise.all([
    db.chapters.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
  ])
  const outlineById = new Map(outlines.flatMap(item => item.id == null ? [] : [[item.id, item] as const]))
  const match = chapters.find(chapter => {
    const outline = outlineById.get(chapter.outlineNodeId)
    return chapter.title === title
      && (outline?.worldGroupId ?? null) === worldGroupId
  })
  return match?.id == null ? {} : { chapterId: match.id, outlineNodeId: match.outlineNodeId }
}

/** Read the current Canon value for a node's registered sources or exact fields. */
export async function readAuthoringCanonBinding(input: {
  node: AuthoringNodeInstance
  projectId: number
  worldGroupId: number | null
  contextBudget?: number
}): Promise<AuthoringBindingRead> {
  const exactKeys = exactEntryKeysFor(input.node)
  const sourceKeys = sourceKeysFor(input.node)
  if (exactKeys.length) {
    const entries = await buildRagLibrary({ projectId: input.projectId, worldGroupId: input.worldGroupId })
    const byKey = new Map(entries.map(entry => [entry.key, entry]))
    const missing = exactKeys.filter(key => !byKey.has(key))
    const trace = createRagSelectionTrace()
    const assembled = await assembleContext({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      sourceKeys: ['ragSelection'],
      ragEntryKeys: exactKeys,
      ragSelectionTrace: trace,
      inputBudgetTokens: input.contextBudget,
    })
    return {
      content: assembled.text,
      sourceHash: fingerprintEntries(entries, exactKeys),
      sourceKeys: ['ragSelection'],
      included: trace.included,
      omitted: [...trace.omitted, ...missing],
      trimmed: trace.trimmed,
      missing,
    }
  }

  const assembled = await assembleContext({
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    ...(await resolveChapterScope(input.node, input.projectId, input.worldGroupId)),
    sourceKeys: sourceKeys.length ? sourceKeys : undefined,
    inputBudgetTokens: input.contextBudget,
  })
  return {
    content: assembled.text,
    sourceHash: hashAuthoringText(`${sourceKeys.join(',')}:${assembled.text}`),
    sourceKeys,
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    missing: [],
  }
}

/**
 * Resolve a single-field target before adoption. Collection targets are left
 * ambiguous unless the node has an explicit stable document binding.
 */
export async function readAuthoringTargetFingerprint(input: {
  node: AuthoringNodeInstance
  projectId: number
  worldGroupId: number | null
}): Promise<AuthoringTargetFingerprint | null> {
  const template = AUTHORING_NODE_BY_ID.get(input.node.templateId)
  const field = template?.writes?.fields?.length === 1 ? template.writes.fields[0] : undefined
  const target = template?.writes?.target
  if (!field || !target) return null

  const entries = await buildRagLibrary({ projectId: input.projectId, worldGroupId: input.worldGroupId })
  const boundDocumentId = input.node.binding?.ref?.documentId
  const matching = entries.filter(entry => (
    entry.tableName === target
    && entry.fieldKey === field
    && (!boundDocumentId || entry.documentId === boundDocumentId)
  ))
  if (matching.length > 1 && !boundDocumentId) return { hash: '', ambiguous: true }
  const entry = matching[0]
  const key = entry?.key ?? `${target}::${field}`
  return { hash: hashAuthoringText(`${key}:${entry?.content ?? ''}`), key }
}

/**
 * Resolve a portable binding back to the current Dexie record only at the
 * write boundary. Node graphs never store this numeric id; imports therefore
 * continue to use the stable RAG document id while adoption targets exactly
 * the author's selected record.
 */
export async function resolveAuthoringBoundRecordId(input: {
  node: AuthoringNodeInstance
  projectId: number
  worldGroupId: number | null
  target: string
}): Promise<number | null> {
  const ref = input.node.binding?.ref
  if (!ref?.documentId) return null
  const entries = await buildRagLibrary({ projectId: input.projectId, worldGroupId: input.worldGroupId })
  const matches = entries.filter(entry => (
    entry.tableName === input.target
    && entry.documentId === ref.documentId
    && (!ref.fieldKey || entry.fieldKey === ref.fieldKey)
  ))
  const recordIds = [...new Set(matches.map(entry => entry.recordId))]
  return recordIds.length === 1 ? recordIds[0]! : null
}
