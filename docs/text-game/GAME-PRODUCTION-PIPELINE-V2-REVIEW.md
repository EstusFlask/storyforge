# GAME-PROD-1 · V2 反向评审

> 评审对象：[`GAME-PRODUCTION-PIPELINE-DESIGN-V2.md`](./GAME-PRODUCTION-PIPELINE-DESIGN-V2.md)
>
> 评审日期：2026-08-21
>
> 结论：`V2 不能直接施工；方向闭合，但仍有 6 个 P0、9 个 P1。全部必须在 V3 改成明确合同。`

## 0. 评审方法

本评审不检查“文档是否写得完整”，而是把 V2 当成已经实现，逐个尝试让它失败：

1. 从一个不包含新游戏内容的既有 WorldRelease 开始生产和发布；
2. 不写 GameRelease，直接启动带 Build 图片/音频的 Preview；
3. 同一用户命令在刷新、多标签页和后续命令之后重放；
4. 图片调用期间暂停/停止，再接收迟到响应；
5. 大文件写 OPFS，同时在 Dexie 事务里正式采用；
6. 导出到另一浏览器，原本的 localStorage provider preset 不存在；
7. 删除父 Build，但子 Build 复用了 Blob/Artifact；
8. 从 Release 连续演化三轮，再升级 WorldRelease；
9. 在第一个正式 Blob 写入后故意让发布失败；
10. 对六种产品分别生成 package、预览、发布和恢复存档。

评审证据来自当前实现，而不是 V2 的意图：

- `src/lib/text-game/releases.ts`：GameRelease v1 冻结逻辑；
- `src/lib/text-game/authoring.ts`：现有三段式 STORYGAME 发布；
- `src/lib/simulation/runtime.ts`：正式会话只接受 GameRelease；
- `src/lib/avg/media.ts`：玩家按正式 AVG 表读取二进制；
- `src/lib/avg/authoring.ts`：Blob→ArrayBuffer→IndexedDB 的正式媒资路径；
- `src/lib/types/agent-run.ts` 和 `src/lib/agent/run/master-durable.ts`：单 parent lineage 与多依赖 Plan；
- 三注册表和 DB v62 schema。

## 1. 总体结论

V2 已经解决了 V1 的大部分“描述性歧义”，尤其是用户命令、Build/Artifact 状态、DAG 与父子树分离、质量阈值
和外发治理。但它仍错误地假设了三个当前并不存在的基础能力：

1. 既有 WorldRelease 可以直接承载后来生产的新游戏；
2. Build Preview 只要有 release-shaped JSON 就能加载二进制；
3. OPFS Blob 能和当前 ArrayBuffer 正式媒资在一个 Dexie 事务里自然衔接。

这三点如果不先修，后续 UI、调度器和 Agent 都会建立在错误的发布边界上。V3 必须先设计共享运行包、Release v2、
Build 媒资解析和统一物理 Blob 层，再安排表和施工顺序。

## 2. P0 阻断项

### P0-01 · 既有 WorldRelease 无法按 V2 直接发布新游戏

**失败推演**

1. 用户选择已发布世界 A；该 WorldRelease 只包含当时的世界和已有叙事；
2. Production 生成全新的 GameDefinition、Narrative、AVG media；
3. V2 adopter 把这些内容写入正式表，然后调用当前 `publishGameDefinition()`；
4. 当前 `buildGameReleaseManifest()` 从 WorldRelease 的 `records.gameDefinitions / narrative / avgMedia` 查找新游戏；
5. WorldRelease A 是不可变的，当然找不到刚写入的内容，发布失败。

当前 `publishStoryGameDraft()` 之所以能成功，是因为它先创建新的 WorldRevision 和 WorldRelease，再发布游戏。V2
决定“不制造新世界修订”是正确产品方向，但没有给当前发布器提供替代冻结来源。

**V3 必须裁决**

- 引入 `GameRuntimePackageV2`，游戏内容从已采用的正式游戏表或 Build Artifact 冻结；
- `GameReleaseManifestV2` 单独绑定 source WorldRelease hash，不要求游戏内容预先存在于 WorldRelease package；
- parser/player 同时支持 Release v1/v2，旧 Release 不迁移、不重写；
- 当前 `publishGameDefinition()` 继续服务 v1 手工路径或改为 wrapper；生产 adopter 调用 v2 in-transaction freezer；
- 新游戏发布不创建无意义的新 WorldRevision，除非用户明确同时发布世界 Canon。

### P0-02 · Preview 缺少 Build 媒资二进制解析器

V2 给 Preview 加了 release-shaped `gamePackage`，但当前 AVG player 最终通过 `avgMediaAssets` 和
`avgMediaBlobs` 的正式版本读取二进制。Build 图片在 Artifact/Blob Store，只有 metadata 不能显示。

**V3 必须裁决**

- `ResolvedPlayableGamePackageV2` 必须同时包含 manifest 和 `GameMediaResolverV1`；
- Release resolver 按正式 media link 读取；Build resolver 按 accepted artifact binding + blobObjectId 读取；
- 两者都校验 contentHash/size/mime，输出同样的 object URL catalog；
- Player 只消费 resolver 结果，不直接查询 `avgMediaBlobs`；
- object URL 在会话/组件销毁时统一 revoke；
- 缺 optional 媒资走 manifest fallback，required 缺失阻断 Preview ready。

### P0-03 · `lastCommandId` 不能证明命令幂等

V2 的 Production 只保留一个 `lastCommandId`。以下序列会失败：

```text
start(cmd-A) → pause(cmd-B) → 浏览器重放 start(cmd-A)
```

此时 lastCommandId 是 B，系统无法证明 A 已执行，可能创建第二 Build。多标签页、离线重放和发布重试同样会破坏。

**V3 必须裁决**

- 新增 `gameProductionCommands`，唯一键 `[productionId+commandId]`；
- 记录 command type、payloadHash、expected revision、result status、result refs/hash、created/completedAt；
- 相同 commandId + 不同 payloadHash 硬拒绝；
- 命令在同一事务先 claim，再 CAS 业务状态，完成后写 receipt；
- `lastCommandId` 可保留为 UI 提示，但不再承担幂等权威；
- 因此 V1/V2 的“五张最小表”必须修正为六张生产表，不能为保持数字而牺牲正确性。

### P0-04 · OPFS 与当前正式 Blob 无法原子采用

OPFS 不属于 IndexedDB 事务。V2 的“一个 Dexie transaction 内读 Build Blob，再写 `avgMediaBlobs.data`”有三类问题：

- 普通 OPFS await 会使 Dexie 事务提前关闭，除非受控 `Dexie.waitFor`；
- 大文件读成 ArrayBuffer 复制会放大峰值内存；
- OPFS 文件写/删与 Dexie commit 不能真正原子回滚。

**V3 必须裁决**

- 不再新增只服务 Build 的物理 Blob 表；新增 Work-owned `mediaBlobObjects`，Build Artifact 和正式 AvgMediaBlob link
  都引用同一个 content-addressed object；
- `avgMediaBlobs` 增加 `blobObjectId`，保留 legacy `data` 读取；新写入不复制大二进制；
- v62 旧 ArrayBuffer 媒资采用 lazy migration：读时兼容，显式迁移时写 object 并原子改 link；
- OPFS 写入采用可恢复两阶段，Dexie 只原子提交 metadata/link；物理孤儿由 GC receipt 清理；
- 发布事务只绑定已经 ready/pinned 的 blobObjectId，不在事务里做网络、转码或大文件读取；
- 如果 V3 不接受共享物理层，则第一阶段只能诚实限制为 IndexedDB internal，不得称商业 Blob 闭环。

### P0-05 · V2 的运行包仍被 `AnyGameReleaseManifestV1` 和三产品 source 类型限制

`WorldGameSourceSelectionV1` 只允许 storygame/text-adventure/avg。V2 虽然写了 `WorldGameSourceSelectionV2`，却没
定义它，也仍把 package 类型写成 `AnyGameReleaseManifestV1`。六产品 adapter 无法把统一来源、生产和兼容信息
带进 release。

**V3 必须裁决**

- 定义全产品 `WorldGameSourceSelectionV2`：公共 portable refs + product-specific selection；
- 定义 `GameRuntimePackageV2`，将 definition/world source/narrative/product modules/presentation 分离；
- 定义 `GameReleaseManifestV2 { sourceWorldRelease, package, productionProvenance }`；
- `parseAnyGameReleaseManifest()` 升级为 v1/v2 union；
- v1 player adapter 投影为同一 resolved package；
- release contentHash 计算规则版本化，不能拿 v1/v2 hash 混比。

### P0-06 · “真实图片/音频 adapter”仍不是可交付项

V2 说“至少一个真实 adapter”，但没有确定 adapter API 方言、认证来源、响应格式、取消、费用和测试夹具。尤其
“OpenAI-compatible image”并不是 chat-compatible provider 的共同能力，Agnes 的文本 Key 成功也不证明能生图或
生成音乐。音频部分只有程序化 fallback，不能满足 commercial music/sfx。

**V3 必须裁决**

- provider capability 必须由显式 adapter id 声明，不能由 `AIProvider` 名称推断；
- core 交付 deterministic fixture adapter、existing/import adapter 和程序化 non-commercial fallback；
- 至少选择并按官方 API 实现一个真实图片 adapter、一个真实音乐/SFX adapter；语音另立受治理 adapter；
- 每个 adapter 有合同测试、录制 fixture、费用 unknown 反例、取消/迟到响应测试和内容安全；
- 没配置真实 adapter 时 UI 必须把对应 commercial profile 标为 blocked，但这不阻断合同、调度和已有媒资路径施工；
- 最终商业验收必须使用真实配置跑一次隔离 Golden Project，不能只用 mock。

## 3. P1 高风险项

### P1-01 · Build 与 root Run 生命周期没有索引关联

Build 只保存 `rootRunId`。删除 Production/Build 时，通用 refs 无法从 Production 找到 AgentRun；导入后也难以按
Build 查询全部运行。V3 应给 `AgentRunRecord` 增加可选 `gameBuildId` 索引，或定义唯一领域删除器完整遍历
rootRunId 子树。推荐增加 `gameBuildId`，同时保持 Run owner 为 Work/Instance，不创造第三 owner。

### P1-02 · 当前指针与子表形成循环 refs

Production.currentBrief/currentBuild 指向子行，Production 删除又级联子行。通用 lifecycle 的处理顺序必须有测试。
V3 应规定：current 指针是 soft ref，删除子行 setNull；删除 Production 的领域入口先清指针，再按拓扑删子行；
项目整体删除仍由 PROJECT_TABLES 完成。

### P1-03 · localStorage presetId 不是便携身份

Brief 保存 `allowedProviderPresetIds` 后，导出到另一浏览器会变成悬空 ID。V3 应保存无密钥的
`ProviderCapabilityRequirementV1`（provider family、adapter、model/capability hash、数据类别），presetId 只作为本机
resolution hint。恢复时重新选择本机预设并生成 binding receipt。

### P1-04 · 会谈调用与“未开始零调用”口径容易误导

起点建议和 Brief 编译本身可以调用文本模型，用户说“我想做游戏”就是对会谈分析的授权；但它不等于生产授权。
V3 必须分别统计 consultation budget 与 production budget，并把“未开始零生产调用”写清楚，不能声称完全零模型调用。

### P1-05 · 多标签页 CAS 需要真正的事务 claim

仅比较 `stateRevision` 不足以防两个标签页同时读相同 revision 后各自写入。V3 service 必须在同一 Dexie transaction
读取 Production、claim command unique key、比较 revision 并更新。可使用 BroadcastChannel 提醒 UI，但它不是锁。

### P1-06 · Quality 门有指标但没有测量器归属

LUFS、true peak、图片尺寸、alpha、长时内存、语义一致性和角色相似性需要不同工具。V3 应为每个 gate 指定：

- verifier id/version；
- deterministic / provider-review / human-evidence；
- 输入 hash；
- 输出 receipt schema；
- 不支持的平台是 fail、skip 还是 needs-human；
- 阈值版本变更如何使 receipt stale。

### P1-07 · 角色/场景一致性不能只靠“硬门”措辞

自动相似性可能误判，文本 reviewer 也不能看到二进制。V3 应分离技术硬门、结构化 anchor rule、可选视觉 verifier
和人类审美抽查。commercial 的人物身份冲突是 hard，纯审美评分是 soft/human，不得把不可靠模型分数包装为确定性。

### P1-08 · `gamePackageHash === release.contentHash` 的语义未版本化

当前 GameRelease hash 是整个 manifest hash。V2 同时使用 gamePackageHash、previewHash、Build manifestHash，但没有
规定 canonicalization version 和包含范围。V3 必须定义：packageHash、previewHash、buildManifestHash、releaseHash
分别覆盖什么，哪些必须相等，哪些只互相引用。

### P1-09 · 正式发布时 `GameDefinition` 和世界来源的关系需重构

V2 adopter写正式表后生成 v2 Release，但现有 `GameDefinition.sourceSelectionJson` 仍是 V1 三产品类型。V3 需要升级
GameDefinition source mapping version/selection parser，同时保持旧 definition 可编辑。不能只改 release manifest。

## 4. 桌面推演结果

| 场景 | V2 结果 | 结论 | V3 修正 |
|---|---|---|---|
| 既有世界首次生成新 AVG 并发布 | 当前发布器在 WorldRelease 中找不到新游戏 | 失败/P0 | Release v2 直接冻结游戏表，source world 单独绑定 |
| Build Preview 显示新背景 | player 去正式 avgMedia 表查，不认识 Build Blob | 失败/P0 | source-specific media resolver |
| start A、pause B、重放 start A | lastCommandId 只能看到 B | 可能重复 Build/P0 | durable command table |
| 图片请求中 stop，响应随后返回 | controlEpoch 可隔离 | 设计可行 | 事务写 Artifact 前强制 CAS + orphan event |
| OPFS 300MB 资产发布 | 事务/内存/复制不闭合 | 失败/P0 | shared mediaBlobObjects + pinned link |
| 另一浏览器导入 Build | presetId 不存在 | 可恢复但 V2 未定义 | capability requirement + local rebind receipt |
| 删除父 Build，子 Build 共用 Blob | content-addressed Blob 方向正确 | 部分可行 | shared object ref scan + GC receipt |
| 发布第 3 步失败 | Dexie 正式行可回滚；OPFS 不可 | 部分失败 | 所有物理 Blob 在发布前 ready/pinned，事务只写 link/metadata |
| 世界来源升级后继续旧 Build | epoch/CAS 可阻止原地换源 | 可行 | rebase 只创建新 Brief/Build |
| 六产品统一 package | V1 source/manifest 类型阻断 | 失败/P0 | RuntimePackage/Release v2 union |

## 5. V3 强制决策清单

以下不是“建议”，而是 V3 必须落成的施工合同：

1. 新增 `GameRuntimePackageV2`、`GameReleaseManifestV2` 和 v1→resolved adapter；
2. Preview/Release 都通过 `PlayableGameSource` + `GameMediaResolver` 进入同一 player/runtime；
3. 新增第六张生产表 `gameProductionCommands`；
4. 把 `gameBuildArtifactBlobs` 改为共享 `mediaBlobObjects`，正式/构建媒资使用同一物理对象；
5. `avgMediaBlobs` 增加 `blobObjectId` 并保留 legacy data 兼容；
6. Build/Run 增加可查询关联，删除和导入可证明闭合；
7. Brief 不持久化不可便携的 presetId 作为权威，只保存 capability requirement；
8. provider adapter 明确到真实 API 方言和官方合同，图片、音频、语音分开；
9. 所有 hash 指定 canonicalization version 和覆盖范围；
10. 每个 QA gate 指定 verifier/receipt/平台降级；
11. GameDefinition source selection 升级到 V2，六产品一致；
12. 发布事务只做已准备完成的本地绑定和冻结，禁止网络、转码、OPFS 大读写；
13. consultation 与 production 预算、授权和 Run 证据分开；
14. 多标签页命令 claim 必须靠 IndexedDB 唯一索引 + transaction CAS；
15. V3 实施顺序先打通 RuntimePackage/Blob/Release 地基，再做 UI 和 Agent，避免重做。

## 6. V2 的保留项

以下设计通过评审，可原样或小幅修订进入 V3：

- 用户只在意愿/简报/开始/超范围阻塞/发布/演化介入；
- `stateRevision + controlEpoch`；
- Production/Build/Artifact 分层状态；
- 父子 Run 表所有权、多前驱依赖归 Plan/receipt；
- `requirementKey` 和 stable artifact key；
- deterministic compiler、模型不参与最终绑定；
- Build immutability、迟到结果 orphan；
- reuseKey、carried-forward receipt、source rebase 新建 Build；
- 三档 QA、数值阈值和 waiver 限制；
- 外发清单、rightsJson、禁止 Key 进入项目数据；
- 六产品 adapter 顶层边界；
- feature flag、旧入口收口和真实浏览器 Golden Project。

## 7. 评审裁决

V2 已达到“可以暴露真实架构冲突”的价值，但没有达到“施工人员无需再次做基础架构决策”的标准。V3 必须把
上述 P0/P1 全部转成：

- 精确类型与 parser 版本；
- schema/迁移顺序；
- registry 行；
- service 唯一入口；
- transaction/两阶段边界；
- 失败和恢复；
- 定向测试与真实 E2E；
- 阶段完成证据。

只有 V3 通过逐项覆盖矩阵后，才开始 1A 代码施工。
