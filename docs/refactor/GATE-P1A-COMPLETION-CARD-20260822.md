# GATE-P1A 完成卡：Context Gateway Phase 1A 总验收

## 结论

- 任务：`GATE-P1A`
- 状态：通过；Phase 1A 完成，允许进入 Phase 1B 的 `RACE-1`。
- 基线：`52fa227f feat(CTXG-8): cache and retrieve long-form context`
- 发布边界：本门仍未把任何正式业务字段从 `shadow` 提升为 `required`，也没有产生创作模型调用或业务候选写入。

## 总门实现与审计结果

1. 新增机器可执行 shadow read：在同一冻结 Workspace/WorldGroup 上比较旧 `assembleContext()` 与 Context Gateway 的实际选源，只返回内存报告。
2. 报告冻结旧来源证据、新 Gateway selected/omitted/source refs、充分性、packet/trace/report hash 与差异 reason code；读取期间 Canon 漂移会使本次比较失效。
3. shadow 入口强制要求 Skill rollout 为 `shadow`；不得借此形成第二条正式执行、候选或采纳路径，规划模型调用和工具追加调用均固定为 0。
4. 数据库全表前后 hash 相同；同项目跨 WorldGroup、跨 Project/Work 的资源均不能进入当前选集。
5. Workspace 侧栏跳转与返回首页在切换前统一等待 `PendingEditCoordinator`，保存失败时阻止导航并给作者可见反馈，确保新读取视图不越过未落库编辑。
6. 阶段总门发现并修复两处真实历史回归：无名称主世界观的资料标题退化为“世界观世界观”；复制角色驱动方案继承旧 `ragDocumentId`，刷新时被统一资源身份回填器拒绝。修复后主世界观标题恢复，新方案获得独立 portable UID。

## 回归与真实浏览器证据

- `R-GATE-P1A-shadow-read`：5/5，通过零副作用、非 shadow 拒绝、导航 flush、首次 Canon 行失效刷新、复制资源身份唯一性。
- `R-CTXG3-canon-resource-provider`：6/6，通过六领域、分页、原文回读、旧 RAG bridge 与 scope 生命周期。
- 完整 `npm run ci`：457 files / 2174 tests 全部通过；覆盖率 83.23% statements、73.76% branches；83 张表、32 bindings / 35 AI calls、768 个可达源文件；依赖审计 0 漏洞。
- production build：3968 modules；entry 674.6 KiB / 201.4 KiB gzip；最大 async/vendor 490.8 / 128.1 KiB gzip，bundle 门通过。
- 独立端口 `4197`、独立浏览器数据运行 `npm run ci:e2e`：53/53 通过，覆盖世界/作品隔离、资料检索、候选恢复、拒绝/采纳、角色方案复制、世界观/故事/角色/故事线/大纲/正文/Codex、多世界和本地记忆工作区。
- 作者现有 `4178` 预览项目及其 IndexedDB 未被修改。

## Phase 1A 能力边界

- 已证明 Context Gateway 底座具备纯读取目录、portable resource identity、Canon descriptors、四只读工具、确定性预选与充分性、Manifest V3/Trace/exact evidence、快慢路径、全局缓存失效和长正文 Canon fallback。
- CTXG-8 的百万字符夹具只证明 metadata/body 分离、晚位检索、坏索引回退和性能基线，不等同于“百万字创作一致性已经通过”；该声明仍必须等待 Phase 4 的 sealed eval。
- 下一步只能把 `worldviews.races` 作为单字段 canary。金切片通过前，其它字段不得批量切换到 Gateway required。
