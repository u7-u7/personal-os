# PersonalOS 全量 PRD

状态：2026-10-28，用户已授权设计、编码、运行已有测试、提交、推送与创建 PR；按最新指令不编写测试用例。用户已对本 PersonalOS 项目给予持续合并授权：适用检查通过后直接合并 main，无需逐次确认，不绕过失败检查。

## 背景、用户与目标
独立开源个人 AI 助理，服务学生、职场人士和 Agent 学习者。当前目录经 ls/rg/git 检查为空、无 Git，未发现可复用表或业务实现。禁止依赖其他项目代码/数据库，禁止以模拟数据宣称真实集成。

## 全量需求与验收
| ID | 模块 | 可验证验收条件 | 优先级 |
|---|---|---|---|
| REQ-A | 对话 | /chat 流式真实模型输出、多轮历史、模型选择、工具参数/结果/状态，重启保留会话 | P0 |
| REQ-B | 长期记忆 | 提取偏好/目标/事实为待确认项；确认后召回；搜索、修改、删除、导出、来源追溯、冲突处理；独立 MemoryService；Hy-Memory 官方 SDK Chat/Working Memory 核查与真实集成，删除索引缓存验证 | P0 |
| REQ-C | 任务 | 自然语言创建、优先级、期限、状态、完成、历史、租户隔离 | P0 |
| REQ-D | 日历 | 自带本地日历，不依赖第三方：多日历（分类/颜色/显隐/增删改）、月/周/日三视图、全天事件、重复日程（含「仅此次/此后所有/全部」例外）、提醒站内提醒、点击与拖拽新建、事件浮层编辑删除、冲突检查；第三方日历连接已按 2026-10-31 用户决策移除 | P1 |
| REQ-E | 简报 | 按真实任务/日历/偏好生成，手动/定时、历史；未配置模型时明确错误 | P1 |
| REQ-F | 自动化 | 自然语言配置、定时/周期、暂停/恢复/取消/重试/历史；独立 Worker、持久化、防重复、超时与恢复 | P0 |
| REQ-G | MCP | 可控接入，展示权限/参数/结果；默认不信任第三方，不执行任意系统命令 | P1 |
| REQ-H | 审批与审计 | 外部写入/邮件/删除先审批；权限记录、错误追踪、执行日志，可撤销工具提供撤销 | P0 |
| REQ-I | 隐私与账户 | 服务端模型密钥、用户认证隔离、模型配置、数据导出、记忆删除、账户管理 | P0 |
| REQ-J | 决策 | 核对 TypeSafe AI Jev 官方 SDK/API/可用性；DecisionProvider 隔离、规则/普通 LLM 替代；意图/路由/相关性、决策日志与评测；绝不授权 | P1 |
| REQ-K | 开源交付 | GitHub、feature 分支、PR、截图、README、架构/API/课程文档、演示脚本、报告，不自动合并 | P0 |
| REQ-L | Web | /dashboard /chat /memory /tasks /calendar /automations /integrations /activity /settings，响应式/明暗/加载/错误/空状态 | P0 |

## 非功能需求
NFR-01：PostgreSQL 为事实源；每张业务表有逻辑删除、创建/更新时间、version、extra；按 owner/status/due 索引，不写 JOIN。
NFR-02：Next.js/TS/Tailwind/shadcn/TanStack Query；FastAPI/Pydantic/LangGraph，持久 Checkpointer/Store；Redis 与独立 Worker。
NFR-03：密钥只保存在服务端，OAuth token 加密；Cookie 认证、同源保护、数据隔离、工具超时/审批/审计，禁止模型直接 SQL/shell。
NFR-04：Pytest/Playwright/GitHub Actions；Docker Compose 一键启动；报告真实测试边界。最新用户明确要求测试，优先于早前不写测试的一般指令。
NFR-05：可重启恢复、幂等 claim、租约超时；外部写入不明结果不盲目重试。

## 假设与待确认
使用当前已认证 GitHub u7-u7；仓库不存在时创建公开独立仓库。用户授权开源，不包含任何密钥/本机 provenance。
模型、Hy-Memory、Jev、第三方日历/MCP 凭据未提供时，保留接口与明确不可用状态，集成验收标记 blocked，不虚构成功。

2026-10-29 用户选择：当前使用自带日历，不需要接入 Google Calendar。REQ-D 的本地日历仍完整交付；第三方连接保留为可选能力，不再请求 Google 凭据或以其未授权阻塞当前本地候选版，真实 Google 验收状态仍是未完成。

2026-10-31 用户进一步决策（覆盖上一条中「第三方连接保留为可选能力」的表述）：Google 日历彻底移除，包括日历页与集成页的 UI、文案，以及 `/api/calendar/oauth/*`、`/api/calendar/google/*` 路由、Google 服务实现与 `google_*` 配置；REQ-D 不再包含第三方日历 OAuth 验收项。日历风格与规划参照苹果日历：月/周/日三视图、侧栏多日历带颜色与显隐、全天行、红色当前时间线、点击与拖拽新建、事件浮层编辑。同时新增完整重复日程（含例外作用域）与站内提醒（不推送）。第三方 MCP 能力（REQ-G）不受影响。
7 天为完整里程碑计划；本轮尽可能实际交付，不宣称未经测试的需求完成。

## 2026-10-28 user-selected embedding

REQ-B-EMBED: Use Qwen3.7 Embedding Flash (`qwen3.7-text-embedding-flash`) in Beijing. Default 1024 dimensions, official alternatives 768/512/256. User will later supply the workspace URL and Bailian key through Settings. Keep chat/embedding credentials separate and encrypted; expose a truthful saved-connection probe. Existing Hy/Jev deferred authorization remains unchanged; provider setup must not falsely claim vector indexing is enabled.
