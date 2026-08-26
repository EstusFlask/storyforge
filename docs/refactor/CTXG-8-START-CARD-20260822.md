# CTXG-8 开工卡：Provider 缓存失效与百万字检索门

## 任务与完成边界

- 任务 ID：`CTXG-8`
- 基线：`59c5e638 feat(CTXG-7): connect bounded context gateway execution`
- 分支：`refactor/world-engine-harness`
- 目标：在不改变 `ContextResourceProviderV1` 调用合同、不新增权威表的前提下，为目录与定点读取建立按 scope/provider/content/policy 身份缓存；任何数据库写入实时失效，失效可靠性未知时回到 Provider 实时读取；大正文搜索复用现有检索块、层级摘要和章节边界一致性档案作为候选定位，最终证据仍回到 Canon/source ref。
- 非范围：本单元不切换业务字段、不调用创作模型、不持久化 embedding 或新目录表；如果实测内存目录不能达到阶段性能门，才另立经过 `PROJECT_TABLES` 生命周期审查的可重建索引任务。

## 重新审计结论

1. Canon Provider 的返回页只含 descriptor，没有 body 字段；但重复分页仍会重新投影和计算正文 hash，当前没有跨 Gateway session 的缓存。
2. `retrievalChunks` 与 `narrativeSummaryNodes` 已登记为 `derived-none` 可重建缓存，章节块带 `sourceTextHash`，摘要带 `sourceHash/status`；它们可以排序候选，不能决定 authority、scope 或事实真伪。
3. `consistencyDossier` 已能在章节边界聚合结构化事实、检索块和 source ref，并明确 embedding 非权威；Gateway 大正文检索应复用该边界能力，而不是复制第二套事实判断。
4. Canon、采纳、store、导入和迁移存在大量合法写入口，逐个手工添加失效调用容易漏。Dexie 4 的全局 `storagemutated` 事件覆盖当前标签页和其它标签页，适合作为统一 fail-closed 失效边界。
5. Provider 的 `fingerprint()` 当前是冻结 scope 身份，不能混入数据版本，否则同一 session 内 Provider scope 会随写入漂移并破坏 V3 语义。数据版本必须属于缓存条目，不得偷换 scope fingerprint。

## 三注册表与关联闭包

- 读：业务调用方继续只依赖 `CONTEXT_SOURCES.resources -> ContextResourceProviderV1`；derived memory 只产生候选 id，实际 descriptor/read 仍由 Canon Provider 返回。
- 写：缓存只存在内存，不写任何 IndexedDB 表；所有项目表写入统一触发缓存 epoch 失效。
- 表：不新增表；`retrievalChunks` / `narrativeSummaryNodes` 继续由 `PROJECT_TABLES` 标记为可重建、非权威、不可导出。
- 调用方：`CANON_RESOURCE_PROVIDER_V1` 变为同合同透明缓存包装；底层 Provider 可替换，Gateway/Skill/工具无需修改。
- 证据：缓存命中不改变 descriptor、source ref、Trace、Packet 或 Manifest hash；旧值发生变化后必须重新读取并由既有 freshness 门拒绝旧候选。

## 施工顺序

1. 实现通用 Provider V1 内存缓存：scope + providerVersion + normalizationVersion + 请求形成定位键，缓存实体键再包含返回 descriptor 的 contentHash/policyHash。
2. 接入 Dexie `storagemutated` 全局失效；提供显式失效、可靠性降级和诊断计数。可靠性不确定时禁止命中缓存。
3. 将 Canon Provider 以透明包装方式挂回原注册点，保留未缓存 Provider 供测试和故障回退，不改变调用方合同。
4. 实现大正文候选规划：有效 retrieval chunks、verified summary nodes 与有章节边界时的 consistency dossier 只做候选定位；坏/缺索引对应章节回退 Canon body 搜索。
5. 增加百万字 fixture、晚位命中、缓存命中、跨 scope、直接 DB 写失效、坏索引回退、provider 可替换和 metadata 无 body 反例。
6. 增加架构守卫、文档与完成卡，执行 Phase 1A 全部定向回归和静态/类型/构建门。

## 验收与停止条件

- 同一 scope/版本/内容/策略的目录与 read 可复用；任意项目表写入后旧条目不可达，直接 DB 写、采纳路径和跨标签页事件采用同一机制。
- 缓存事件订阅异常、手动标记不可靠或缓存结构损坏时，直接调用实时 Provider；不得用“尽力而为”返回已知旧值。
- `listMetadata` 返回体不含正文；百万字正文只有显式 read 或检索索引坏后的精确 fallback 才进入 body 路径。
- chunks/summary/dossier 命中只能提高候选优先级；stale hash、stale status、越 scope 行或 embedding 相似度均不能成为 Canon 证据。
- Provider 后端替换后，调用者仍只使用 `ContextResourceProviderV1`；本单元不新增平行 catalog/cache 数据表。
