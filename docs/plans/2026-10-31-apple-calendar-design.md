# 苹果风本地日历改造 · 设计计划（2026-10-31）

## 1. 访谈结论（用户已拍板，不得回退）

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | Google 日历定位 | **彻底移除**：日历页与集成页不再出现任何 Google 日历 UI 与文案；`/calendar/oauth/*`、`/calendar/google/*` 路由、`services/calendar.py` 的 Google 实现、`google_*` 配置一并删除 |
| D2 | 视图集合 | 月 + 周 + 日 三视图（不做年视图） |
| D3 | 多日历 | 新增本地日历实体（分类 + 颜色 + 显隐），事件归属某个日历 |
| D4 | 交互深度 | 点击空白新建 + 周/日视图拖拽选区新建 + 点击事件浮层编辑/删除 |
| D5 | 视觉 | 苹果风：系统字体、hairline 细边框、红色当前时间线、彩色事件条；深浅色都要覆盖 |
| D6 | 重复日程 | **完整重复 + 例外**：支持「仅此次 / 此后所有 / 全部」三种作用域 |
| D7 | 提醒 | 站内提醒（不推送），复用 worker 扫描 |
| D8 | 默认日历 | 预置一个不可删的「个人」默认日历，其余可新建/改色/删除 |
| D9 | Git | 沿用当前脏树（`feat/chat-rich-text` 上的富文本改动不提交、不 stash），日历改动直接叠加 |

> 基线冲突须知：D1 与 `.sdd/personal-os/requirements.md` 中 REQ-D 的「第三方 OAuth」条目冲突。按用户指令移除能力，基线文档同步改写（保留第三方 MCP 部分不动）。

## 2. 数据契约（复用 `Record`，不新增业务表）

沿用 `records` 表：`kind` + `title` + `content` + `start_at` + `end_at` + `status` + `data`(JSON) + `extra`(JSON) + 五列审计字段。

### 2.1 日历 `kind="calendar"`
```json
{ "name": "个人", "color": "blue", "position": 0, "is_default": true, "visible": true }
```
- `title` = name 的副本（便于既有列表/搜索复用）。
- 调色板（服务端白名单）：`blue green orange red purple yellow pink teal brown gray`。
- 每个 owner 首次访问日历时自动补齐默认日历（`is_default=true`，`position=0`，`color=blue`）。
- 默认日历禁止删除（409）；删除非空日历必须带 `?move_to=<calendar_id>`，事件迁入目标日历，缺参返回 409 并给出事件数。

### 2.2 事件 `kind="event"`
```json
{
  "calendar_id": "<calendar id>",
  "location": "",
  "all_day": false,
  "timezone": "Asia/Shanghai",
  "rrule": null,
  "exdates": ["<ISO 起始时刻>"],
  "overrides": { "<ISO 起始时刻>": { "title": "...", "start_at": "...", "end_at": "..." } },
  "reminders": [10],
  "provider": "local"
}
```
- `start_at`/`end_at` 仍是表列（timestamptz，必须带时区）；全天事件取当地 00:00，`end_at` 为**排他**次日 00:00。
- `rrule` 为 RFC5545 子集：`FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`，可选 `INTERVAL`、`COUNT`、`UNTIL`、`BYDAY`（仅 WEEKLY）。用 `dateutil.rrule` 展开（`croniter` 已传递依赖，仍需在 `pyproject.toml` 显式声明 `python-dateutil`）。
- `reminders` 为提前分钟数数组（`0..10080`），最多 5 条。

### 2.3 站内提醒 `kind="notification"`
```json
{ "event_id": "...", "occurrence_start": "<ISO>", "minutes_before": 10, "title": "...", "body": "...", "dedupe_key": "sha256(event_id|occurrence_start|minutes_before)" }
```
- `status`：`unread` / `read`；`due_at` = 触发时刻（表列）。
- worker 每轮扫描「未来 1 小时内到点且未生成过」的提醒，用 `dedupe_key` 防止重复。

## 3. REST 契约（前后端唯一依据）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/calendars` | `{"items":[CalendarOut]}` |
| POST | `/api/calendars` | body `{name, color}` → 201 CalendarOut |
| PATCH | `/api/calendars/{id}` | body `{name?, color?, position?, visible?}` → CalendarOut |
| DELETE | `/api/calendars/{id}?move_to=` | → 202 `{"deleted":true,"moved_events":n}` |
| GET | `/api/events?start=&end=&timezone=` | 窗口查询，服务端展开重复实例 |
| POST | `/api/events` | → 201 EventOut |
| PATCH | `/api/events/{id}?scope=this\|following\|all` | `this`/`following` 必须带 `occurrence_start` |
| DELETE | `/api/events/{id}?scope=&occurrence_start=` | → 202 `{"deleted":true}` |
| GET | `/api/notifications?status=unread` | `{"items":[NotificationOut],"unread":n}` |
| POST | `/api/notifications/{id}/read` | → 202 `{"read":true}` |
| POST | `/api/notifications/read-all` | → 202 `{"read":n}` |

`CalendarOut = {id,name,color,position,is_default,visible,version}`

`EventOut` 在既有字段（`id,title,content,start_at,end_at,provider,version,created_at`）之上追加：
`calendar_id, all_day, location, timezone, rrule, reminders, recurring, occurrence_start, recurrence_id, is_override, is_exception`
- 重复事件的实例：`id` 保持**基础事件 id**（以便 PATCH/DELETE 复用），`recurrence_id` 同值，`occurrence_start` 为该实例原始起始时刻，`start_at/end_at` 为实例（含 override 后）的时间，`is_override` 标记被改过的单次。
- 窗口内展开上限 500 实例/事件，超出按窗口截断。

`NotificationOut = {id,title,body,event_id,occurrence_start,due_at,status,created_at}`

移除的端点：`GET /api/calendar/oauth/start`、`GET /api/calendar/oauth/callback`、`GET /api/calendar/google/events`、`PATCH /api/calendar/google/events/{id}`、`DELETE /api/calendar/google/events/{id}`、`POST /api/calendar/google/events/{id}/undo`、`POST /api/integrations/{id}/disconnect` 中与 Google 日历相关的分支（MCP 断开逻辑保留）。

`GET /api/settings`（configuration）响应中删除 `google_calendar_connection`。`/api/dashboard` 保留 `events` 键并携带新字段。

## 4. 前端结构与 CSS 类名契约（UI 与样式两个代理共同遵守）

```
.cal-shell > .cal-sidebar + .cal-main
.cal-sidebar: .cal-mini (+ .cal-mini-head .cal-mini-grid .cal-mini-cell .is-today .is-outside)
              .cal-lists > .cal-list-item(.is-off) > .cal-dot + .cal-list-name + .cal-list-actions
              .cal-list-add
.cal-main: .cal-toolbar > .cal-title + .cal-nav(.cal-nav-btn .cal-nav-today) + .cal-segmented(>button.is-active)
                          + .cal-bell(+.cal-bell-count) + .cal-new
.cal-body
月视图: .cal-month > .cal-month-head + .cal-month-grid > .cal-month-cell(.is-other-month .is-today .is-selected)
        > .cal-day-number + .cal-chip(style="--cal-color:…") + .cal-chip-more
周/日视图: .cal-timegrid > .cal-timegrid-head + .cal-allday-row(>.cal-allday-chip)
           + .cal-scroll > .cal-gutter(>.cal-gutter-slot) + .cal-cols(>.cal-col> .cal-col-slot + .cal-event-block(.is-short))
           + .cal-now-line + .cal-drag-ghost
浮层: .cal-pop > .cal-pop-head + .cal-pop-meta + .cal-pop-actions(+.cal-pop-danger)
提醒面板: .cal-bell-panel > .cal-notif(.is-unread)
```
颜色一律通过内联 `style={{ "--cal-color": color }}` 下传，样式侧用 `var(--cal-color)` 消费。

## 5. 任务切分（exclusive file ownership）

| 代理 | 独占文件 |
| --- | --- |
| A 后端 | `apps/api/**`（含 `alembic/versions/0002_*.py`、`pyproject.toml`） |
| C 日历 UI | `apps/web/src/components/workspace-pages.tsx`、`apps/web/src/lib/api.ts`、`apps/web/src/lib/messages/pages.ts` |
| D 日历样式 | `apps/web/src/app/globals.css` |
| 调度者 | `.sdd/**`、`docs/**`、分支/提交/PR |

不写新测试（用户既有要求）；只跑既有检查：`pytest`、`ruff`、`pnpm typecheck`、`pnpm lint`、既有 Playwright E2E。

## 6. 验收标准

1. 后端：`/api/calendars` 全套 + 事件 CRUD 带重复/例外/全天/提醒；Google 相关端点返回 404/405（已移除）；迁移后既有事件全部归入默认日历。
2. 前端：三视图可切换、侧栏日历可勾选显隐、点击/拖拽新建、点击事件浮层可改可删且能选三种重复作用域、铃铛能看到站内提醒并已读。
3. 视觉：390px 无横向溢出；深浅色均无 hairline 丢失；当前时间线为红色。
4. 既有 `/closed`、dashboard 预览、E2E 全绿。
