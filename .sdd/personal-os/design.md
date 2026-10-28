# PersonalOS 技术架构

## 当前证据
2026-10-28 当前目录为空，git status 显示非仓库；无相似接口、表、框架可复用。GitHub gh auth 已验证 u7-u7，目标 personal-os 未发现；Python 3.12 可用，Node 24、uv 可用；Docker daemon 初查不可达。全部新增路径为本设计明确建立，不代表已有实现。

## 决策与替代方案
DES-01 (REQ-A/B/J)：FastAPI 分层 route/service/repository/provider，LangGraph 编排、持久化 Checkpointer/Store；MemoryService 和 DecisionProvider 可独立替换。使用成熟框架，避免自建 Agent 循环。规则替代只提供规则确实可判断的结果，真实 LLM 缺失返回依赖未配置。
DES-02 (REQ-C/D/E/F/H/I)：PostgreSQL 业务事实源，SQLAlchemy/Pydantic，owner_id 索引隔离。复用审计/审批/版本控制；没有可复用旧表，按领域创建必要表。查询无 JOIN、以主键和 owner 过滤；列表限额、分页。Redis 用于速率限制/辅助，不作为唯一任务事实源。
DES-03 (REQ-F/H)：Worker 数据库原子 claim/租约，唯一运行键；超时回收。只执行白名单处理器，外部写操作先创建 approval，审批绑定参数，未知外部结果不自动重复。
DES-04 (REQ-D/G/H)：第三方日历 OAuth、加密 token；MCP 官方 client、HTTPS host allowlist、显式信任、逐工具权限与审批。拒绝任意 shell 和内网 SSRF。撤销能力按工具实际支持。
DES-05 (REQ-L)：Next.js 工作台，深色墨绿/米白设计、安静的编辑式排版；左侧导航+工作区+上下文面板。TanStack Query 实时 API，同源反向代理，不含假统计/预置任务。
DES-06 (REQ-K/NFR)：Compose postgres/redis/api/worker/web，Alembic 迁移、锁定依赖、healthcheck、CI；feature 分支和可审核 PR。敏感配置 .env 不进 Git。失败回退上一 commit，不破坏数据；数据库破坏性迁移需备份。

## 数据与接口契约
统一 /api；Cookie HttpOnly 会话。POST /auth/register /auth/login /auth/logout，GET /auth/me。
GET/POST /tasks /memories /events /automations /integrations；PATCH/DELETE /{resource}/{id} 带 version。列表返回数组；对象含 id/created_at/updated_at/version/extra/deleted_at。Memory: content/category/status/source；Task: title/status/priority/due_at；Event: title/start_at/end_at；Automation: title/prompt/cron/timezone/status/next_run_at。
GET /dashboard；GET/POST /briefings；GET /activity /approvals；POST /approvals/{id}/resolve；GET/PATCH /settings；GET /export。
POST /chat/stream {message,session_id?,model?} 返回 SSE，每个 data 为 JSON，type=status|token|tool|error|done，token 带 content，done 带 session_id；GET /chat/sessions、GET /chat/sessions/{id}/messages。
外部服务失败使用明确 HTTP 状态和错误，不以 HTTP 200 成功语义掩盖。

## 安全与一致性
显式认证 owner 来自会话而非请求体。变更版本 CAS 防丢失；删除先墓碑再清 provider 与缓存，失败保留可追踪清除状态，不声称完全删除。所有模型工具通过带用户上下文的白名单，不执行 SQL/shell。所有远程 IO 有超时。模型不得自行批准权限。

## 需求追溯
REQ-A/B/J→DES-01；REQ-C/E/I→DES-02；REQ-F/H→DES-03；REQ-D/G/H→DES-04；REQ-L→DES-05；REQ-K 和全部 NFR→DES-06。

## 验证与风险
高风险集成测试：跨用户访问、CAS、审批绑定、防重复与恢复、记忆删除、模型未配置失败；Playwright 真页面注册/任务/记忆/导航截图。外部授权未给出时保留验收门槛。服务/框架兼容性必须安装运行验证，不能只凭代码推断。

DES-01 embedding update (REQ-B-EMBED): select the Beijing Qwen3.7 Flash preset with independent encrypted user credentials, strict provider-owned endpoint syntax and a separate real connectivity probe. Configuration saves do not depend on DNS availability; only the explicit probe makes a provider request, with standard HTTPS certificate validation. The Hy bridge isolates owner/model/endpoint/dimensions across vector/cache/history paths and remains gated; no vector-table migration or automatic indexing is introduced.
