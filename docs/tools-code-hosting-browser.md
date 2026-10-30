# 代码托管与网页读取工具：配置教程

本文件对应 `apps/api/personalos/services/hosting.py` 与 `browser.py`。两个工具都是**原生工具**（不是 MCP，不需要安装、不走 integration 表），在 `agent.py::make_tools` 里与本地任务/日历工具同级注册。

| 工具名 | 作用 | 执行方式 |
| --- | --- | --- |
| `code_hosting` | GitHub / Gitee 通用：读仓库、搜索、issues、PR | 只读直连；写入生成审批 |
| `browse_web` | 只读网页读取：正文、链接、元信息 | 直连（强制公网 HTTPS） |

## 1. 配置凭据

凭据**只从环境变量读取**（`hosting.py:225`），不入库、不进导出、不进审计。

1. 在 `.env` 里填（`.env.example` 已留位）：

```
GITHUB_TOKEN=ghp_...
GITEE_TOKEN=...
```

2. 重建 api 进程（`compose.yaml` 里 api 服务使用 `env_file: .env`）：

```bash
docker compose up -d api worker
```

3. 验证是否生效：

```bash
docker exec personalos-api-1 /app/.venv/bin/python -c \
  "from personalos.services.hosting import make_code_hosting_tool as mk; \
   print(mk(None,'x').ainvoke({'platform':'github','action':'search','params':{'q':'personal-os','kind':'repos'}}))"
```

未配置 token 时的真实返回（不是异常、不会伪造数据）：

```json
{"error": "missing_credential", "message": "GITHUB_TOKEN is not configured on the server", "platform": "github"}
```

⚠️ 注意：**没有 token 时只读动作同样失败**，包括公开仓库。这是刻意的——宁可直接报错，也不要让模型在“可能没读到全量数据”的状态下继续推断。

## 2. 在对话里怎么用

模型看到的是一个工具加一个动作参数，所以直接用自然语言即可：

| 你说 | 模型会调 |
| --- | --- |
| 看一下 python/cpython 的 README | `code_hosting(platform="github", action="repo_file", params={owner,repo,path})` |
| 搜一下 xxx 相关的仓库 | `code_hosting(platform="github", action="search", params={q,kind:"repos"})` |
| gitee 上 oschina 有哪些 issue | `code_hosting(platform="gitee", action="list_issues", ...)` |
| 这个 PR 改了哪些文件 | `code_hosting(..., action="pr_files", params={number})` |
| 打开某个网页看正文 | `browse_web(action="read", url="https://...")` |
| 这页有哪些外链 | `browse_web(action="links", url="https://...")` |
| 这个地址返回了什么状态 | `browse_web(action="meta", url="https://...")` |

## 3. 写操作：走审批，不直连

`create_issue` 和 `comment` 不会立刻执行。工具返回

```json
{"approval_required": true, "approval_id": "..."}
```

然后在 **Activity 页面批准**，`tools.py::_execute_approval` 才会路由到 `execute_code_hosting_write` 真正发出请求。

`main.py::_finish_approval` 的 `external_write` 集合已包含 `code_hosting.write`，因此：

- provider 返回 5xx / 网络超时 → 记为 `outcome_unknown`，**不会**被当成普通失败
- 这样做的目的：避免用户看到“失败”就重试，从而重复建 issue 或重复评论

## 4. 能力边界（先知道，省得排查）

| 限制 | 原因 |
| --- | --- |
| 无 token 时全部失败 | 设计如此，见上 |
| Gitee 没有代码搜索 | Gitee API v5 未发布该端点（实测 `/search/code`、`/search/codes` 均 404）；`search(kind="code")` 在 gitee 上返回 `unsupported_action` 而不是瞎猜 |
| Gitee 建 issue 走 `POST /repos/{owner}/issues`，`repo` 放 body | 与 GitHub 的 `/repos/{owner}/{repo}/issues` 不同，照抄 GitHub 会静默失败 |
| Gitee 认证用 `access_token` 查询参数 | 其 spec 未注册 Bearer `securityDefinitions`；token 已在所有错误路径脱敏 |
| `browse_web` 无 JS 渲染、无截图、不能点击/提交 | 不内联浏览器引擎（无 Playwright/Chromium），只有 GET |
| 海外域名可能被拦 | 部署环境把域名解析到 `198.18.0.0/15`（代理 fake-IP）时，`network.py` 的 SSRF 守卫会按“非公网地址”拒绝 |
| 上限 | 响应 2 MB、正文 8000 字、链接 200 条、单次 20 s、重定向最多 5 跳 |

## 5. 安全模型

- token 仅存在于进程环境变量；`hosting.py:105` 的 `scrub()` 会把 token 从所有错误文本里替换成 `[redacted]`
- `browse_web` 每一跳都过 `validate_public_url`（`browser.py:101`），重定向目标先校验再请求，私有/本地/保留地址一律 403
- 只发 GET、无 `Authorization`、每次调用新建 client 并清空 cookie（`browser.py:56-61, 102-103`）
- 输入校验：拒绝 `..` 路径穿越、超长字段、未知参数（`hosting.py:112-219`）

## 6. 验收记录（实测输出，非自述）

在真实镜像 `personalos-api:local`（python 3.12.16 / httpx 0.28.1）内运行：

```
TOOL_COUNT 13
NAMES [... 'code_hosting', 'browse_web']
CODE_HOSTING_ARGS ['platform', 'action', 'params']
BROWSE_ARGS ['action', 'url', 'params']
TOOLS_ROUTES_WRITE True          # tools.py 已路由 code_hosting.write
EXTERNAL_WRITE_SET True          # main.py 已纳入 external_write
```

防护实测：

```
BLOCKED            {"error":"BlockedURL","status":403,"reason":"Private, local and reserved network destinations are prohibited"}
TRAVERSAL          {"error":"invalid_params","message":"path must be a plain relative repository path"}
BAD_PLATFORM       {"error":"unsupported_platform","message":"platform must be github or gitee"}
GITEE_CODE_SEARCH  {"error":"unsupported_action","message":"Gitee API v5 publishes no code search endpoint; use kind=repos"}
META               {"status_code":200,"final_url":"https://www.qq.com","bytes":135336,"elapsed_ms":314}
```

**未验证的部分（如实记录）**：仓库与部署环境都没有可用的 `GITHUB_TOKEN` / `GITEE_TOKEN`，因此**所有已认证读取与实际写入均未经真机验证**；Gitee `POST` 的 body 编码（JSON vs form）仍未确认，若真实写入出现 422，应先改为 form 编码再判定为代码缺陷。
