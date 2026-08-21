# CTXG-3 开工卡：Canon resource descriptor 覆盖

## 任务与完成边界

- 任务 ID：`CTXG-3`
- 基线：`93e6dbf6`（`CTXG-2` 已签收）
- 分支：`refactor/world-engine-harness`
- 目标：在现有 `CONTEXT_SOURCES` / `PROJECT_TABLES` / `FIELD_REGISTRY` 上建立可分页、可读取、可回查原文的 Canon resource provider，覆盖世界、故事、角色、规划、正文和参考六类资料，并淘汰 `rag-library.ts` 的手写资料表/字段清单。
- 非范围：本单元不把 Provider 暴露成 Agent 工具，不实现任务预选器/sufficiency loop，不切换正式生成入口，也不持久化第二份 catalog/index。

## 重新审计结论

1. `rag-library.ts` 仍手写 11 张表、世界观/故事/角色字段数组；它只能服务旧资料库 UI，不能证明 `FIELD_REGISTRY` 新字段或后创建资源自动进入 Gateway。
2. CTXG-1 的 Descriptor 尚缺显式 content revision/hash 和 policy revision/hash，无法满足上位方案对候选 stale、策略变更和可复查输入的要求。
3. `CONTEXT_SOURCES` 已有 `resources` 挂载点，但没有生产 Provider；当前只有合同测试 stub。
4. 现有 Canon 表已有 World/Work owner、portable resource UID、export remap 和引用元数据，可在不新建第四注册表/正文副本的前提下派生 scope、resource key 与关系。
5. story arc stages、detailed outline scenes 和 world link 需要结构适配：只把整个 JSON 字段列为一项，会丢掉稳定 stage/scene 身份；只读 link 行又无法说明目标世界的进入、离开、力量和带出规则。

## 关联闭包

- 入口：`CONTEXT_SOURCES.ragSelection.resources`、旧 `buildRagLibrary()` 兼容桥。
- 读：仅从 `PROJECT_TABLES.resourceIdentity` 声明的 Canon 表和 `FIELD_REGISTRY` 登记字段派生；目录只输出 metadata，正文只在 `read/readOriginal` 加载。
- 写：本单元运行路径零写；作者检索策略仍只经现有 policy update 边界写回源记录。
- 生命周期：不新增表；resource key 复用 CTXG-2 portable UID，导入只重映射 SourceRef 的本地主键而不改变 resource key。
- 测试：六领域覆盖、字段集合漂移、分页末位、空值、删除、改名、导入、跨 World/Work/WorldGroup、candidate、坏 cursor/ref、原文 anchor 与 world-link 规则。

## 施工顺序

1. 扩展 Descriptor 合同，加入内容与检索策略的独立 revision/hash，并补严格校验。
2. 将 descriptor kind/label/字段投影模式并入 `PROJECT_TABLES.resourceIdentity`；Provider 的表集合只能从注册表派生。
3. 实现 storage-neutral Canon Provider：稳定 cursor、metadata-only list/search、按 resource key 读取、SourceRef 当前性校验和 original anchor 回查。
4. 为嵌套 stage、scene、章节派生记忆、世界通道建立专用只读投影；候选/派生摘要使用保守 authority。
5. 把 Provider 挂在 `CONTEXT_SOURCES.ragSelection`；将旧 RAG UI/selection 改为消费 Provider，删除手写 `descriptors()` 与三组字段数组。
6. 加架构守卫和反例，运行定向验证、全静态检查、TypeScript 与 build；Phase 1A 的完整 CI/E2E 仍在 `GATE-P1A` 统一执行。

## 验收与停止条件

- 世界、故事、角色、规划、正文、参考六类均有真实 Descriptor，且所有 source ref 表来自 `PROJECT_TABLES`。
- 新增 `FIELD_REGISTRY` 世界观/故事/角色内容字段后，覆盖守卫自动更新或失败，不再同步手写字段数组。
- 目录分页能遍历到最后创建/最后排序的角色、story arc、chapter；无固定前 N 条永久消失。
- list/search/read/readOriginal 均执行冻结 scope；跨 World、Work 或不允许的 WorldGroup 返回 0/拒绝。
- resource rename 只改变 metadata/content hash，不改变 resource key；导出导入后 key 集合一致，本地 SourceRef recordId 正确重映射。
- world-link 聚合视图包含方向、双向性、描述，以及目标世界进入/离开、力量限制和带出规则。
- 空字段不伪造正文资源；候选默认标记 `candidate`；失效派生摘要不得标为 Canon。
- 伪造 source ref、revision/hash/anchor、坏 cursor 和超 limit 全部 fail-closed；所有 Provider 读取数据库零写。
