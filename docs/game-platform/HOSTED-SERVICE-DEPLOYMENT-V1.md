# StoryForge 托管游戏平台部署合同 V1

> 状态：`COMPOSITION + ACTIVE ADAPTER CONTRACT IMPLEMENTED / EXTERNAL RECEIPT PENDING`
>
> 代码入口：`src/lib/game-platform/hosted-service.ts`、`production-runtime.ts`、
> `deployment-conformance.ts`

## 1. 交付边界

`createHostedGamePlatformServiceV1()` 把以下领域组合为一个 Web-standard `fetch(Request) → Response` 服务：

- 不可变发行物、目录、审核、领取/购买、权益、退款和支付 webhook；
- 社区资料、社交、评论、治理、LFG、出席、候补和在线房间交接；
- 税务报价、发票、创作者余额/提现、客服、状态事件和托管数据删除；
- 正式 TTRPG Release 校验、服务端权威房间、逐观看者投影、幂等命令、可验证骰子和长轮询实时提示；
- 统一 CORS、请求体上限、可信主体、限流、无凭据审计、健康检查和生产就绪门。

它不是浏览器旁路，也不进入前端 bundle。部署运行时通过 `headless-platform.ts` 导入，具体身份、数据库、对象存储、
KMS、支付和实时基础设施由部署适配器提供。

## 2. 必须提供的生产适配器

| 依赖证据键 | 生产责任 |
|---|---|
| `identity-provider` | 验证短期账号凭据，统一投影商业/社区主体，不信任客户端 userId |
| `transactional-commercial-store` | 可串行化 CAS，保存目录、订单、权益、账本和滚动恢复快照 |
| `transactional-community-store` | 可串行化 CAS，保存资料、LFG、评论、举报、申诉和恢复快照 |
| `transactional-online-store` | 按 room 分区的 CAS、备份环与故障隔离 |
| `transactional-operations-store` | 税务、发票、结算、客服、删除和事件状态的独立持久化 |
| `object-storage` | 存放经 hash 校验的发行包和媒资，不把大对象塞入权威状态快照 |
| `payment-provider` | 幂等 checkout、签名 webhook、退款和争议回执 |
| `webhook-secret-manager` | 轮换 webhook/HMAC/KMS 密钥，密钥不进入业务快照或日志 |
| `realtime-fanout` | 只广播游标提示；玩家投影仍经认证 reconnect 获取 |
| `rate-limiter` | 使用可信连接/账号主体的分布式限流，不信任转发 IP 请求头 |
| `single-writer-coordination` | 每个全局 authority namespace 由一个 Actor/租约持有者写入；在线房间按 room 分区单写 |

生产环境中，这十一项必须逐项声明为 `configured`，并提供绑定同一依赖键的
`deployment='external'` 活探针。`configured` 只是部署意图，不再能单独使健康检查变绿。任一项为
`memory`、缺失、绑定错误、探针超时或返回不健康时：

- `/healthz/platform` 强制重新观测并返回 503，列出 `missing / development-only / unhealthy`；
- 在线、社区、商业和运营请求在进入领域处理器前统一返回 503；
- 前端能力状态继续保持 developer/partial，不因服务进程能启动而自动晋级。

普通流量使用最多 10 秒的有界探针缓存，并合并并发观测；健康检查始终强制刷新。请求通过就绪门后，
`single-writer-coordination` 还必须在不接触 bearer/body 的情况下逐请求确认当前实例权威；租约丢失立即
`platform_authority_unavailable`，不把请求送入陈旧 authority。

## 3. 组合示例

```ts
const platform = createHostedGamePlatformBootstrapV1({
  serviceVersion: deployment.version,
  environment: 'production',
  allowedOrigins: ['https://app.example.com'],
  dependencyEvidence: deployment.verifiedDependencyEvidence,
  storage: deployment.serializableKeyValue,
  identity: deployment.identity,
  credentials: deployment.roomCredentialIssuer,
  releaseDeliveryPersistence: deployment.objectReleaseStore,
  lfgHandoffPersistence: deployment.lfgHandoffs,
  lfgSecretVault: deployment.secretVault,
  checkoutProvider: deployment.checkout,
  requestGuard: deployment.requestGuard,
  productionRuntime: {
    // 这些就是组合根实际使用的对象，不能另传无关探针伪装健康。
    identity: deployment.identity,
    storage: deployment.platformStorage,
    releaseDeliveryPersistence: deployment.objectReleaseStore,
    checkoutProvider: deployment.checkout,
    // 同一受控边界提供 webhook 轮换、LFG vault 和房间凭据。
    secretManager: deployment.secretManager,
    // 外部保留式游标 fanout，不传输游戏 payload。
    realtime: deployment.realtime,
    rateLimiter: deployment.distributedRateLimiter,
    requestAuthority: deployment.singleWriterCoordinator,
  },
})

export default { fetch: platform.fetch }
```

`productionRuntime` 会覆盖上方开发兼容参数中的 identity/storage/release/checkout/credential/vault；生产 authority、
发行物、LFG 和房间真正使用的就是带探针的外部对象。这一绑定防止“探针指向真数据库，业务却仍写内存”的
分离配置。

Worker、Deno、Bun 或支持 Web Request/Response 的 Node 宿主可直接挂载 `platform.fetch`。Node 原生 HTTP 宿主只负责
字节流与 Web Request/Response 转换，不得在桥接层重新实现身份、订单或房间规则。

`createHostedGamePlatformBootstrapV1()` 在外部数据库/KMS 于启动瞬间失效时，仍保留无凭据的
`/healthz/platform = 503`；它合并并发初始化、对失败做 0.1～60 秒有界退避，依赖恢复后重建组合根。
供应商异常内容不进入健康响应。已构建成功后，请求转交给动态 readiness 和租约门。

当前 authority 用 CAS 保证冲突时不丢数据，但长期存活的陈旧副本不会自动变成新 leader。因此部署必须将 commercial、
community、operations 各 namespace 路由到唯一 Actor/租约持有者，房间按 roomId 路由到唯一分区；不能把同一组合根
无状态复制后随机负载均衡。Actor 故障转移时从最新完整快照重新构造服务，再接收写流量。

### 3.1 外部实时和密钥轮换合同

- 生产组合根不再固定创建 `OnlineRoomRealtimeHubV1`；必须注入 `OnlineRoomRealtimeCoordinatorV1`。
- 推荐复用 `FanoutBackedOnlineRoomRealtimeV1`；其底层 transport 必须原子地“读保留游标 + 订阅更新”，
  避免 reconnect 到 subscribe 之间丢通知。通知仅含 `protocolVersion/type/roomId/cursor`；真实事件继续
  通过认证 reconnect 的 viewer projection 获取。
- webhook 网关通过 `CommercialWebhookSecretProviderV1` 每次解析验证密钥。集合必须恰好包含一个
  `current`，可选一个带 `expiresAt` 的 `previous`；更旧、过期、重复或未来生效密钥均 fail-closed。
- HMAC 对所有有界候选都做恒定形态比较，再解析原始 JSON；不在审计中记录 keyId、secret 或签名。

## 4. 身份与秘密不变量

- 商业、社区与在线主体必须来自同一部署账号命名空间；LFG 房间交接显式传递预期主持人 userId，在线服务再次校验。
- Bearer、邀请密钥、GM/成员会话凭据、provider reference 和 webhook 签名不得进入领域审计。
- 在线房间快照只保存凭据 hash 和主体绑定 hash，不保存账号明文或访问令牌。
- LFG 邀请明文只进入 KMS/secret vault；社区快照仅保存 secretId 与不可逆上下文 hash。
- 玩家响应、缓存和 AI 上下文只获得 viewer projection；GM 私密信息不先下发再靠 UI 隐藏。

## 5. 当前自动证据

`R-PLATFORM1H-hosted-service.test.ts` 使用真实 TCP 监听端口和三个独立账号，验证：

1. 创作者登记 TTRPG 发行物并提交目录；审核账号发布；玩家领取并获得托管权益；
2. 玩家评论带 `entitlement` 验证，创作者获得回复能力；
3. 创作者从同一已发布 Release 创建服务端权威房间，玩家用独立账号加入并提交规则行动；
4. 服务进程重建后，目录、权益、房间成员、游标和事件从事务快照恢复；
5. production 误用 memory 依赖时，健康检查和业务端点均 503；
6. 即使十一项全写 `configured`，缺失 external 活探针仍为 503；探针超时或下线可动态摘除；
7. 租约丢失在领域处理前拒绝，当前/上一版 webhook 密钥可验，退役密钥不可验；
8. 两个独立 realtime coordinator 通过共享保留式 transport 唤醒，且 transport 证据中没有游戏文本；
9. 社区主体与在线 GM 账号不一致时，匹配邀请被拒绝。

### 5.1 staging / production 不可缺项收据

`runGamePlatformDeploymentConformanceV1()` 会按固定顺序运行十项外部演练：活探针、跨账号授权、
进程重启恢复、webhook 重放幂等、密钥轮换、跨实例实时、租约丢失、隔离灾备恢复、支付—退款—结算以及
数据导出/删除。每项有超时、取消和脱敏错误码；单项失败不跳过后续演练。只有十项全部通过才会生成
`readyForPromotion=true` 的完整性 hash receipt；缺项、乱序、篡改或把失败改成通过都无法验证。

该证据证明组合代码与真实 HTTP 路径成立，不证明任何外部供应商已经部署。生产晋级仍需 staging 中的真实身份、
数据库、对象/KMS 存储、支付、实时 fanout、两个以上账号、备份恢复和故障演练 receipt。
