# GAME-PROD-1 实施证据 · 2026-08-21

> 状态：`IMPLEMENTED / COMMERCIAL MEDIA EVIDENCE PENDING`
>
> 本文是实施与验收证据卡，不是完成卡。V3 §24 中真实图片、真实 music/SFX、供应商费用与权利证明仍为
> `PARTIAL`，因此不得把 GAME-PROD-1 宣告为商业完成。

## 用户主流程

- 已发布 WorldRelease 是唯一冻结来源；用户从世界引擎表达制作意愿后进入统一游戏制作中心。
- Agent 先给出主线、支线、角色或局部故事等可玩起点建议；用户确认标题、主角、起点、规模、质量和媒资要求后冻结 Brief。
- 用户未显式启用项目功能、未授权开始时不会创建 Build。开始后内容、视觉、音频与装配任务按有界 DAG 自主执行。
- 用户可以 pause、resume、stop；开始命令在完成、暂停或停止前持续有效，切页/刷新后工作台会按 durable
  Run/Build 状态和 checkpoint 自动续跑，不要求作者再次点击“继续”。
- 未发布 Build 可直接试玩；质量门通过后复验同一个 package hash 并原子发布。后续演化创建新 Brief/Build，旧 Release 和存档保持不变。
- 分支叙事、角色互动、文字冒险、AVG、叙事模拟、文字开放世界和 TTRPG 共用生产控制面，产品差异由登记 compiler/adapter 实现。

## API 与凭据边界

- 正式文本任务直接读取“设置”中的全局 AI 配置和任务路由；制作中心没有第二个 API Key 输入框。
- Chromium 主路径实测复用 `agnes / agnes-2.0-flash`，项目授权前后均不要求再次填写 Key。
- 全局 provider 为 Agnes 时，图片能力复用同一份配置和同一个 Key，自动切换到
  `agnes-image-2.1-flash` 与 `/v1/images/generations`；不会要求把文字模型名手工改成图片模型。
- Production、Build、Artifact、receipt、导出和错误日志只冻结去敏 provider/model/binding，不保存明文 Key。
- 商业图片优先绑定现有 Agnes browser-direct 能力，仍保留可信 relay 与 existing/imported 媒资作为部署/迁移路径。
  Agnes 当前公开接口没有独立 music/SFX 生成合同，因此商业音频仍需可信音频 relay 或 existing/imported 媒资；能力门
  按 Brief 实际要求分别判断，不再因缺音频 relay 错误阻断静音 AVG 的 Agnes 图片生产。

## 数据与发布边界

- `CONTEXT_SOURCES` 登记会谈、Brief、Artifact 输入、演化基础和 QA 反馈；正式上下文只经 `assembleContext()` 读取。
- Brief/Build/命令等受治理写入经 `FIELD_REGISTRY`、`AdoptionSchema` 和统一 adoption/service 边界完成。
- 生产表、共享 Blob、Release、存档与平台表全部进入 `PROJECT_TABLES` 派生的迁移、导入导出、删除、引用重映射和作用域生命周期；当前总表数 91。
- Preview 和正式 Release 使用同一 RuntimePackage/媒体解析合同；正式发布事务只绑定已完成 Blob，不在事务内调用外部供应商。
- 商业 Build 只要 Brief 要求媒资，就必须在真实 Preview 浏览器中逐项解码同一 `blobContentHash`：图片核对尺寸、
  字节、透明通道与角色锚点；音频核对时长、声道、采样率、LUFS、true peak 与循环接缝。结果冻结为不可变
  `media.runtime.decode` v2 receipt；缺失 URL、解码失败、hash/规格不符或最新失败都会保持发布门关闭。
- Agnes 角色图若返回棋盘格假透明，冻结前使用 edge-connected 背景移除与小半径 opening 清除网格残片，保留
  主体内部白色区域，重新编码 PNG 并重算 Blob hash；真实 Chromium 已验证角落透明、主体内部仍不透明且最终
  `media.runtime.decode` 能识别真实 alpha。

## 真实验证证据

### 浏览器商业性能

冻结工作区 Chromium 30 分钟商业长跑已独立通过两次。本轮复验 receipt：

`b9279a5c54d531cdeebe6c5364e29d423473abda1f3a287d1b6e3d85742472dc`

前一轮通过 receipt：

`6e30a62fe9abf64cfd1ad7eafd93d5b8badace8ce81ad8b37f2a88e298637f97`

| 指标 | 实测 | 商业阈值 |
|---|---:|---:|
| 缓存场景切换 p95 | 176.6 ms | ≤250 ms |
| 选择输入 p95 | 10.3 ms | ≤100 ms |
| 首次交互字节 | 3,956 bytes | ≤12 MiB |
| 峰值 JS heap | 33,377,604 bytes | ≤350 MiB |
| 第 5–30 分钟 heap 增长 | 1.90% | ≤10% |
| 场景/输入样本 | 369 / 369 | 满足商业样本门 |
| receipt failures | 0 | 必须为 0 |

运行结束后同一浏览器路径继续到达结局、冻结主路线 receipt，并验证性能门解锁同包原子发布。5 秒 smoke receipt
保持 `long-run-incomplete`，证明短测不会冒充商业通过。含媒资的商业 Build 还必须叠加自动浏览器解码 receipt，性能与
主路线回执不能绕过这一媒资门。

### 自动化回归

- 完整 `npm run ci` 通过：三注册表、91 张表、834 个源码可达性、AI 入口、依赖审计、Lint、TypeScript、覆盖率、生产构建和包体预算全部通过；生产依赖审计为 0 个漏洞。
- 全量覆盖率运行：501 个测试文件、2,306 项测试全部通过；语句覆盖率 84.09%、分支覆盖率 73.85%、函数覆盖率 81.86%。
- 冻结工作区 Chromium E2E：58/58 通过，覆盖世界发布、统一制作入口、项目显式启用、全局 AI 复用、正式 TTRPG GameRelease 玩家/GM 主路径、Build 演化兼容报告及旧 Release/Session 继续可玩、编辑器、导入导出、玩家路径、性能 smoke，以及真实透明 PNG、假透明立绘 alpha 重编码、PCM WAV 浏览器解码与音频质量指标。
- 生产构建成功；脚本预算检查通过，最大普通异步/供应商块 494.1 KiB，低于 600 KiB 上限。
- 350 次状态转换压力样本通过：场景 p95 162.4 ms、输入 p95 7.3 ms、峰值 heap 31,242,696 bytes。
- TTRPG 签名包拒绝非 canonical base64url padding-bit 篡改；确定性反例回归通过。

## 尚未闭合

1. 用现有全局 Agnes 配置完成一次真实图片隔离 Golden Project，冻结模型、请求、取消、字节、权利和去敏 provider receipt；
   当前已通过官方请求/响应合同、录制响应、Base64/MIME/hash 与无 Key binding 回归，尚未把真实账号调用写成完成证据。
2. 为商业 music/SFX 绑定真实音频 provider 或导入正式媒资，再用真实 Agnes 图片/真实音频字节跑一次已实现的 Build
   Preview 自动解码门，形成实际浏览器、实际文件 hash、图片尺寸/透明度、音频声道/采样率/LUFS/true peak/循环接缝
   和权利字段的 Golden receipt；当前 gate、
   失败反例与发布阻断已经实现，但录制 fixture 不能代替真实供应商证据。
3. 纯前端在浏览器完全关闭后不会后台继续运行；若商业产品要求离线持续生产，需部署独立 worker/账号/对象存储能力。

以上未闭合项不会要求终端用户为 Agnes 图片再填 Key；音频是独立能力与商业运营验收边界。
