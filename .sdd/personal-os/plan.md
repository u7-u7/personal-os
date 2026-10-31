# 七天里程碑与实施顺序

| ID | 日期/目标 | 交付物 | 依赖/退出条件 |
|---|---|---|---|
| PLAN-01 | D1 基础架构 | PRD、设计、目录、认证、数据库迁移、Web shell、Compose | 空目录扫描完成；API health/注册和 DB 可运行 |
| PLAN-02 | D2 Agent 与记忆 | 流式聊天、LangGraph/checkpoint/store、MemoryService、Hy SDK 核查 | PLAN-01；真实模型/记忆 provider 有授权后验收 |
| PLAN-03 | D3 日常工作 | 任务、自带日历（苹果风三视图/多日历/重复例外/站内提醒）、简报 | PLAN-01；真实本地业务读写、冲突与隔离验证；Google 日历已于 2026-10-31 按用户决策连同后端一并移除 |
| PLAN-04 | D4 自动化 | Worker、周期调度、MCP、DecisionProvider | PLAN-02/03；重启恢复与重复 claim 验证 |
| PLAN-05 | D5 安全隐私 | 审批、审计、加密配置、导出/删除 | 横跨 PLAN-02/04；越权与敏感动作验证 |
| PLAN-06 | D6 联调稳定性 | Pytest、Playwright、Docker/CI、故障恢复 | 前述模块；完整测试报告不隐瞒跳过 |
| PLAN-07 | D7 开源候选 | README、架构、API、课程、演示、截图、PR | PLAN-06；完整矩阵，无假集成声明；按持续授权在检查和当前提交CI通过后合并main |

并行职责：主 agent 持有根配置、文档、Worker 和总体联调；backend agent 独占 API 核心；frontend agent 独占 apps/web；integration agent 独占 integrations/hy_memory.py、decision.py 与集成核查文档。接口变化先发消息，由主 agent 裁决；禁止同时改同一文件。
发布：迁移→API/Worker→Web→业务验收→feature push/PR。回退：停止 Worker，回退代码；保留迁移与数据，不盲目 downgrade。每个里程碑用实际证据更新状态，未发生的日期成果不能预填。
