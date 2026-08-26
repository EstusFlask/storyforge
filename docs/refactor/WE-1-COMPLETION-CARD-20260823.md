# WE-1 完成卡：世界观全部可生成字段统一 Harness

日期：2026-08-23  
施工单元：`WE-1`  
状态：完成；允许进入 `STORY-1`

## 结论

世界观现有 18 个可生成字段已从 `FIELD_REGISTRY` 的显式 `aiGeneration` 能力声明派生到同一个
controller、Skill 写集、Context Gateway required 目标和三个 UI 分区。界面、Skill 和服务不再分别维护
可漂移的生成字段清单。此结论只覆盖世界观基座字段，不代表故事、角色、多世界或 Codex 已完成 Phase 2。

## 统一能力合同

- 每个字段只登记 label、原生 kind、直接依赖、允许模式、输出 schema、字符上限和临时候选假设边界。
- 文本字段、`divineDesign` 和 `naturalResources` 共享同一执行路径；两个复杂字段保持 IndexedDB 原生对象，
  不序列化成旁路字符串。
- Skill 的 `writeTargets`、Gateway 的 `requiredWriteTargets`、controller 允许字段和 UI 覆盖守卫均由同一组
  `FieldSpec` 派生；注册表校验同时检查依赖存在性与依赖环。
- 所有正式生成字段均为 Gateway `required`。候选只允许写当前目标字段，缺失依赖可进入
  `temporaryAssumptions`，但不会成为 Canon，也不会顺带覆盖冲突字段。
- expand、rewrite、polish 保持产品模式边界；目标为空时统一降为 create。采纳仍须作者确认并经
  `FIELD_REGISTRY`、`AdoptionSchema`、`adopt()`。

## 本单元发现并修复的真实漏洞

1. 旧候选根合同固定 40,000 字符，会先于字段解析误杀合法的原生长对象。根上限现由已登记字段能力的
   最大值派生，并保留每个字段自己的严格上限。
2. Gateway 虽能 Mandatory 命中当前目标字段，但默认 4,000 token 资源 cap 仍可能只送达前缀。现在已填
   目标字段使用 `mandatoryOriginalResourceKeys` 做确定性原文升级：优先读取、逐字 hash 验签；若精确原文
   超过本轮总预算则 fail-closed，禁止把“已选择”误报成“已完整读取”。其它关联资源继续渐进式披露。
3. `naturalResources` 原生对象此前没有完整 AI 审阅入口。现在可生成、刷新恢复、修改候选、拒绝和采纳，
   且仍与现有手工结构化编辑共用同一 Canon 字段。
4. 旧回归中仍存在手工创建、缺少稳定 Workspace ownership 的 fixture；已迁移为稳定 scope，避免测试
   通过旧兼容路径掩盖 required Gateway 问题。

## 参数化验收

- 18/18 字段：注册能力、Skill 写集、Gateway required 目标和 UI 分区集合完全相等。
- 18/18 字段：空项目进入 create，不预建或写入 worldviews Canon。
- 18/18 字段：部分世界保持 partial 输入边界；已填目标扩写，空目标创建。
- 18/18 字段：已填目标作为 Mandatory Original，尾部 sentinel 实际进入 Context Packet。
- 18/18 字段：跨 Project/World scope 资源不进入包，自动选择数量不超过策略上限。
- 18/18 字段：候选 JSON 恢复后保持原生类型并能与对应 Canon 字段匹配。
- 18/18 字段：候选生成后手工修改目标字段，采纳统一由 CAS stale 阻断。
- UI：文本、神明对象、自然资源对象均覆盖刷新、编辑、拒绝/采纳的共享候选审阅入口。

## 验证证据

- 定向回归：9 files / 63 tests 通过，覆盖 WE-1、RACE-1～4、Gateway selector/execution 和三个世界观面板。
- `npm run check:architecture`、`npm run check:required-tables`、`npm run check:ai-manual`、
  `npm run check:project-metrics`、`npx tsc --noEmit`、`npm run lint -- --no-cache` 通过。
- `npm run build` 通过：3,949 modules transformed，PWA 150 entries 生成成功。
- `git diff --check` 通过。

## 能力边界

- RACE-6 的 100 项 sealed 真实模型评测仍是 Phase 1B 的金切片证据；WE-1 没有伪称 18 个字段都重新跑过
  同等规模的真实模型盲评。WE-1 签收的是统一架构、参数化机械合同和构建门。
- 若当前目标字段的精确原文超过 Skill 本轮上下文总预算，系统会明确拒绝本轮生成；分段原文读取和长输入
  装配属于后续长上下文施工，不允许在本单元静默截断。
- 世界观冲突目前通过候选临时假设和作者重规划表达，不会自动裁决文学事实，也不会跨字段自动同步。

## 下一步约束

`STORY-1` 必须复用本单元的派生能力、Mandatory Original、候选/CAS 和 scope 合同，将
`storyCore` 固定为意图层、`storyArcs` 固定为可执行投影。禁止再为七个故事字段复制手写目标或检索清单。
