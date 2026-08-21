# CTXG-8 完成卡：Provider 缓存失效与百万字检索门

## 结论

- 任务：`CTXG-8`
- 状态：完成，允许进入 `GATE-P1A`；本卡不宣称 Phase 1A 总门已经通过，也不宣称任何业务字段已经正式切换。
- 基线：`59c5e638 feat(CTXG-7): connect bounded context gateway execution`
- 数据结构：未新增 IndexedDB 表、未改 schema；缓存为可全部丢弃的内存投影。

## 已完成的合同与运行边界

1. 新增透明 `ContextResourceProviderV1` 缓存包装器。调用方仍只依赖既有 Provider 合同；底层 Canon Provider 可替换，`CONTEXT_SOURCES`、Gateway 工具和 Skill 无需知道缓存实现。
2. 请求定位键包含冻结 scope、provider id/version、normalization version、operation 和完整请求；实体键追加 descriptor 的 content revision/hash、policy revision/hash 以及 read content hash。
3. Dexie 4 全局 `storagemutated` 作为统一失效边界，覆盖直接 store/adopt/导入/迁移写入和其它标签页提交。任何 StoryForge 写入都会推进 cache epoch 并清空 disposable entries；不维护容易漏项的手写 store 清单。
4. Provider 请求开始与结束比较 epoch；写入与慢读取并发时不缓存旧结果。目录 cursor 的 request hash 也绑定当时 epoch，Canon 在翻页间变化后旧 cursor 会 fail closed，要求从第一页重读。
5. 缓存内部出现 dangling locator、clone/store 异常或显式标记失效可靠性未知时，所有命中关闭并直接调用实时 Provider；scope fingerprint 仍只表示冻结 Workspace，不冒充数据 revision。
6. Canon Provider 升级为 v2：`listMetadata` 始终只返回 descriptor；显式 search 复用现有 `retrievalChunks`、`narrativeSummaryNodes` 与有章节边界时的 `consistencyDossier` 产生候选行。
7. 检索块必须以 `sourceTextHash` 回查当前章节全文 hash，chapter 摘要必须为 `verified` 且 `sourceHash` 当前；stale/missing index 对应章节只回退 Canon body 搜索。embedding 字段不参与 authority、scope、freshness 或事实判断。
8. 所有 derived hint 最终都只匹配 source table/record id；进入 Context Packet 前仍由 Canon Provider 重新生成 descriptor/source refs，并继续接受 CTXG-3～7 的 scope、policy、Trace、V3 freshness 和采纳门。

## 关键反例与性能证据

- 同请求重复 list/read：底层各执行一次；返回副本被调用方修改不会污染缓存。
- 显式失效后相同 locator 返回新 content/hash；换 Provider 后端仍通过相同 V1 合同返回。
- 缓存可靠性被标记 uncertain：连续两次读取均访问实时 Provider，旧缓存命中为 0。
- 直接 `db.worldviews.update()`：已缓存 races 读取立即返回新事实，不含旧事实；内容 hash 改变；写前 cursor 在写后被拒绝。
- 百万字 fixture：单章正文超过 1,000,000 字符，首轮 metadata/search/derived-memory 联测约 `0.4s`；第二次 metadata 缓存命中低于 `250ms`；返回 metadata JSON 小于 `50KB` 且不含晚位正文标记或 body/content/original 字段。
- 晚位词只存在于最后检索块时可定位章节；verified summary 可产生章节候选；章节边界 dossier 提供 current source refs。
- 正文修改但 chunk 未重建：计划状态变为 `degraded`，旧 chunk 不再命中；新晚位词通过 Canon fallback 找到，返回页不泄漏旧标记。

## 回归与门禁证据

- `R-CTXG1～8`、MEMINT 与项目生命周期：10 files / 58 tests 通过。
- `R-CTXG8-provider-cache-large-retrieval`：4/4 通过；`R-CTXG3` 联测：6/6 通过。
- required tables：83；AI entry：32 bindings / 35 calls；source reachability：767 files；roadmap、agent context、agent freshness、Canon coverage、project metrics 全部通过。
- `npm run check:architecture`：通过，新增架构守卫 `㉙`，覆盖透明 Provider、全局失效、fail-closed、derived-memory 不升权和 Canon fallback。
- `npm run lint`、`npx tsc --noEmit`、`npm run build`、`npm run check:bundle-size`、`git diff --check` 通过。
- production build：3968 modules；entry 674.5 KiB / 201.3 KiB gzip，低于 700 / 230 KiB 预算；最大 async/vendor 490.8 / 128.1 KiB gzip。
- 本单元未调用真实创作 API、未修改业务 UI，也未触碰作者当前 4178 预览项目。

## 后续边界

- `GATE-P1A` 运行完整 `npm run ci`、适用 E2E、隔离浏览器和 shadow read 新旧选源比较；只有总门通过，才把 Phase 1A 标记完成。
- Phase 1B `RACE-1～6` 才把“种族与民族”作为第一个正式字段接入 Gateway required、候选/刷新/采纳/拒绝/stale 和真实 API 质量评测。
- 当前没有持久化 catalog/index table。百万字单章与大目录门若在真实浏览器规模基准失败，才另立可重建、非权威、完整登记 `PROJECT_TABLES` 生命周期的索引任务。
