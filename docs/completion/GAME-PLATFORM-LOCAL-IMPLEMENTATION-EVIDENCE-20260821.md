# 游戏平台本地实施与验收证据 · 2026-08-21

> 状态：`LOCAL IMPLEMENTATION COMPLETE / DEPLOYMENT EVIDENCE PENDING`
>
> 本文证明当前仓库内可独立交付的产品、合同、数据生命周期和浏览器主路径已经闭合；它不把尚未部署的
> 多账号服务、真实支付、真实供应商媒资或外部用户试用冒充为商业 GA。

## 1. 已闭合的本地产品范围

- 世界出口：不可变 `WorldRevision / WorldRelease / PlayableWorldBundle`，严格便携 ID、来源选择、哈希、差异、
  导入重映射和删除保留边界完整。
- 统一生产：会谈、冻结素材白名单、严格 Brief、作者授权、durable DAG、能力绑定、文本/图像/音频适配器、
  Blob、Build Preview、质量回执、原子 GameRelease、多轮增量演化和暂停/恢复/停止完整。
- TTRPG：正式 RulePack、CampaignPack、Session Zero、角色创建、场景/线索/遭遇/规则行动/资源/状态/成长、
  玩家/GM 信息投影、安全工具、桌面状态、会后续接和确定性回放完整。
- 可信 AI GM：只读 Context、durable 候选、规则工具证据、真人确认、秘密/状态核验、一次有限修复、确定性降级、
  长局有界记忆、评测报告签名和 Beta gate 完整。
- 在线边界：服务端权威房间合同、身份/角色/GM 权限、幂等命令、可验证骰点、断线重连、客户端恢复、实时 Hub、
  HTTP/WebSocket 浏览器适配器和灾备快照完整；在线、社区、商业与运营现已进入统一 Web-standard 托管组合根，
  生产依赖缺失时统一 fail-closed。生产组合现已强制十一项 external 活探针、动态健康摘除、逐请求租约权威、
  可轮换 webhook secret provider 和可注入的保留式跨实例游标 fanout；仅写 `configured` 不能伪装就绪。
- 桌面表现：单机与在线房间共享观看者安全投影的可视网格、区域、token、距离、迷雾和图层；玩家只能移动绑定角色，
  观战席无控制权，GM 隐藏区域与标题不会先下发再靠样式遮挡。
- 六类文字游戏：分支互动、角色互动、文字冒险、AVG、叙事模拟、文字开放世界均使用同一冻结世界、生产、发布、
  SIM 事件与存档合同，同时保留各自玩法内核、作者工作台和玩家体验。
- 社区与商业边界：分发包、市场交付、评论审核、社交/LFG、治理、运营、服务路由、限流、订单/退款/结算、税务/
  发票/创作者付款协调，以及 data-only Creator SDK 的签名、信任清单、撤销、依赖锁和熔断完整。

## 2. 架构与数据证据

- IndexedDB schema v65，共 91 张登记表；所有项目表生命周期由 `PROJECT_TABLES` 派生。
- AI 读取只经 `CONTEXT_SOURCES + assembleContext()`；正式可写字段只经 `FIELD_REGISTRY + AdoptionSchema + adopt()`。
- Preview 与 Release 使用同一个 `GameRuntimePackageV2`；运行状态只由 SIM 事件流和 checkpoint 裁决。
- 旧 WorldRelease 直达各游戏的普通 UI 已退役；普通作者只进入统一制作中心，兼容 API 仅为旧数据和测试保留。
- 本地作者数据、在线权威、商业权威、社区权威分域；服务请求具备可信主体、速率限制、审计和 fail-closed 路由。
- 平台、在线、商业和社区快照均具备哈希校验、空目标恢复、故障注入和事务式替换反例。
- 三个账号经真实 TCP HTTP 完成发行物上传、目录审核、免费领取、权益验证评论、正式 TTRPG 房间创建/加入和服务
  重启恢复；LFG 跨域交接强制社区主持人与在线 GM 账号一致。
- 外部部署验收已有固定十场景 conformance runner 和不可缺项/篡改的 receipt：身份隔离、重启、webhook 重放/轮换、
  跨实例实时、租约丢失、灾备、退款结算与数据删除任一失败都不得晋级。

## 3. 自动化与真实浏览器证据

- `npm run ci`：全部架构守卫、91 张表生命周期检查、AI 入口检查、依赖审计、Lint、TypeScript、覆盖率、
  生产构建和包体预算通过。
- `npm run test:coverage`：501 个测试文件、2,306 个测试通过；全局 statements/lines 84.09%、branches 73.85%、
  functions 81.86%。
- `npm run ci:e2e`：冻结工作区中的真实 Chromium 58/58 通过，覆盖世界冻结与发布、统一制作入口、正式
  TTRPG GameRelease 的 Session Zero/场景/RulePack 行动/可视桌面/秘密投影/安全暂停/刷新恢复与窄屏减少动态路径、
  Build #1→#2 稳定键兼容报告及旧 Release/Session 继续可玩、编辑/Agent/导入导出、离线运行时、恢复、
  本地文件工作区、真实浏览器性能回执，以及透明 PNG、棋盘格假透明立绘的真实 alpha 重编码与 PCM WAV
  的浏览器原生解码、声道/采样率/LUFS/true peak/循环接缝测量。`ci:e2e` 默认冻结工作区，避免开发服务器 HMR
  把其他并行任务的写入误判为产品回归。
- `npm run build` 与 `npm run check:bundle-size` 通过；最大普通脚本分片 494.1 KiB raw / 134.3 KiB gzip，
  低于 600 KiB / 180 KiB 预算，且拆包未制造循环 chunk。
- `npm run test:e2e:game-performance-gates` 通过：5 秒 smoke 回执被正确判为 `long-run-incomplete`，商业候选不能
  用短测冒充长稳通过。
- `npm run test:e2e:game-performance:commercial` 通过：冻结工作区中的真实 Chromium 连续运行
  1,803,743 ms（30.06 分钟），369 组场景/输入样本，cached scene P95 176.6 ms、choice input P95 10.3 ms、
  首屏交互字节 3,956、堆内存增长率 1.90%、峰值 33,377,604 bytes，失败项为 0；回执 hash 为
  `b9279a5c54d531cdeebe6c5364e29d423473abda1f3a287d1b6e3d85742472dc`。
- 世界修订在真实 Chromium 暴露的 IndexedDB 提前提交问题已修复：严格导出直接复用外层事务快照，含 AVG 二进制
  的单测和世界到游戏 E2E 均通过。
- 覆盖率运行使用独立报告目录，避免并发任务互删 V8 临时文件；数据库密集测试使用隔离 fork。

## 4. 本地完成不等于商业 GA

下列事项需要仓库之外的账号、部署环境、真实用户或运营责任人，当前不能由本地代码自行制造证据：

1. 在可信 relay 配置真实图片、music/SFX 供应商凭据，完成费用、取消、字节、权利和 provider receipt 的隔离
   Golden Project；密钥不得写入仓库或浏览器持久数据。
2. 部署 Auth、Realtime、Marketplace/Commerce/Community/Operations 服务，在 staging 用至少两个真实账号完成邀请、
   角色分配、掉线重连、购买、退款、webhook 重放、结算和灾备恢复，并生成验证通过的
   `GamePlatformDeploymentConformanceReceiptV1`。
3. 在目标移动端、低配设备和主流桌面设备补齐设备矩阵；仓库内 30 分钟 Chromium 商业长稳门已通过，不能用
   这一台机器的结果冒充完整设备覆盖。
4. 由至少 5 名不了解内部架构的用户独立完成“世界→制作→试玩→发布”，记录首次有意义选择时间、阻塞点、
   完成率和人工修正量。
5. 由业务负责人确定价格、抽成、税务主体、内容政策、客服/SLA、值班与事件响应，不由代码默认替组织作出承诺。

## 5. 发布裁决

- 当前可称：`本地完整实现 / 可部署 Alpha 候选`。
- 当前不可称：`在线服务已上线`、`真实支付已开通`、`商业媒体证据已通过`、`Beta/GA 已完成`。
- 只有第 4 节证据全部落地、对应环境 gate 通过并留下不可变 receipt 后，才能把总方案状态升级为
  `COMMERCIAL GA READY`。
> **TTRPG 证据失效声明（2026-08-22）**：本文保留 2026-08-21 的历史本地测试记录，但其中涉及“正式 TTRPG、可信 AI GM、在线跑团已完成/商业就绪”的推导已经撤销。既有记录只能证明部分内核和测试夹具；完整跑团必须重新通过 `docs/ttrpg/TTRPG-DEVELOPMENT-TRACKER-20260822.md` 的黄金回合、Golden A/B/C、U-01～U-21 和非 fixture 浏览器门。
>
