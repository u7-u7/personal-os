# MCP OAuth 授权：配置教程

对应 `services/oauth.py`（协议层）、`main.py` 的两个路由与 `services/tools.py` 的令牌注入。**目标**：在集成页点一下就在浏览器里跳到服务商的授权页，回调后令牌加密落库——也就是 Codex 那种体验。

## 1. 为什么需要这一层

MCP 规范要求客户端先读服务器发布的 RFC 9728 受保护资源元数据，再找授权服务器，然后用 OAuth 2.1 + PKCE 拿令牌。实测 GitHub 的 MCP 服务器确实发布了它：

```
POST https://api.githubcopilot.com/mcp/        -> 401
WWW-Authenticate: Bearer resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"

GET  <上面那个 URL>                            -> 200
{"resource":"https://api.githubcopilot.com/mcp/",
 "authorization_servers":["https://github.com/login/oauth"],
 "scopes_supported":["repo","read:org","read:user",...]}
```

## 2. 配置（GitHub 为例）

### 2.1 建一个 OAuth App

GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App

- **Authorization callback URL 必须精确等于**：`{API_URL}/api/oauth/callback`
  本地就是 `http://127.0.0.1:8000/api/oauth/callback`
- 记下 `Client ID`，再生成一个 `Client secret`

> 为什么必须先手工建一次？因为 GitHub 的授权服务器**不发布 `registration_endpoint`**（实测 `/.well-known/oauth-authorization-server` 是 404，`/.well-known/openid-configuration` 里也没有注册端点），所以动态客户端注册对 GitHub 不可用。代码里保留了 DCR 分支，将来接支持注册的服务时是零配置。

### 2.2 写进 `.env`

```
API_URL=http://127.0.0.1:8000
OAUTH_CLIENT_ID=<Client ID>
OAUTH_CLIENT_SECRET=<Client secret>
# 可选：覆盖回调地址（例如反代后的公网地址）
OAUTH_REDIRECT_URI=
```

`OAUTH_REDIRECT_URI` 为空时由 `API_URL + /api/oauth/callback` 推导（`config.py` 的 `oauth_callback_url`）。改完重建：`docker compose up -d api`。

## 3. 授权流程

```
1) 集成页添加 MCP 服务        POST /api/integrations           url=https://api.githubcopilot.com/mcp/
2) 显式信任并勾选工具权限      PATCH /api/integrations/{id}
3) 点「授权」                 POST /api/integrations/{id}/oauth/start
                              -> {"authorization_url": "...", "state": "...", "scope": [...]}
4) 浏览器跳转                 GET  {authorization_url}         （GitHub 授权页）
5) 回调                       GET  /api/oauth/callback?code=..&state=..
                              -> 302 {APP_URL}/settings?oauth=ok
6) 之后调用工具               services/tools.py 自动带 Authorization: Bearer <token>
```

前提：**必须先显式信任**（`trusted=true`），否则 start 直接 403。这和服务商是否愿意授权无关，是本项目自己的闸门。

## 4. 权限：默认只读，按需升级

| 情形 | 请求的 scope |
| --- | --- |
| 不传 `scope`，服务商提供 `read:user`/`public_repo` | `read:user public_repo` |
| 不传 `scope`，服务商一个只读 scope 都没有 | **不传 scope**（由服务商给最小默认），绝不会退而求其次去要它的第一个 scope |
| 显式传 `{"scope":["repo"]}` | 照传（这是用户主动升级） |

写操作另外还有一层：MCP 调用本身仍走审批（`mcp.call` → Activity 批准）。**scope 小 + 审批**是两道独立的闸。

## 5. 存储与隐私

| 项 | 做法 |
| --- | --- |
| 令牌 | `integration.data["encrypted_tokens"] = Fernet({access_token, token_type, refresh_token, expires_at, scope})` |
| 密钥 | 复用 `security.py` 的 `ENCRYPTION_KEY`；密钥不可用时返回 503，不会退化成明文 |
| 待授权状态 | `Record(kind="oauth_state", status="pending")`，10 分钟过期，一次性 |
| PKCE verifier / client secret | 只存在于该 state 记录的密文里，被 claim 的那一刻从 `data` 里删除 |
| 接口输出 | `safe_integration` 同时剥掉 `extra.encrypted_tokens` 与顶层 `encrypted_tokens`（`serialize` 会把 `data` 平铺到顶层，只剥 `extra` 会泄漏） |
| 导出 | `/api/export` 走同一个 `safe_integration`，且排除 `kind="oauth_state"` |
| 审计 | 只记 `oauth.linked` + scope，不记令牌 |
| 日志 | 只记 error code / 异常类型 |
| 一次性 | state 用条件 UPDATE（`WHERE status='pending' AND version=? AND due_at>now()`）claim，重放或并发回调一律 `invalid_state` |

令牌过期时 `services/tools.py::access_token()` 会尝试刷新一次；刷新失败按「无令牌」处理，不会拿已被拒绝的令牌重试。

## 6. 限制与已知缺口

| 限制 | 说明 |
| --- | --- |
| 需要服务商发布 PRM | `discover()` 依赖 RFC 9728 元数据。GitHub 的 **MCP 服务器**发布了它；**普通 GitHub REST API 没有**，所以 `code_hosting` 原生工具仍然读 `GITHUB_TOKEN` 环境变量 |
| GitHub 无 DCR | 必须先手工建 OAuth App，见 2.1 |
| **海外域名在本机被守卫拦** | 实测 `api.githubcopilot.com`/`github.com` 解析到 `198.18.x.x`（代理 fake-IP），`network.py` 判为非公网地址 → `blocked_url 403`。**要真机跑通必须换到 DNS 干净的部署环境** |
| 前端未消费回调参数 | `/settings?oauth=ok` 目前没有 UI 反馈，需补 |
| `oauth_state` 行不清理 | 已用过的记录会累积（导出已排除），需要定时清理 |
| 授权会让 integration.version +1 | 前端 PATCH 前必须重新拉取，否则拿到既有的 409 |

## 7. 验收记录（镜像内实测，非自述）

```
ROUTES_HAS_START    True      # POST /api/integrations/{item_id}/oauth/start
ROUTES_HAS_CALLBACK True      # GET  /api/oauth/callback
PKCE_OK             True      # S256 挑战值与 verifier 对应
LIVE_DISCOVER       blocked_url 403   # 真实调用先撞 SSRF 守卫（fake-IP）
DCR                 dcr_unsupported   # GitHub 无注册端点时的干净退路
SCOPE_DEFAULT       ['read:user', 'public_repo']
SCOPE_NO_READONLY   []        # 服务商没有只读 scope 时不传 scope
LEAK_TOP_LEVEL      False     # integration 响应里没有 encrypted_tokens
CB_FALLBACK         http://h:8000/api/oauth/callback
```

**未验证**：本机无法完成真实授权（fake-IP），所以「换码 → 落库 → 带 Bearer 调工具」这条端到端链路没有一次真实跑通；Gitee 同理未跑。这一段在 DNS 正常的环境里补做后才算验收通过。
