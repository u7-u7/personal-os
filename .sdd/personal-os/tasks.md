# PersonalOS 可执行任务

所有需求保留；“有代码”“已本地验证”“外部验收通过”分开标记。

| TASK | 路径/产物 | 关联 | 完成条件与验证 | 状态 |
|---|---|---|---|---|
| TASK-01 | .sdd/personal-os、AGENTS.md、Git | PLAN-01/DES-06/REQ-K | 文档齐全，独立 feature 分支 | 进行中 |
| TASK-02 | apps/api/personalos/{main,models,services,auth} | PLAN-01/03/05、DES-02、REQ-C/D/E/H/I | 注册、隔离、CRUD/CAS、真实 DB 集成 Pytest | 待实现 |
| TASK-03 | apps/api/personalos/agent.py、memory service | PLAN-02/DES-01、REQ-A/B | 真 SSE、历史、持久 graph、确认记忆 | 待实现 |
| TASK-04 | apps/api/personalos/integrations | PLAN-02/04/DES-01/04、REQ-B/G/J | 官方 SDK 核查，provider 可替代，外部授权测试 | 调查中 |
| TASK-05 | apps/web | PLAN-01/03/05/DES-05、REQ-L | 9 路由真实 API、响应式/明暗/状态、Playwright | 待实现 |
| TASK-06 | apps/api/personalos/worker.py | PLAN-04/DES-03、REQ-F/E | 独立进程、claim/租约/失败恢复测试 | 待实现 |
| TASK-07 | compose.yaml、Dockerfile、CI、tests | PLAN-06/DES-06/NFR | 一键运行、后端安全测试与 UI 实测 | 待实现 |
| TASK-08 | docs、README、截图、GitHub PR | PLAN-07/DES-06/REQ-K | 可重复启动、课程、完整验收矩阵和 PR 链接 | 待实现 |

前置：TASK-01→其余；TASK-02 与 TASK-05 共享设计契约并行；TASK-03 依赖 TASK-02 和 provider 接口；TASK-06 依赖 TASK-02 数据契约；TASK-07/08 最终收敛。授权不足的真实外部测试标 blocked，不用 mock 替代通过。
