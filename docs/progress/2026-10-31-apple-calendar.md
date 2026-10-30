# 苹果风本地日历交付报告（2026-10-31）

设计契约：`docs/plans/2026-10-31-apple-calendar-design.md`（决策 D1–D9 与 API/CSS 类名契约）。

## 一、用户决策（不得回退）

| # | 决策 | 落地 |
| --- | --- | --- |
| D1 | Google 日历彻底移除 | UI/文案/`/calendar/oauth/*`/`/calendar/google/*`/`services/calendar.py` 原 Google 实现/`google_*` 配置/compose 与 `.env.example` 中的 `GOOGLE_*` 全部删除 |
| D2 | 月 + 周 + 日三视图 | 月网格、周/日小时级时间网格（含顶部全天行） |
| D3 | 多日历（颜色 + 显隐） | records `kind="calendar"`，服务端十色调色板白名单 |
| D4 | 点击/拖拽新建 + 浮层编辑 | 月视图点格新建（默认 09:00–10:00）、周/日拖拽选区（15 分钟吸附）、`.cal-pop` 浮层编辑/删除 |
| D5 | 苹果风视觉 | 系统字体栈、1px hairline、红色当前时间线（含圆点）、彩色事件条、胶囊分段控件、毛玻璃浮层；深浅色双套 |
| D6 | 完整重复 + 例外 | RFC5545 子集 + `scope=this|following|all`，`overrides`/`exdates` 承载例外 |
| D7 | 站内提醒（不推送） | records `kind="notification"`，worker 每轮扫描并去重 |
| D8 | 预置不可删「个人」默认日历 | 迁移为每个 owner 补默认日历，删除默认日历 409 |
| D9 | 沿用脏树开发 | 未 stash/未提交他人改动，日历改动叠加在当前分支 |

## 二、交付内容

后端（`apps/api`）：
- 新增 `services/recurrence.py`（RFC5545 子集解析/展开/截断/余量，按事件自身 IANA 时区的墙钟语义展开）、`services/notifications.py`（sha256 dedupe、扫描、三件套）、`alembic/versions/0002_local_calendars.py`（默认日历补齐 + `calendar_id`/`provider` 回填 + `(kind, deleted_at, start_at)` 索引，幂等）。
- `services/calendar.py` 重写为本地日历服务：日历 CRUD、事件三种 scope 更新/删除、窗口展开、EventOut 组装。
- 路由：`GET|POST /api/calendars`、`PATCH|DELETE /api/calendars/{id}`、`GET|POST /api/events`、`PATCH|DELETE /api/events/{id}?scope=`、`GET /api/notifications`、`POST /api/notifications/{id}/read`、`POST /api/notifications/read-all`；删除 6 个 Google 端点；`/api/settings` 去掉 `google_calendar_connection`/`google_oauth_configured`。
- `worker.tick()` 接入提醒生成；`agent.py` 的日历工具本地化；`tools.py`/`privacy.py`/`records.py` 清理 Google 与失效代码。
- `pyproject.toml`/`uv.lock` 显式声明 `python-dateutil`。

前端（`apps/web`）：
- `workspace-pages.tsx` 日历页重写为月/周/日三视图 + 侧栏（迷你月历、日历列表、勾选显隐、改名改色、删除、新建）+ 浮层 + 提醒铃铛；集成页只剩 MCP；首页议程改为跳转 `/calendar`。
- `globals.css` 新增 `cal-*` 全套样式与令牌（55 个契约类名全覆盖）。
- `lib/api.ts` 类型同步；`lib/messages/pages.ts` 删除 25 个 Google/旧日历键、新增 52 个键。

## 三、验收证据（真实执行）

后端：
- `ruff check personalos alembic tests` → `All checks passed!`
- `pytest -q` → `50 passed, 1 skipped`（改动前基线同为 50 passed/1 skipped，未新增测试）
- 真实迁移：`alembic upgrade head` 后 `version_num=0002`，每 owner 恰一个「个人」日历，`calendar_id` 缺失事件数 0；compose `migrate` 二次执行零变更（幂等）。
- 真实 API（浏览器上下文，新账号）：创建「工作」日历 201、三个事件（含 `FREQ=WEEKLY;COUNT=4` 与全天）均 201、`GET /api/events` 200 且重复实例被展开。

前端：
- `tsc --noEmit` exit 0；`eslint .` exit 0；`next build` 成功。
- `playwright test` → `1 passed`（既有用例零改动，含 `.event-card h3`、`New event`、`Title/Starts/Ends`、`Add event`）。

浏览器人工验收（1440×1000 与 390×844，浅色/深色）：
- `docs/evidence/calendar-apple-month.png` 月视图（今日红标、彩色事件条、全天事件跨列）
- `docs/evidence/calendar-apple-week.png` 周视图（紧凑刻度 `9 AM`、红色当前时间线 + 圆点、事件块、自动滚到当前小时：假时钟 14:30 下 `scrollTop=432`＝最大滚动位置）
- `docs/evidence/calendar-apple-day.png` 日视图
- `docs/evidence/calendar-apple-popover.png` 事件浮层（标题/日期/时间/备注/Edit/Delete）
- `docs/evidence/calendar-apple-dark.png` 深色主题
- `docs/evidence/calendar-apple-mobile.png` 390px：`scrollWidth - innerWidth = 0`，侧栏收进抽屉
- 铃铛面板：Escape 关闭、点击外部关闭（实测面板计数 1→0→0）

## 四、已知限制（如实记录）

1. 重复事件的冲突检查只覆盖基础事件行的时间段，未逐个实例做冲突检测。
2. `is_exception` 定义为「该实例时间被改离规则位置」，纯改标题/地点只算 `is_override`。
3. 提醒 UI 只支持单档（不提醒/开始时/5–30 分/1 时/1 天），后端支持最多 5 档数组。
4. 月视图 `+N` 溢出条未在 >3 事件/日的场景实测。
5. 周/日视图 12 AM 刻度标签留空（视觉上与苹果一致，但属未显式确认的取舍）。
6. `DELETE /api/events` 为本地软删，不再走 approval 审批（纯本地数据、无外部副作用）。
7. 账户注销回执不再包含 `provider_authorizations_revoked`（已无外部日历授权可撤销，保留会是假成功）。
8. 未写任何测试用例（遵循用户既有要求），只跑既有检查。
