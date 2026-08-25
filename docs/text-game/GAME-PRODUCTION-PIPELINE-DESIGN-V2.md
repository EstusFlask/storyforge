# GAME-PROD-1 · 用户驱动游戏生产流程方案 V2

> 版本：`V2 · REVIEWED / SUPERSEDED BY V3`
>
> 日期：2026-08-21
>
> 上一版：[`GAME-PRODUCTION-PIPELINE-DESIGN.md`](./GAME-PRODUCTION-PIPELINE-DESIGN.md)（V1，保留为原始产品方案）
>
> 反向评审：[`GAME-PRODUCTION-PIPELINE-V2-REVIEW.md`](./GAME-PRODUCTION-PIPELINE-V2-REVIEW.md)
>
> 施工权威：[`GAME-PRODUCTION-PIPELINE-BLUEPRINT-V3.md`](./GAME-PRODUCTION-PIPELINE-BLUEPRINT-V3.md)。V2 不能
> 直接被当作施工合同或“已经实现”。

## 0. V2 的任务

V1 已经回答了产品方向、用户介入边界和总体阶段，但仍有若干地方只能指导讨论，不能直接指导编码。V2 不改变
用户目标，而是完成九项施工闭合：

1. 给五张生产表精确字段、索引、引用、不可变边界、并发和回收规则；
2. 让 Build Preview 在不伪造 `GameRelease` 的前提下复用正式运行时；
3. 明确根 Run、子 Run 与多依赖 DAG 的关系，不把“父子树”误当成依赖图；
4. 给图片、音频和二进制存储增加 provider-neutral 合同，不再假设文本聊天接口能生成媒资；
5. 把整包采用与发布收口为一个可回滚事务，不复用当前三段式发布作为原子性证据；
6. 为六种已有游戏产品定义统一生产适配器，不让 AVG 切片反向绑死顶层体系；
7. 为暂停、停止、迟到响应、重规划和演化增加 CAS / epoch；
8. 把“商业质量”改成有数值、有证据、有例外审批的质量门；
9. 补齐多模态外发、来源权利、内容安全、Blob 容量和导入攻击面的治理。

本版使用以下规范词：

- **必须**：缺失即不能进入对应状态；
- **不得**：架构或数据红线；
- **应当**：默认实现，偏离时必须留下决策和测试证据；
- **可以**：不影响核心合同的实现选择。

## 1. 不变的最终用户结果

用户始终是生产流程的唯一授权者，但不承担制片过程中的逐项审批：

```text
用户表达做游戏意愿
  → Agent 基于冻结世界给出有来源的起点建议
  → 用户与 Agent 冻结主角、起点、规模、玩法、风格、媒资、边界、预算
  → 用户明确“开始”
  → 内容 / 视觉 / 音频在同一 Build 中有界并行
  → 系统自动装配、自动 QA、生成可玩 Build Preview
  → 用户试玩后选择发布、继续演化或放弃
  → 新一轮基于父 Build / Release 做影响分析和最小重建
```

以下动作永远需要用户命令：`开始`、扩大预算、改变冻结目标、允许超边界外发、正式发布、启动下一轮演化。
以下动作在已授权包络内由系统自主完成：拆任务、选候选、有限修复、允许的降级、装配、QA、生成预览。

## 2. V1 缺口与 V2 裁决

| 编号 | V1 未闭合点 | 当前代码证据 | V2 裁决 |
|---|---|---|---|
| D-01 | Build Preview 没有正式运行合同 | 正式文字游戏建档只接受不可变 `GameRelease`；草稿试玩只覆盖 STORYGAME 内存态 | 新增 `GameBuildPreviewManifestV1` 和 Build source adapter；SIM 会话显式二选一绑定 Build 或 Release |
| D-02 | 文本 AI 被抽象成了图片/音频生产能力 | `ChatMessage.content` 只有字符串；中央 client 只调用 chat/completions | 新建媒资能力注册表和二进制 adapter；文本模型只负责 Bible/Prompt/需求，不冒充媒资生成器 |
| D-03 | 父子 Run 树无法表达多前驱 DAG | `AgentRun` 只有一个 parent；master plan 已支持 `dependsOn` 和 dependency receipt | 父子只表达所有权；DAG 由冻结 Plan 的 task 依赖和 receipt bindings 表达 |
| D-04 | “一次事务发布”与现有三段发布冲突 | `publishStoryGameDraft()` 依次创建 WorldRevision、WorldRelease、GameRelease | 生产 Build 绑定既有 WorldRelease；新增整包 adopter，在同一外层事务物化正式表并冻结 GameRelease |
| D-05 | 构建期大媒资存储无商业策略 | AVG 导入把 Blob 全量转为 ArrayBuffer 写 IndexedDB，单文件上限 100MB | 统一 `GameMediaBlobStoreV1`；小文件 IndexedDB、可选 OPFS 大文件、可恢复两阶段写和内容寻址 |
| D-06 | 五张表只有名称 | 无 schema、索引、CAS、portable remap 和 GC 合同 | §6 给出完整记录与 Dexie 索引，§7 给出 PROJECT_TABLES 生命周期 |
| D-07 | 商业 QA 没有量化 | 只有示例性硬门 | §15 给出三档数值阈值、测量方法、证据和 waiver 规则 |
| D-08 | 顶层体系只真实覆盖三种产品 | `WorldGameSourceSelectionV1` 只允许 STORYGAME/TEXTADV/AVG | 新增六产品 `GameProductProductionAdapterV1`；起点建议和 Brief 使用全量 `GameProductType` |
| D-09 | 演化并发和来源更新未闭合 | Build/Brief 尚无 revision CAS；WorldRelease 变化只能事后判 stale | Production `stateRevision + controlEpoch`；每次控制/重规划递增 epoch，迟到结果只能成为孤儿证据 |

## 3. 权威边界

### 3.1 继续复用的唯一权威

| 能力 | 唯一权威 | 本体系只增加什么 |
|---|---|---|
| AI 读取 | `CONTEXT_SOURCES + assembleContext()` | 四个有界生产 Context Source |
| AI 写入 | `FIELD_REGISTRY / AdoptionSchema / ADOPTION_EXTENSIONS` | 严格 Brief/Plan/Artifact 候选和整包采用扩展 |
| 数据生命周期 | `PROJECT_TABLES` | 五张业务表和 SIM Build 引用 |
| Agent 执行 | Skill Registry、Run Contract、durable Harness | 一个生产 workflow 与有限子 Skill |
| 游戏规则 | Narrative、各产品模块、SIM reducer | Build source adapter，不复制 reducer |
| 正式媒资 | AVG media / presentation | 构建期候选与发布时物化 |
| 正式发布 | `GameDefinition / GameRelease` | 整包 adopter 与 in-transaction freezer |

### 3.2 明确不新增

- 不新增第二套通用任务队列；
- 不新增第七种产品；
- 不新增 Build 专用简化播放器；
- 不新增正式媒资库；
- 不把 prompt、API Key、隐藏推理或未验签外部响应写进项目导出；
- 不把关闭浏览器后的“可恢复”描述为“仍在后台运行”。

## 4. 用户命令合同

所有控制动作都进入 `GameProductionService`。UI、主 Agent 和快捷入口只能发命令，不能直接改表或 Run。

```ts
type GameProductionCommandV1 =
  | { type: 'create-intent'; commandId: string; worldReleaseId: number; userText: string }
  | { type: 'save-brief-revision'; commandId: string; expectedStateRevision: number; brief: GameProductionBriefV2 }
  | { type: 'authorize-start'; commandId: string; expectedStateRevision: number; briefId: number; authorizationNonce: string }
  | { type: 'pause'; commandId: string; expectedStateRevision: number; reason: string }
  | { type: 'resume'; commandId: string; expectedStateRevision: number }
  | { type: 'stop'; commandId: string; expectedStateRevision: number; retention: 'keep-build' | 'discard-unreleased' }
  | { type: 'revise-goal'; commandId: string; expectedStateRevision: number; userText: string }
  | { type: 'publish'; commandId: string; expectedStateRevision: number; buildId: number; expectedManifestHash: string }
  | { type: 'evolve'; commandId: string; expectedStateRevision: number; base: GameEvolutionBaseV1; userText: string }
```

### 4.1 命令通用不变量

1. `commandId` 在 Production 内幂等；相同命令重复提交返回第一次结果；
2. `expectedStateRevision` 不等于当前值时返回 `production-state-conflict`，不得最后写覆盖；
3. 每次成功控制动作递增 `stateRevision`；会使运行中工作失效的动作同时递增 `controlEpoch`；
4. 子任务写 Artifact 前必须比较 Build 的 `controlEpoch`；不匹配只写 Run orphan evidence，不写 Build；
5. `authorize-start` 的幂等键为 `productionId + briefHash + authorizationNonce`；
6. `publish` 在事务内再次比较 Production revision、Build hash 和 root terminal receipt；
7. 命令日志只记录安全摘要，不记录 Key、完整外部请求或用户未授权资料。

### 4.2 命令前置和结果

| 命令 | 前置状态 | 成功结果 | 必须拒绝 |
|---|---|---|---|
| create-intent | WorldRelease 可验证 | Production=`consulting` | 来源不存在、跨 Work、hash 损坏 |
| save-brief-revision | consulting/brief-ready/paused | 新增不可变 Brief revision | 旧 revision、非法预算、未决硬项 |
| authorize-start | brief-ready/paused | 新 Build + root Run，状态 authorized/planning | Brief 未授权、成本未知、来源 stale |
| pause | planning/building/integrating/validating | 不再发起新调用，状态 paused | 已 released/archived |
| resume | paused/recovery-required | 重验后进入原阶段 | 来源、Key、配额或 receipt 不再满足 |
| stop | 非终态 | 取消调度并隔离迟到响应 | 已发布 Build 只能归档，不能“撤销发布” |
| revise-goal | consulting/paused/preview-ready | 新 Brief revision + 影响摘要 | 运行中未先暂停 |
| publish | preview-ready/release-ready | 原子产生 Definition/Release | 任一硬门、hash、权利、来源或事务检查失败 |
| evolve | preview-ready/released | 新 Brief 草稿和影响计划 | base hash 不可验证、兼容等级未知 |

## 5. 状态机

### 5.1 Production 状态

```ts
type GameProductionStatusV1 =
  | 'consulting'
  | 'brief-ready'
  | 'producing'
  | 'paused'
  | 'preview-ready'
  | 'released'
  | 'stopped'
  | 'failed'
  | 'archived'
```

Production 是多 Build 聚合，不把某个子任务失败直接等同为整个 Production 永久失败。存在可恢复 Build 时，
Production 可处于 `paused`；只有没有可恢复计划且用户未启动新 Brief 时才进入 `failed`。

### 5.2 Build 状态

```ts
type GameBuildStatusV1 =
  | 'draft'
  | 'authorized'
  | 'planning'
  | 'building'
  | 'integrating'
  | 'validating'
  | 'preview-ready'
  | 'release-ready'
  | 'released'
  | 'paused'
  | 'recovery-required'
  | 'failed'
  | 'cancelled'
  | 'archived'
```

合法主路径：

```text
draft → authorized → planning → building → integrating → validating
      → preview-ready → release-ready → released
```

`paused` 记录 `resumeState`；`recovery-required` 记录验证失败项；`cancelled` 不可恢复为同一 Build，继续目标必须创建
新 Build。`released` 不回退，撤回当前版本只能切换 Production 指针，不能改旧 Release。

### 5.3 Artifact 状态

```ts
type GameBuildArtifactStatusV1 =
  | 'pending'
  | 'candidate'
  | 'accepted'
  | 'carried-forward'
  | 'rejected'
  | 'orphaned'
  | 'invalid'
```

同一 `buildId + artifactKey` 只能有一个 accepted/carried-forward 版本。该唯一性由事务内 validator 强制，因为
IndexedDB 无法声明条件唯一索引。

## 6. 精确数据合同

### 6.1 `gameProductions`

```ts
interface GameProductionRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionKey: string
  title: string
  status: GameProductionStatusV1
  stateRevision: number
  controlEpoch: number
  currentBriefId: number | null
  currentBuildId: number | null
  currentGameDefinitionId: number | null
  currentGameReleaseId: number | null
  lastCommandId: string | null
  lastErrorJson: string
  createdAt: number
  updatedAt: number
}
```

Dexie：

```text
++id, projectId, worldId, workId, &[workId+productionKey], status,
currentBriefId, currentBuildId, currentGameDefinitionId, currentGameReleaseId, updatedAt
```

`stateRevision` 从 1 开始；`controlEpoch` 从 0 开始。所有指针只用于查询便利，权威关系仍由子记录的外键与 hash
验证。指针损坏时修复为空，不能据此删除正式 Release。

### 6.2 `gameProductionBriefs`

```ts
interface GameProductionBriefRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  revision: number
  parentBriefId: number | null
  status: 'draft' | 'authorized' | 'superseded' | 'withdrawn'
  sourceWorldReleaseId: number
  sourceWorldContentHash: string
  userIntentSummary: string
  unresolvedJson: string
  estimateJson: string
  briefJson: string
  briefHash: string
  authorizedAt: number | null
  createdAt: number
}
```

Dexie：

```text
++id, projectId, worldId, workId, productionId, &[productionId+revision],
&[productionId+briefHash], [productionId+status], parentBriefId, sourceWorldReleaseId, createdAt
```

`briefJson` 通过 exact-key parser 和 canonical hash；记录创建后内容字段不可更新。授权通过一次 CAS 将
`status/authorizedAt` 写入，之后只可标 `superseded/withdrawn`，不得修改 Brief 本体。

### 6.3 `gameBuilds`

```ts
interface GameBuildRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  productionId: number
  buildNumber: number
  briefId: number
  parentBuildId: number | null
  sourceGameReleaseId: number | null
  rootRunId: number | null
  status: GameBuildStatusV1
  resumeState: GameBuildStatusV1 | null
  stateRevision: number
  controlEpoch: number
  planRevision: number
  planJson: string
  planHash: string
  budgetLedgerJson: string
  manifestJson: string
  manifestHash: string
  previewManifestJson: string
  previewManifestHash: string
  qualityReportJson: string
  qualityReportHash: string
  compatibilityJson: string
  adoptionIntentHash: string | null
  adoptedGameDefinitionId: number | null
  releasedGameReleaseId: number | null
  failureJson: string
  authorizedAt: number
  startedAt: number | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
}
```

Dexie：

```text
++id, projectId, worldId, workId, productionId, &[productionId+buildNumber],
[productionId+status], briefId, parentBuildId, sourceGameReleaseId, rootRunId,
manifestHash, previewManifestHash, releasedGameReleaseId, updatedAt
```

Build 的 Plan、Manifest、Quality Report 每次写入都先解析、重算 hash、比较 `stateRevision/controlEpoch`。进入
`preview-ready` 后，内容和已接受 Artifact 冻结；任何修改必须创建下一 buildNumber。

### 6.4 `gameBuildArtifacts`

```ts
type GameBuildArtifactKindV1 =
  | 'consultation-evidence' | 'game-design' | 'narrative' | 'product-module'
  | 'visual-bible' | 'audio-bible' | 'asset-manifest' | 'image' | 'audio'
  | 'presentation' | 'quality-report' | 'playtest-report' | 'integration-report'

interface GameBuildArtifactRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  buildId: number
  artifactKey: string
  requirementKey: string | null
  version: number
  kind: GameBuildArtifactKindV1
  mediaKind: AvgMediaKind | null
  status: GameBuildArtifactStatusV1
  producerRunId: number | null
  producerReceiptHash: string | null
  controlEpoch: number
  inputHash: string
  contentHash: string
  payloadJson: string
  metadataJson: string
  qualityJson: string
  rightsJson: string
  blobId: number | null
  mimeType: string | null
  byteSize: number
  parentArtifactId: number | null
  parentArtifactHash: string | null
  carriedFromArtifactId: number | null
  createdAt: number
  updatedAt: number
}
```

Dexie：

```text
++id, projectId, worldId, workId, buildId, &[buildId+artifactKey+version],
[buildId+status], [buildId+requirementKey], producerRunId, blobId, contentHash, createdAt
```

结构化产物 `blobId=null`，二进制产物必须绑定 ready Blob。carried-forward Artifact 创建新记录但可复用同一
content-addressed Blob，并保存父 Artifact/hash 和复用 receipt。

### 6.5 `gameBuildArtifactBlobs`

```ts
interface GameBuildArtifactBlobRecordV1 {
  id?: number
  projectId: number
  worldId: number
  workId: number
  contentHash: string
  mimeType: string
  byteSize: number
  backend: 'indexeddb' | 'opfs'
  storageState: 'pending-write' | 'ready' | 'pending-delete' | 'corrupt'
  data: ArrayBuffer | null
  opfsPath: string | null
  createdAt: number
  updatedAt: number
}
```

Dexie：

```text
++id, projectId, worldId, workId, &[workId+contentHash], storageState, byteSize, updatedAt
```

Blob 是 Work 内内容寻址记录，不再一对一归属于 Artifact。删除 Artifact 不立即删除 Blob；领域 GC 在同一 Work
中确认没有 Build Artifact 和正式采用事务引用后再标 `pending-delete`。正式 `avgMediaBlobs` 当前仍独立冻结，
因此删除未发布 Build Blob 不会破坏 GameRelease。

## 7. PROJECT_TABLES 生命周期

### 7.1 Owner、refs 和便携重映射

| 表 | owner | 关键 refs | 导入重映射 |
|---|---|---|---|
| gameProductions | work | id→Brief/Build cascade；id→Work 指针由 Work 删除级联 | worldId/workId；四个 current 指针按目标表重映射，缺失置 null |
| gameProductionBriefs | work(parent Production) | id→Build.briefId keep；id→Production.currentBriefId setNull | productionId、parentBriefId、sourceWorldReleaseId |
| gameBuilds | work(parent Production) | id→Artifact/Preview Session cascade；id→child.parentBuildId keep；id→Production.currentBuildId setNull | productionId、briefId、parentBuildId、sourceGameReleaseId、rootRunId、adopted/released 指针 |
| gameBuildArtifacts | work(parent Build) | id→派生/复用 parent refs setNull；Blob 删除使用 keep + 领域阻止 | buildId、producerRunId、blobId、parent/carried refs |
| gameBuildArtifactBlobs | work | id→Artifact.blobId keep；删除只走 GC service | worldId/workId；二进制 portableData 完整性 |

`keep` 不代表允许悬空。它表示通用删除器不猜共享 Blob 或跨 Build 证据的处置；唯一删除入口
`deleteGameBuild()` / `collectUnreferencedBuildBlobs()` 必须检查引用并留下 GC receipt。

### 7.2 导出与导入

1. 导出只包含 `storageState=ready` 的 Blob；OPFS 先流式读取、校验 hash，再编码为便携二进制；
2. 导入在隔离事务中先解析所有 JSON、建立 ID map，再写元数据和 Blob；
3. Blob 按 `[workId+contentHash]` 去重，重复内容必须比较 mime/size/hash；
4. 任何 data URL、MIME、长度或 hash 不符导致整次导入零写入；
5. 未完成 Run 导入后状态变为 `recovery-required`，不得自动继续外部调用；
6. current 指针缺失只置 null，不从标题、数组顺序或本地旧 ID 猜测；
7. 正式 Release 的导入仍由已有表生命周期负责，不能从 Build 重新生成来“修复”。

### 7.3 删除和归档

- 未发布 Build：可删除 Artifact、Preview Session 和 Run 子树；共享 Blob 进入可恢复 GC；
- 已发布 Build：默认只允许归档；强制删证据必须先导出并确认，GameRelease 与正式媒资不删；
- Production：存在已发布 Build 时默认归档，不能通过级联删除当前或历史 Release；
- Brief：被 Build 使用时保留；没有 Build 的草稿 revision 可删；
- Blob：只有引用计数为零、无 pending adoption、无导出锁时才删除；OPFS 删除失败保留 pending 状态供恢复。

## 8. 严格 JSON 合同

### 8.1 `GameProductionBriefV2`

V2 在 V1 基础上增加用户授权与外发包络：

```ts
interface GameProductionBriefV2 {
  schema: 'storyforge.game-production-brief'
  version: 2
  source: {
    worldReleaseId: number
    worldContentHash: string
    selection: WorldGameSourceSelectionV2
    startingPoint: GameStartingPointV1
  }
  intent: {
    productType: GameProductType
    playerRole: string
    protagonistRefs: string[]
    openingSituation: string
    coreExperience: string[]
    requiredFacts: string[]
    forbiddenChanges: string[]
    contentBoundaries: string[]
    tone: string[]
  }
  scale: GameProductionScaleV1
  media: GameProductionMediaProfileV1
  budget: GameProductionBudgetV2
  qualityProfile: 'prototype' | 'internal' | 'commercial-candidate'
  externalDataPolicy: {
    allowedProviderPresetIds: string[]
    allowedDataClasses: Array<'world-selection' | 'character-anchors' | 'scene-summary' | 'dialogue' | 'reference-image' | 'voice-script'>
    disallowedPortableRefs: string[]
  }
  fallbackPolicy: GameProductionFallbackPolicyV1
  completionContract: GameProductionCompletionContractV1
  unresolvedDecisionKeys: string[]
}
```

`unresolvedDecisionKeys` 非空时不能 authorize。`allowedProviderPresetIds` 只保存预设 ID，不复制 API Key；运行时
重新解析现有 AI 配置并比较 provider/model capability hash。

### 8.2 `GameProductionPlanV2`

```ts
interface GameProductionPlanTaskV2 {
  taskKey: string
  lane: 'planning' | 'content' | 'visual' | 'audio' | 'integration' | 'qa'
  kind: string
  skillId: string | null
  executionMode: 'deterministic' | 'model' | 'media-provider' | 'human-import'
  dependsOn: string[]
  requiredReceipts: Array<{ taskKey: string; receiptHash: string | null }>
  inputArtifactKeys: string[]
  outputArtifactKeys: string[]
  requirementKeys: string[]
  concurrencyGroup: string
  subjectLockKeys: string[]
  priority: number
  budgetReservation: GameTaskBudgetReservationV1
  maxAttempts: number
  timeoutMs: number
  failurePolicy: 'fail-build' | 'pause' | 'fallback' | 'skip-optional'
  fallbackTaskKey: string | null
  acceptanceGateIds: string[]
  reuse: GameArtifactReuseDecisionV1 | null
}

interface GameProductionPlanV2 {
  schema: 'storyforge.game-production-plan'
  version: 2
  productionId: number
  buildId: number
  briefHash: string
  sourceWorldContentHash: string
  templateVersion: string
  productAdapterVersion: string
  controlEpoch: number
  maxParallelTasks: number
  providerConcurrency: Record<string, number>
  tasks: GameProductionPlanTaskV2[]
  joinTaskKey: string
  planHash: string
}
```

计划 validator 必须证明：exact-key、无环、所有依赖存在、每个输出唯一所有者、所有 required requirement 有生产者
或合法 fallback、预算预留总额不超 Brief、并发组有上限、join 闭包包含全部硬门、复用依据 hash 完整。

### 8.3 `AssetRequirementManifestV2`

V2 不再使用自由 `Record<string, unknown>` 作为最终 acceptance。每种 kind 有可辨识联合：

```ts
type AssetRequirementSpecificationV2 =
  | ImageAssetSpecificationV1
  | AudioAssetSpecificationV1

interface AssetRequirementV2 {
  requirementKey: string
  version: number
  kind: AvgMediaKind
  criticality: 'required' | 'recommended' | 'optional'
  subjectRefs: string[]
  sceneRefs: string[]
  beatRefs: string[]
  narrativePurpose: string
  continuityAnchorKeys: string[]
  specification: AssetRequirementSpecificationV2
  acceptanceGateIds: string[]
  fallback: GameMediaFallbackV1 | null
  sourceArtifactHash: string
}
```

### 8.4 `GameBuildManifestV2` 和 Preview

```ts
interface GameBuildManifestV2 {
  schema: 'storyforge.game-build'
  version: 2
  production: { productionId: number; buildId: number; buildNumber: number }
  lineage: { briefId: number; briefHash: string; parentBuildId: number | null; parentManifestHash: string | null }
  source: { worldReleaseId: number; worldContentHash: string; sourceGameReleaseId: number | null }
  execution: { rootRunId: number; terminalReceiptHash: string; planHash: string; controlEpoch: number }
  product: { productType: GameProductType; adapterId: string; adapterVersion: string }
  acceptedArtifacts: GameBuildArtifactBindingV1[]
  requirements: AssetRequirementBindingV1[]
  gamePackage: AnyGameReleaseManifestV1
  quality: { profile: string; reportHash: string; hardGateIds: string[]; waiverIds: string[] }
  budget: GameProductionBudgetSettlementV1
  compatibility: GameSaveCompatibilityReportV1
  manifestHash: string
}

interface GameBuildPreviewManifestV1 {
  schema: 'storyforge.game-build-preview'
  version: 1
  buildId: number
  buildManifestHash: string
  gamePackage: AnyGameReleaseManifestV1
  gamePackageHash: string
  fallbackSummary: string[]
  previewHash: string
}
```

`gamePackage` 复用正式 Release 的冻结内容形状，但外层 schema 明确是 Build Preview，且数据库中没有对应
`GameRelease` 行。正式发布时重新物化正式表并生成 Release，事务内要求新 Release manifest 的 canonical hash
等于 `gamePackageHash`。

## 9. Build Preview 运行合同

### 9.1 SIM 绑定扩展

`SimulationSession` 增加：

```ts
gameBuildId?: number | null
runtimeSourceHash?: string | null
```

schema 增加 `gameBuildId` 索引。对正式六类文字游戏会话，必须满足：

```text
(gameReleaseId != null) XOR (gameBuildId != null)
```

- Release 会话：继续调用 `assertGameReleaseUnchanged()`；
- Build 会话：调用 `assertGameBuildPreviewUnchanged()`，要求 Build 为 preview-ready/release-ready、preview hash 匹配、
  WorldRelease 未改变、所有 Blob ready；
- legacy/sandbox：两者都可为空；
- Preview Session 随未发布 Build 删除而级联；发布后的旧 Preview 可归档或迁移，不改原事件流。

### 9.2 统一运行入口

新增：

```ts
type PlayableGameSourceV1 =
  | { kind: 'release'; gameReleaseId: number }
  | { kind: 'build'; gameBuildId: number; expectedPreviewHash: string }

async function resolvePlayableGamePackage(source: PlayableGameSourceV1): Promise<ResolvedPlayableGamePackageV1>
async function createPlayableGameSession(input: CreatePlayableGameSessionInputV1): Promise<SimulationSession>
```

现有播放器改为消费 `ResolvedPlayableGamePackageV1`，不再自己区分表。选择/effect、SIM reducer、AVG Cue、存档
和回放仍走同一代码。现有 `createReleasedGameSession()` 保留为 release wrapper，不能被 Build 旁路。

### 9.3 Preview 到 Release 存档

发布后如果 `release.contentHash === preview.gamePackageHash` 且兼容报告为 compatible，可创建新的 Release Session，
以 Preview Session 为 parent 并冻结相同事件投影/receipt；不修改旧 Session 的 source。hash 不同或兼容等级非
compatible 时必须提示重开或保留旧 Preview，不能静默迁移。

## 10. Run 所有权树与任务 DAG

### 10.1 两种拓扑不能混用

- `AgentRun.parentRunId/parentRelation`：所有权、预算和导出生命周期树；每个 Run 只有一个父 Run；
- `GameProductionPlanV2.tasks[].dependsOn`：任务依赖 DAG；一个任务可依赖多个前驱；
- `requiredReceipts`：DAG 边的可验证运行证据；不能通过增加多个 parentRunId 模拟。

### 10.2 具体运行结构

```text
root AgentRun  parent=null  workflow=long-running-resumable
├─ child relation=task:plan
├─ child relation=task:content.skeleton
├─ child relation=task:content.chapter-001
├─ child relation=task:visual.bible
├─ child relation=task:visual.background.harbor
├─ child relation=task:audio.bible
├─ child relation=task:audio.bgm.main
├─ child relation=task:integrate
└─ child relation=task:qa
```

每个 cost-bearing / provider 任务创建或复用一个 child Run；确定性极小步骤可以只作为 root step 事件，但仍在 Plan
中。`parentRelation=task:<taskKey>` 在同一 root 唯一；重试使用同一 Run 的 generation/attempt。新 Plan revision 若
改变任务输入，旧 child 标 stale/orphan，新 taskKey 或新 Build 承担后续执行。

### 10.3 调度器

调度循环只能做以下确定性动作：

1. 读取 Build/Plan/root projection；
2. CAS 领取 ready task；
3. 验证 controlEpoch、依赖 terminal receipt、输入 Artifact hash；
4. 预留预算和 provider slot；
5. 创建/恢复 child Run；
6. 执行一个已登记 adapter/Skill；
7. 验签输出并写 Artifact；
8. 结算预算、释放 slot、追加 root event；
9. 若无 ready task，判断 join、阻塞或终态。

并发默认值：全局 3；同一文本 provider 2；同一媒资 provider 1；同一人物锚点锁 1；同一 requirement 1。Brief
模板可降低，但不能超过 provider capability registry 的硬上限。

### 10.4 暂停、停止和迟到结果

- pause：立即递增 controlEpoch；不领取新任务；支持取消的 adapter 发送 AbortSignal；不支持取消的调用可完成但
  结果因 epoch 不符只能记 orphan；
- resume：新 epoch 下重新验证 ready 集合；已验签 Artifact 可复用，未验签响应不得自动接回；
- stop：状态 cancelled，所有未启动任务取消；迟到输出永不绑定 Build；
- refresh：从 root checkpoint、child terminal receipt 和 Artifact hash 重投影；相同幂等键不再次调用；
- replan：旧 Plan 不修改，planRevision+1；只允许在 paused 或 planning，预算增加必须用户重新 authorize。

## 11. Provider-neutral 媒资能力

### 11.1 文本模型与媒资模型分工

文本 AI 只生成：视觉/音频圣经、需求、提示、alt、脚本、审核说明。实际图片/音频二进制必须来自：

- 已登记图片/音频 provider adapter；
- 用户导入资产；
- 项目已有且权利/一致性仍满足的正式媒资；
- 明确标记的 deterministic fallback（占位图、静音或本地程序化 SFX），不得冒充商业媒资。

### 11.2 能力注册表

```ts
interface GameMediaProviderCapabilityV1 {
  adapterId: string
  version: string
  mediaKinds: AvgMediaKind[]
  operations: Array<'generate' | 'variation' | 'edit' | 'upscale' | 'transcode' | 'import'>
  maxInputBytes: number
  maxOutputBytes: number
  maxParallel: number
  supportsCancellation: boolean
  supportsSeed: boolean
  supportsReferenceImages: boolean
  costUnit: 'request' | 'image' | 'second' | 'token' | 'unknown'
  externalDataClasses: string[]
  rightsFields: string[]
}
```

adapter 合同：

```ts
interface GameMediaProviderAdapterV1 {
  capability: GameMediaProviderCapabilityV1
  estimate(request: GameMediaRequestV1): Promise<GameMediaEstimateV1>
  generate(request: GameMediaRequestV1, signal: AbortSignal): Promise<GameMediaCandidateV1[]>
  validateResponse(candidate: GameMediaCandidateV1): Promise<GameMediaTechnicalReportV1>
}
```

所有 adapter 由中央 registry 解析 presetId；不得接收导出的 Key，也不得把 Key 写入 Run/Artifact。费用未知返回
`unknown`，required 需求在用户未显式允许未知成本时不得自动开始。

### 11.3 首批 adapter

V3 施工至少提供：

1. `existing-avg-media-v1`：复用当前 Work 已有媒资；
2. `local-import-v1`：用户提前提供的素材进入同一自动 QA/绑定流程，中间不逐项审批；
3. `openai-compatible-image-v1` 或明确 provider-specific image adapter：仅在对应 preset 声明 images capability 时开放；
4. `procedural-audio-v1`：本地生成短提示音/环境底，不承担商业音乐或真人语音；
5. 一个真实音频 provider adapter 在 1F 上线前登记，否则 commercial-candidate 的 music/sfx profile 保持阻断，
   不能用程序化占位冒充完成。

## 12. Blob Store

### 12.1 统一接口

```ts
interface GameMediaBlobStoreV1 {
  put(input: BlobPutInputV1): Promise<ReadyBlobRefV1>
  read(ref: ReadyBlobRefV1): Promise<Blob>
  verify(ref: ReadyBlobRefV1): Promise<BlobIntegrityReportV1>
  export(ref: ReadyBlobRefV1): AsyncIterable<Uint8Array>
  markForDeletion(ref: ReadyBlobRefV1): Promise<void>
  collect(workId: number): Promise<GameBlobGcReportV1>
}
```

### 12.2 后端策略

- `<= 8 MiB` 默认 IndexedDB；
- `> 8 MiB` 且 OPFS 可用时默认 OPFS；
- OPFS 不可用时允许 IndexedDB，但单文件仍不超过 100 MiB，总预算由 Brief 和 storage estimate 限制；
- 写入顺序：pending metadata → 写临时/数据 → hash/size/mime 验证 → CAS ready；
- 崩溃恢复：pending-write 超过 30 分钟重新验证或清理；
- OPFS 文件名只使用 contentHash，不使用用户标题、角色名或原文件名；
- 任何读取先比较 ready、size 和 hash；corrupt Blob 不得进入集成。

### 12.3 配额

开始前调用 `navigator.storage.estimate()`；至少预留预计新增字节的 1.25 倍加 64MiB 安全空间。达到 80% quota
警告，达到 90% 停止新媒体任务。清理建议只能列出未发布 Build、orphan 和无引用 Blob，不自动删除正式媒资。

## 13. 六产品生产适配器

```ts
interface GameProductProductionAdapterV1 {
  id: string
  version: string
  productType: GameProductType
  supportedMediaKinds: AvgMediaKind[]
  compileContent(input: ProductCompileInputV1): Promise<ProductDraftBundleV1>
  validateDraft(input: ProductDraftBundleV1): Promise<ProductValidationReportV1>
  buildPlayablePackage(input: ProductPlayableInputV1): Promise<AnyGameReleaseManifestV1>
  adoptWithinTransaction(input: ProductAdoptionInputV1): Promise<ProductAdoptionResultV1>
  assessSaveCompatibility(input: ProductCompatibilityInputV1): Promise<GameSaveCompatibilityReportV1>
}
```

| productType | 必需模块 | 媒资默认 |
|---|---|---|
| storygame | narrative | none/key-art |
| character-interaction | narrative + interaction | character poses 可选 |
| text-adventure | narrative + interaction + adventure | locations/items 可选 |
| avg | narrative + presentation | background/actor/cg/audio 按 profile |
| narrative-simulation | narrative + simulation | key-art/ambience 可选 |
| text-open-world | narrative + interaction + adventure + simulation + openWorld | illustrated 可选 |

所有 adapter 最终都必须调用已有 parser/validator/release freezer。首个垂直切片只开放 storygame/avg，但顶层
Brief、表和状态机从第一天起不得写死三产品子集。

## 14. 整包编译、采用和原子发布

### 14.1 Build compiler

`compileGameBuild()` 是纯确定性服务：读取 accepted/carried-forward Artifact、运行产品 adapter、解析所有 JSON、
解析并校验 Blob、绑定 requirementKey、生成 fallback、计算 `GameBuildManifestV2` 和 Preview manifest。它不得调用
模型，不得写正式表。

### 14.2 原子采用扩展

新增 `game-production-package-adoption-v1`，在 `ADOPTION_EXTENSIONS` 为实际目标表逐一声明同一入口：

```text
src/lib/game-production/adoption.ts
```

唯一公共入口：

```ts
async function adoptGameBuildAndPublish(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  expectedStateRevision: number
  expectedManifestHash: string
  commandId: string
}): Promise<GameBuildPublicationV1>
```

### 14.3 一个事务内的顺序

1. 打开包含 Production、Brief、Build、Artifacts、Blob metadata、所有产品正式表、WorldRelease、GameRelease 的
   一个 `rw` Dexie transaction；
2. 重新读取并验证 scope、CAS、状态、Brief/source/build/root receipt/manifest/quality/rights；
3. 通过产品 adapter 物化 Narrative、Beat、Choice、GameDefinition、专项模块；
4. 物化被实际绑定的正式 AVG media/blob 和 presentation；
5. 调用重构后的 `freezeGameReleaseInCurrentTransaction()`，不另开独立事务；
6. 验证新 Release manifest canonical hash 等于 Build `gamePackageHash`；
7. 写 Build adoption intent/result、状态 released 和 Production current pointers；
8. 事务提交后再做非权威 UI/诊断更新。

生产流程直接绑定用户选定的既有 WorldRelease，因此不得调用 `publishStoryGameDraft()` 去制造新的世界修订。现有
手工作者发布路径不删除，但其三段式流程不能作为本体系的原子性实现。

## 15. 质量门 V2

### 15.1 三档阈值

| 指标 | prototype | internal | commercial-candidate |
|---|---:|---:|---:|
| 严格 parser / hash / 引用错误 | 0 | 0 | 0 |
| required 路径可达率 | 100% | 100% | 100% |
| 声明结局可达率 | 100% | 100% | 100% |
| required 媒资覆盖 | 可 fallback | 100% 或显式允许 fallback | 100% |
| recommended 媒资覆盖 | 不限制 | ≥80% | ≥95% |
| alt/字幕覆盖 | required ≥80% | required 100% | 所有展示媒资 100% |
| 自动选择/节点/结局覆盖 | 主路线 | 所有有限分支 | 所有有限分支 + 固定 seed 系统路径 |
| 权利字段完整 | 外部产物 100% | 外部产物 100% | 全部发布媒资 100% |
| unresolved hard issue | 允许非阻断标注 | 0 | 0 |
| 导出导入 hash 往返 | Build 可选 | 必须 | 必须 + 损坏零写入 |

### 15.2 结构和玩法硬门

- dangling successor、invalid choice target、orphan required Beat/Choice、无入口、无可达结局：全部为 0；
- 除明确标注系统循环外，无法到达新状态的 blocking cycle 为 0；
- 所有主路线可开始、至少保存/恢复一次、完成、重玩；
- 同 seed + 相同事件序列得到相同 state hash；
- 自动遍历上限命中必须报告 coverage incomplete，不能算通过；
- commercial-candidate 至少一次真实用户主路线试玩 receipt。

### 15.3 图片硬门

- MIME 在 adapter 白名单，真实解码类型与声明一致；
- required 图片最小边：背景 1280×720、CG 1280×720、立绘高 1024、UI 图标 256；产品模板可提高；
- 单图发布目标 `<= 12 MiB`，超出必须转码或阻断；
- 透明背景需求必须实际包含 alpha；
- contentHash/byteSize/width/height 全部复核；
- required 角色锚点相似性/人工规则检查通过，关键服装、肤色、标志物和禁用元素无硬冲突；
- 模型生成文字不得承载唯一 UI/剧情信息；
- alt text 非空且不泄露未到达剧情。

### 15.4 音频硬门

- 可解码、时长与声明误差 `<= 100ms`、无 NaN/空文件；
- BGM/ambience integrated loudness 目标 `-18 LUFS ±3`，voice `-16 LUFS ±2`，true peak `<= -1 dBTP`；
- loop 需求首尾无可闻爆音，自动 seam 检查失败则必须人工/替换；
- required voice 文本一致或有字幕；语音不能成为唯一信息；
- 浏览器拒绝 autoplay、静音或设备切换后仍可完整通关；
- 真人声音克隆默认硬拒绝，除非 rightsJson 包含可验证同意和用途。

### 15.5 性能预算

默认 commercial 本地模板：

- 首次可交互前阻塞媒资 `<= 12 MiB`；其余按场景预取；
- 单 Build 便携包默认 `<= 750 MiB`，超过必须用户显式提高存储预算；
- 桌面峰值解码内存 `<= 350 MiB`，移动目标 `<= 180 MiB`；
- 30 分钟自动游玩后稳定状态内存相对第 5 分钟增长 `<= 10%`；
- 本地已缓存场景切换 p95 `<= 250ms`，选择输入响应 p95 `<= 100ms`；
- optional 资产失败不能阻塞文字渲染和选择。

阈值由版本化 Quality Profile 注册表管理。修改阈值会使旧 QA receipt stale，不能静默沿用。

### 15.6 waiver

prototype/internal 可有显式 waiver；commercial 只允许非安全、非权利、非数据完整性、非核心可玩性的 soft gate。
waiver 必须记录 gateId、理由、影响、批准者、到期和 Build hash。发布后修改 waiver 不改变旧 Release。

## 16. 演化、CAS 与存档兼容

### 16.1 Evolution base

```ts
type GameEvolutionBaseV1 =
  | { kind: 'build'; buildId: number; manifestHash: string }
  | { kind: 'release'; gameReleaseId: number; contentHash: string }
```

演化只创建新 Brief/Build；父记录不修改。Planner 必须输出 artifact 依赖闭包、直接失效、传播失效、可复用、需
重验、需重做、删除候选、成本和兼容等级。

### 16.2 复用键

```text
reuseKey = hash(
  inputArtifactHashes,
  sourceWorldContentHash,
  skill/adapter version,
  execution capability hash,
  quality profile version,
  requirement specification hash,
  rights policy version
)
```

只有 reuseKey 完全相同才可直接 carried-forward。仅内容 hash 相同但质量/权利标准变更时必须重新 QA。Blob 可按
contentHash 共用，Artifact/receipt 必须是新 Build 的独立记录。

### 16.3 来源升级

用户选择新的 WorldRelease 时，系统先生成 rebase 报告：便携 ref 是否仍存在、事实变化、起点变化、内容/媒资
失效和成本。确认前旧 Build 继续绑定旧 WorldRelease；确认后新 Brief 使用新 hash。不得把运行中 Build 的 source
原地替换。

### 16.4 存档等级

- compatible：访问过的 stable key、规则语义和 state schema 不变；提供确定性迁移 receipt；
- restart-recommended：仅未访问区变化或可补默认；用户选择继续或重开；
- breaking：已访问 key 删除、effect 语义改变、模块/状态不兼容；旧存档固定在旧 source。

兼容判定必须同时比较 Narrative key、规则版本、初始变量 schema、产品模块和 Cue 对事件状态的影响；不能只比较
节点名称。

## 17. 多模态安全、隐私和权利

### 17.1 外发清单

每个 media request 在调用前生成机器可验清单：provider preset、数据类别、portable refs、参考图 hash、文本摘要
hash、预计费用、用途和 retention 声明。清单必须属于 Brief 允许包络；超出时暂停，不得把临时对话当作授权。

### 17.2 内容安全

- Prompt 和输出都按项目内容边界和年龄等级检查；
- 参考图先去 EXIF/定位元数据；
- 禁止未授权真实人物换脸、色情未成年人、受保护角色仿制、真人声音克隆；
- 外部模型返回的文字、文件名、元数据一律视为不可信输入；
- SVG、HTML、脚本和可执行内容默认拒绝作为图片媒资；
- 解码、转码在受限类型白名单内完成，错误不回退为任意浏览器执行。

### 17.3 rightsJson 最少字段

```ts
interface GameMediaRightsV1 {
  sourceType: 'generated' | 'imported' | 'existing-project' | 'procedural'
  providerOrAuthor: string
  modelOrTool: string
  license: string
  allowedUses: string[]
  attribution: string
  referenceHashes: string[]
  consentEvidenceRef: string | null
  generatedOrImportedAt: number
  policyVersion: string
}
```

缺字段的外部媒资不能进入 commercial release-ready。

## 18. Context / Write / Skill 登记

### 18.1 Context Source

| key | scope | 读取 | 禁止 |
|---|---|---|---|
| gameProductionConsultation | work | 当前 Production、安全会谈摘要、未决项、已选 WorldRelease 引用 | 不读 API Key、未选 Work、完整二进制 |
| gameProductionBrief | work | 当前 Brief exact JSON 和 hash | 不跟随实时世界表 |
| gameBuildInputs | work | Plan 指定 Artifact 摘要/hash、需求、预算和前驱 receipt | 不按组件自由拼上下文 |
| gameEvolutionBase | work | 父 Build/Release manifest、差异索引和兼容摘要 | 不读取未授权其它 Production |

世界事实仍通过已有 WorldRelease / worldGameAuthoring 等登记源装配；新 source 只是生产边界，不复制世界读取器。

### 18.2 AI 写入

- `game.consult-starting-points`：read-only CreativeArtifact；
- `game.compile-production-brief`：candidate-only；用户授权后由 Brief lifecycle extension 写行；
- `game.plan-production`：candidate-only；validator 通过后由 Build lifecycle extension 写 Plan；
- content/visual/audio Skill：只写 `CreativeArtifactV1` 和 build artifact extension；
- Integrator/QA：确定性写 Build manifest/report，不调用模型；
- 正式内容/媒资：只由 package adoption extension 一次提交。

所有 Skill 的 `reads/writes` 必须在 skill registry 和 AI Manual 生成物中出现。Build 状态控制、预算结算和 Blob
存储是领域服务写入，不伪装成 AI 字段。

## 19. UI 与服务边界

### 19.1 路由

```text
/workspace/:projectId/game-productions/:productionId/brief
/workspace/:projectId/game-productions/:productionId/control
/workspace/:projectId/game-productions/:productionId/builds/:buildId/preview
/workspace/:projectId/game-productions/:productionId/versions
```

### 19.2 页面必须呈现

1. 建议页：来源、优点、风险、预计规模、可改入口；
2. Brief 页：已确认/未决、主角/起点/规模/玩法/媒资/预算/外发/完成条件；
3. 控制台：Build 状态、六 lane、当前任务、预算/存储、pause/resume/stop、明确前台限制；
4. Preview：真实播放器、Build hash、降级、质量摘要、发布/演化；
5. 版本页：Brief/Build/Release 父链、差异、复用率、兼容等级、旧版启动。

UI 不显示或接受 raw Dexie ID 作为用户输入，不展示 prompt/隐藏推理，不让“保存简报”和“开始生产”共用一个不清楚
的按钮。

### 19.3 Service

```text
components → game-production/service.ts
           → consultation.ts / planner.ts / scheduler.ts
           → artifact-store.ts / media-provider-registry.ts
           → compiler.ts / quality.ts / preview-source.ts
           → adoption.ts / evolution.ts
```

组件不得 import `db.gameProductions`、`db.gameBuilds` 或媒资 adapter。所有持久化命令经过 scope、parser、CAS 和
registry-aware service。

## 20. 施工顺序 V2

### 20.1 1A：数据与合同

- schema v63 增加五张表及 SIM `gameBuildId/runtimeSourceHash`；
- PROJECT_TABLES、严格 types/parsers/hash/state machine；
- service create/save/authorize/pause/stop 的无 AI 路径；
- 完整导出导入、删除、共享 Blob GC、损坏回滚；
- feature flag 默认关闭。

完成证据：五表生命周期与 CAS 反例，不代表用户主流程已可用。

### 20.2 1B：建议/会谈/授权

- 四个 Context Source 中先上 consultation/brief；
- 起点建议和 Brief Skill；
- Brief UI、差异、unresolved gate、成本/外发/前台限制；
- authorize 创建 root Run 和空 Build，但不调用未登记 media adapter。

完成证据：未 start 时生产模型调用为 0；重复 start 不创建第二 Build。

### 20.3 1C：可玩垂直切片

- storygame + avg adapter；
- 内容 child Run + existing/import/key-art 视觉 child Run 并行；
- artifact/receipt、compiler、Preview source、一次原子发布；
- refresh/cancel/视觉 fallback/adoption rollback E2E。

### 20.4 1D～1H

- 1D：通用 DAG、并发、预算、控制台、恢复；
- 1E：真实图片 adapter、视觉 Bible/anchors/QA、OPFS；
- 1F：真实音频 adapter、BGM/ambience/SFX，语音独立治理；
- 1G：六产品 adapter、完整 QA、原子发布和商业 Golden Project；
- 1H：三轮演化、rebase、carried-forward、存档兼容和旧版本回归。

任何阶段不得用 placeholder adapter 的通过冒充下一阶段真实 provider 能力。

## 21. V2 验收与进入反向评审的条件

V2 只有在以下问题都有明确答案时才算“方案闭合”，仍不代表代码完成：

- 表、索引、owner、refs、import/remap、删除和共享 Blob GC 是否无歧义；
- 所有用户命令是否有前置、CAS、幂等和失败结果；
- Build Preview 是否不写 GameRelease 也能走同一 reducer/player；
- 单 parent Run 和多依赖 DAG 是否不再冲突；
- 文本 AI、图片/音频 provider、导入和 fallback 是否分层；
- 原子发布是否明确绕开当前三段式非原子路径；
- 六产品适配器是否能复用已有发布验证；
- 商业门是否有数值、测量和 waiver 边界；
- 演化是否有 source rebase、reuseKey、CAS 和存档等级；
- 三注册表和旧入口收口是否有施工位置与测试。

下一份文档必须从失败角度评审本版：事务可行性、Dexie/OPFS 原子边界、索引和循环 refs、Run 恢复、浏览器
限制、媒体 provider 可得性、测试成本、旧数据兼容和用户是否真的只需在关键时点介入。评审发现的问题必须进入
V3 决策，不得只写“后续注意”。
