import { ADOPTION_BY_TARGET } from '../registry/adoption-schema'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { AUTHORING_NODE_CATALOG } from './catalog'
import { isAuthoringSemantic, type AuthoringNodeTemplate } from './contracts'

export interface AuthoringCatalogIssue {
  code: string
  templateId?: string
  message: string
}

function issue(
  issues: AuthoringCatalogIssue[],
  code: string,
  message: string,
  templateId?: string,
) {
  issues.push({ code, templateId, message })
}

export function validateAuthoringNodeCatalog(
  catalog: readonly AuthoringNodeTemplate[] = AUTHORING_NODE_CATALOG,
  options?: { availablePromptKeys?: ReadonlySet<string> },
): AuthoringCatalogIssue[] {
  const issues: AuthoringCatalogIssue[] = []
  const ids = new Set<string>()
  const catalogIds = new Set(catalog.map(template => template.id))

  for (const template of catalog) {
    if (!template.id.trim()) issue(issues, 'empty-id', '节点模板 ID 不能为空。')
    if (ids.has(template.id)) issue(issues, 'duplicate-id', `节点模板 ID 重复：${template.id}`, template.id)
    ids.add(template.id)

    if (!template.inputs.length && !template.outputs.length) {
      issue(issues, 'no-ports', '节点模板至少需要一个输入或输出端口。', template.id)
    }

    for (const [direction, ports] of [['input', template.inputs], ['output', template.outputs]] as const) {
      const portIds = new Set<string>()
      for (const port of ports) {
        if (!port.id.trim() || portIds.has(port.id)) {
          issue(issues, 'invalid-port-id', `${direction} 端口 ID 为空或重复：${port.id}`, template.id)
        }
        portIds.add(port.id)
        if (!isAuthoringSemantic(port.semantic)) {
          issue(issues, 'unknown-semantic', `未知端口语义：${String(port.semantic)}`, template.id)
        }
        if (port.maxTokens != null && (!Number.isFinite(port.maxTokens) || port.maxTokens <= 0)) {
          issue(issues, 'invalid-budget', `端口预算必须为正数：${port.id}`, template.id)
        }
      }
    }

    for (const sourceKey of template.reads?.sourceKeys ?? []) {
      if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) {
        issue(issues, 'unknown-source', `未登记 CONTEXT_SOURCES：${sourceKey}`, template.id)
      }
    }

    if (template.writes) {
      const { target, fields = [] } = template.writes
      if (!REGISTRY_BY_NAME.has(target)) {
        issue(issues, 'unknown-table', `写入目标不在 PROJECT_TABLES：${target}`, template.id)
      }
      const registeredFields = new Set((FIELD_BY_TARGET.get(target) ?? []).map(field => field.field))
      for (const field of fields) {
        if (!registeredFields.has(field)) {
          issue(issues, 'unknown-field', `写入字段不在 FIELD_REGISTRY：${target}.${field}`, template.id)
        }
      }
      if (!fields.length && !ADOPTION_BY_TARGET.has(target)) {
        issue(issues, 'missing-adoption-schema', `集合写入目标缺少 AdoptionSchema：${target}`, template.id)
      }
    }

    if (
      template.promptModuleKey
      && options?.availablePromptKeys
      && !options.availablePromptKeys.has(template.promptModuleKey)
    ) {
      issue(issues, 'missing-prompt', `PromptModuleKey 没有系统模板：${template.promptModuleKey}`, template.id)
    }

    for (const referencedId of [
      ...(template.recommendedBefore ?? []),
      ...(template.recommendedAfter ?? []),
    ]) {
      if (!catalogIds.has(referencedId)) {
        issue(issues, 'unknown-recommendation', `推荐节点不存在：${referencedId}`, template.id)
      }
    }

    if (template.class === 'control') {
      if (template.outputs.some(port => port.state !== 'control')) {
        issue(issues, 'control-state', '控制节点只能输出 control 状态。', template.id)
      }
      if (template.reads || template.writes) {
        issue(issues, 'control-governance', '控制节点不得读取或写入 Canon。', template.id)
      }
    }
  }

  return issues
}

export function assertValidAuthoringNodeCatalog(
  catalog: readonly AuthoringNodeTemplate[] = AUTHORING_NODE_CATALOG,
  options?: { availablePromptKeys?: ReadonlySet<string> },
): void {
  const issues = validateAuthoringNodeCatalog(catalog, options)
  if (issues.length) throw new Error(issues.map(item => item.message).join('\n'))
}
