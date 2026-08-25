# ADR · 游戏平台单一权威、发布与本地/云边界

> 日期：2026-08-21<br>
> 状态：Accepted<br>
> 范围：MASTER-0、TTRPG、六类文字游戏、在线多人、商业平台

## 决定

1. `WorldRelease` 是不可变创作来源；`PlayableWorldBundle` 是可追溯规范化出口；二者都不是运行规则。
2. 所有正式游戏（包括 TTRPG）统一发布为 `GameDefinition / GameRelease v2`，其中冻结一个
   `GameRuntimePackageV2`。TTRPG 在包内使用 `RulePack + Campaign` 专用编译器，不建立第二套发布权威。
3. 本地单机的唯一运行真相是 SIM 事件、检查点和分支。AI、聊天文本、组件状态和媒体 Cue 均不得直接成为规则状态。
4. 在线房间的唯一运行真相迁移到服务端权威命令与事件存储；客户端只保留按观看者过滤的投影、游标和可重放 outbox。
5. 作者私有草稿继续只在本地。服务端只接收用户明确发布的 Release 或一次后台任务明确授权的最小输入。
6. AI 只能生成候选、调用登记工具和叙述已提交结果。骰子、权限、资源、状态、秘密释放、发布和付款均由确定性代码裁决。
7. 生产仍由三注册表治理：AI 读写和本地表分别收口到 `CONTEXT_SOURCES`、`FIELD_REGISTRY / AdoptionSchema`、
   `PROJECT_TABLES`。在线服务的数据库不伪装成本地项目表，二者通过版本合同连接。
8. 功能开放阶段只有 `disabled → developer → experimental-project → author-opt-in → default`，代码状态字典位于
   `src/lib/game-platform/capability-status.ts`。没有真实服务或评测证据时必须 fail-closed。

## 环境与发布策略

- 当前 `main` 直接部署的前端只承载本地能力；在线、社区和支付不得因协议类型已存在而出现在生产导航。
- 在线服务上线前必须建立 development / preview / production 三套隔离环境，使用独立数据库、对象存储、密钥和回调域名。
- 数据库变更必须先完成向前迁移、备份恢复和兼容窗口；协议升级保留旧客户端只读/导出路径。
- 回滚隐藏入口但不删除 Release、Build、房间事件或订单。破坏性删除只能由明确生命周期或保留策略触发。

## 当前边界

本地正式跑团和六类生产链可以继续交付；AI GM 仍受真实样本门限制。在线、社区、商业与运营权威现已通过
`createHostedGamePlatformServiceV1()` 汇入一个 Web-standard 托管组合根，并用三个账号经真实 TCP HTTP 完成
发行、领取、验证评论、正式房间加入与服务重启恢复；生产依赖未全部声明 `configured` 时健康检查和所有领域请求
统一返回 503。跨域 LFG 交接还会强制社区主持人与在线 GM 账号一致，避免困惑代理。

这仍不等于外部服务已经上线。真实身份、数据库、对象/KMS 存储、搜索、支付商、税务、风控、实时 fanout 和部署灾备
未接入前，在线与目录仍为 `partial`，支付保持开发态；浏览器字段不得冒充付款或权益。部署适配清单见
[`HOSTED-SERVICE-DEPLOYMENT-V1.md`](../game-platform/HOSTED-SERVICE-DEPLOYMENT-V1.md)。
