# 日历可见范围完整性修复 · 2026-10-29

## 问题与改动

旧页面先取创建时间最近的100条日程，再在浏览器筛月份。新建较多其它日期的日程后，即使本月日程仍然存在，也会从日历消失。

本次复用Record表和 `ix_records_owner_events_range`，新增可选start/end窗口：校验成对、带时区且start<end，按半开区间重叠、owner/event/deleted条件过滤后，按start_at/id稳定分页。无window调用的旧数组、limit/offset合同不变。前端按完整42格计算本地午夜范围，逐页读取200条，全部成功才发布，切换月份传递AbortSignal。跨天事件每天显示，午夜end不额外占结束日；月份切换同步selected，loading/error不显示“当天无日程”。没有新增表、索引、迁移或测试用例。

## 真实数据库与API验收

所有种子均为明确标记的QA输入，位于独立账号；没有修改原用户日历或复制模型Key。336条事件含225条窗口内事件、110条较新窗外事件，以及位于窗口end的事件。

| 检查 | 本次实际结果 |
| --- | --- |
| 修复前窗口请求 | 只返回100条较新窗外事件，最早创建的本月目标缺失 |
| 修复后分页 | 200+25，225个唯一ID，目标及跨窗口事件存在，窗外0 |
| 时区等价 | +08:00与对应UTC查询首分页ID/顺序一致 |
| 参数边界 | 缺end、naive时间、相等、反向、limit201、offset-1均422 |
| 半开边界 | 查询end恰为事件start、查询start恰为事件end均不包含该事件 |
| 跨天/午夜 | 29日返回跨天及旧目标两条；28日仅跨天一条，前一晚午夜结束事件不计入28日 |
| 删除与隔离 | QA事件经应用审批软删除后不再返回；另一账号读取自己的事件，主账号重新读全页仍精确匹配225个预期ID |
| 旧API兼容 | 不传window仍返回数组和默认100条 |

## 页面与查询IO证据

隔离QA Web/API使用独立浏览器origin和同一真实PostgreSQL中的QA账号，保持原localhost账号Cookie、Key与日历不变。页面显示最早创建的本月目标；密集日议程有220个事件，最后一条window-219存在；午夜结束不计入下一天；Next month选中11月1日且显示10月31日延续事件。Google未连接时显示错误与重试，未误报空闲；没有请求真实Google服务。390px下clientWidth=scrollWidth=390。

截图：[完整窗口](../evidence/calendar-visible-window.png)、[手机](../evidence/calendar-visible-window-mobile.png)。临时QA服务和标签页已停止，临时凭据只在本机权限受限文件中使用，没有进入提交。

实际应用形状的 `EXPLAIN (ANALYZE, BUFFERS)` 使用范围索引Bitmap Index Scan，31个shared-hit、0个shared-read，0.485ms执行时间。[脱敏计划](../evidence/calendar-window-query-plan.json)。这是本地小数据暖缓存观察，不是生产负载基准，也没有用强制索引结果冒充正常planner选择。

现有后端51 passed（6.59s）、完整Web/API E2E 1 passed（18.2s）、Ruff/TypeScript/ESLint通过。UI全日日期解析、第二页失败的全量发布保护经过代码审阅；没有Google OAuth授权，因此不声称真实Google全天或分页集成验收通过。

## 保留边界

跨请求offset分页不提供并发写入快照；Google服务端nextPageToken分页与OAuth生命周期fence仍是独立待办。Agent工具、Dashboard和简报的日历读取上限本次未扩展，完整七天计划的相关质量验收继续保留。本次修复不自动启用Hy-Memory或Jev。
