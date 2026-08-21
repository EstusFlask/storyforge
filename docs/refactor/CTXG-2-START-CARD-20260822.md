# CTXG-2 开工卡：稳定资源身份、纯目录与 exact artifact 生命周期

## 任务与完成边界

- 任务 ID：`CTXG-2`
- 基线：`3b8587a6`（`CTXG-1` 已签收）
- 分支：`refactor/world-engine-harness`
- 目标：让 Context Gateway 的资源引用不再依赖本机 Dexie 自增 ID，让目录构建严格只读，并为 Run 的 context packet、source snapshot、rendered request、raw response、tool result 建立内容寻址、逐字可验证的唯一物理证据仓。
- 非范围：本单元不补齐所有领域 Descriptor，不开放四个 Agent 读取工具，不切换正式生成入口，也不声称百万字能力已经成立。

## 关联闭包

- 入口与调用方：`buildRagLibrary()`、RAG 策略更新、`stampNewRecord()`、项目导出/导入/删除、Agent Run event/settlement/index。
- 读：资源正文仍从 `PROJECT_TABLES` 登记的 Canon 表实时读取；exact artifact 只由明确的 Run artifact API 按 hash 读取。
- 写：资源 UID 只在新建/采纳边界或显式 backfill 写入；目录读取零写。artifact 正文先入内容寻址表，再在同一事务追加 `evidence.artifact.recorded`。
- 表：新增 `agentRunArtifacts` 并登记 `PROJECT_TABLES`；schema 升级、导出/导入、项目删除、Run 删除后的 mark-and-sweep、显式 prune tombstone 全部测试。
- 注册表：资源身份能力作为 `TableSpec.resourceIdentity` 扩展，从 `PROJECT_TABLES` 派生，不建立第四张表清单。

## 已确认的旧问题

1. `buildRagLibrary()` 在读取时给缺少 `ragDocumentId` 的行执行 `update()`，目录不是纯函数。
2. 旧 fallback `rag:<table>:<projectId>:<row.id>` 把本机物理 ID 当成可移植身份，导入重映射后无法保证稳定。
3. `ragPolicy` 没有独立 revision/hash，策略变化与 Canon 内容 revision 无法区分。
4. `evidence.artifact.recorded` 只有 hash/长度引用，没有可逐字回读的正文表；当前 Memory Index 只能证明“曾声明过引用”，不能证明正文仍可用。
5. exact artifact 的去重、导入导出、Run 清理、显式裁剪、prune receipt 和敏感内容拒绝尚未落到同一物理生命周期。

## 施工顺序

1. 先加失败反例：目录二次构建零变化、缺 UID 明确诊断、backfill 中断回滚、策略 revision/hash 独立。
2. 在 `PROJECT_TABLES` 登记资源身份能力；`stampNewRecord()` 自动赋予新资源 UID；实现显式、全事务、幂等 backfill。
3. 删除 RAG 读取路径的 fallback/write，策略更新只使用已存在 UID，并维护独立 policy revision/hash。
4. schema 升级并登记 `agentRunArtifacts`；实现安全校验、内容 hash/byte length、同项目同 kind/hash 去重、原文完整性读取。
5. 将正文落库与 `evidence.artifact.recorded` 置于同一 Run mutation/DB transaction；实现 mark-and-sweep 与显式 `evidence-pruned` tombstone。
6. 扩展 Memory Index 的 artifact availability，覆盖导入导出、项目删除、单 Run 删除和损坏正文反例。
7. 跑定向测试、全架构检查、TypeScript、build；Phase 1A 门在 `CTXG-8` 后统一跑全 CI/E2E。

## 验收与停止条件

- 同一项目连续两次 build catalog，所有业务表内容、时间戳、revision 与 UID 均零变化。
- 新资源 UID 与 Dexie numeric ID、项目 ID 解耦；导出再导入后 resource key 不变。
- backfill 失败全部回滚；重复运行不改已有 UID。
- policy revision/hash 只随 policy 改变，身份补全不冒充 Canon 编辑。
- exact artifact 可按 kind/hash 逐字读取并重算 hash/byte length；同内容只存一份。
- body 写入失败时 ledger 引用为 0；event 写入失败时新 body 回滚；敏感内容与隐藏推理入库为 0。
- Run 删除只回收无引用正文；显式裁剪留下可验证 tombstone，Memory Index 可显示 `available/missing/evidence-pruned`。
- 任一迁移、导入、删除、scope 或完整性反例失败即停止扩大。
