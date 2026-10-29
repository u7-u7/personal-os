# 自带日历与日程读取质量 · 2026-10-29

用户明确选择先用自带日历，不需要接入 Google Calendar。项目保留可选外部适配器，不再请求Google凭据或以其缺失阻塞当前本地使用与候选版；七天每日自动化的现有日程与截止日期保持不变，仅更新了优先级说明。

## 已实现

- Calendar默认自带日历；Google未连接显示中性说明与返回本地按钮，不调用外部events API。连接状态失败、已连接事件请求失败仍显示错误和重试。配置就绪时仍可走原OAuth；外部编辑/审批/撤销路径保留。
- 首页日历加载或失败时不再显示空闲；成功空数据明确限定为未来七天。
- 复用Record/list_events范围查询，Agent未来七天与简报未来24小时先筛发生时间、再按start_at/id排序，不再受创建时间100条截断；Dashboard取未来七天最早四条。
- 本地和已连接Google使用同一组start/end；24小时是滚动窗口，不是用户时区的自然日。HTTP /events数组与每页最多200条不变，无时间窗的内部None回退100。
- 无新增表、迁移、依赖、SQL JOIN或测试用例。Worker复用同一简报服务，无需重复实现。

## 本轮实际验证

真实PostgreSQL、独立QA账号的336条日程作为明确标记的输入。未修改原用户日历，也未复制模型Key。

| 检查 | 结果 |
| --- | --- |
| 旧读取对比 | 最近创建100条全部在未来七天窗口外 |
| 新范围与实际Agent工具调用 | 都返回221条；与独立全量窗口计算的ID集合及查询顺序一致 |
| 简报24小时数据查询 | 120条，ID集合与独立全量计算一致；不代表模型已生成简报 |
| 生命周期与范围 | 1条已软删除QA事件被排除；返回均为当前owner，已结束与远期事件被排除 |
| Dashboard真实认证API | 200，精确匹配未来七天最早四条 |
| 兼容性 | 默认无窗100条；内部None且无窗也100条 |
| 实际SQL EXPLAIN | Bitmap Index Scan ix_records_owner_events_range，29 shared-hit、0 read，0.440ms；小数据暖缓存，非生产基准 |
| 浏览器 | 默认本地可用；切Google显示可选说明、0红色错误；返回本地成功；API日志无Google events请求 |
| 响应式 | 390px时clientWidth=scrollWidth=390 |
| 现有检查 | 最终后端51 passed (6.21s)，E2E 1 passed (18.7s)，Ruff/TypeScript/ESLint通过 |

[脱敏数据读回](../evidence/local-calendar-readback.json)、[查询计划](../evidence/local-calendar-query-plan.json)、[默认本地](../evidence/local-calendar-default.png)、[可选说明](../evidence/local-calendar-optional-google.png)、[手机](../evidence/local-calendar-optional-mobile.png)。临时QA密码仅位于权限受限本机文件，没有进入报告。验收产生的旧E2E截图覆盖已恢复。

## 真实模型边界与后续

本轮从真实Web提交了只读list_calendar_events请求；模型调用准备阶段SSRF校验拒绝域名，未到达供应商。当前api.deepseek.com被本机代理DNS解析为198.18.0.78（非公网保留地址）。服务端审计保留chat.failed，页面明确报错，没有假回复。未修改代理设置、服务端网络信任或SSRF校验。用户选择先完成其他开发，本轮不再重试；真实工具选择和简报质量仍待此网络条件恢复后验收，旧的DeepSeek成功记录不算本轮通过。

Hy/Jev仍待授权；MCP受控公共服务仍待验收。Google分页/OAuth生命周期问题保留为可选适配器待办。高密度全量窗口会增大模型输入，保留既有超时/错误，不静默截断。任务与其它资源列表的独立容量问题未混入本次改动。

## 合并前审阅补充

独立审阅发现首版连接判断依赖最近100条integrations，新建很多MCP配置后会误判有效Google连接。已改为服务端google_connection按owner/provider/connected/deleted过滤后取一条，Settings仅投影id/version；calendar_token复用同一查询，Web复用共享Settings与id/version缓存key，Settings PATCH的内部调用已同步。

真实PostgreSQL事务内构造明确标记的Google连接元数据和101条较新MCP元数据：旧列表确实遗漏连接；新helper和真实Settings函数返回精确快照，响应不含extra/token，rollback后连接不存在。这只是连接状态的数据库验证，未持有Google凭据、未外呼、不是OAuth授权成功。实际helper SQL EXPLAIN使用ix_records_owner_kind_status_due（0.027ms、3 shared-hit、0 read；小数据暖缓存）。[连接快照验收](../evidence/local-calendar-connection-snapshot.json)、[查询IO](../evidence/local-calendar-connection-query-plan.json)。

最终已有后端51 passed（6.21s）、完整Web/API E2E 1 passed（18.7s），Ruff/TypeScript/ESLint通过，独立复审通过。API已重启；真实网页重新加载后Google可选说明正确显示。没有新增/修改测试用例。
