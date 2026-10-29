# 执行任务

- [x] TASK-01 REQ-01/02/03 DES-01/02 PLAN-01：MemoryService.delete委托持久清理服务；Store缺失读回、checkpoint逐批重放及完成回执。
- [x] TASK-02 REQ-04 DES-03 PLAN-01：MemoryService.confirm全程shared lease；删除/恢复claim至完成exclusive。
- [x] TASK-03 REQ-01/05 DES-04 PLAN-02：resume路由、原审批绑定、旧失败兼容、分页列表投影。
- [x] TASK-04 REQ-05/06 DES-05 PLAN-03：Activity恢复区，阶段/重试/待授权，移动端。
- [x] TASK-05 全REQ PLAN-04：现有Pytest/Ruff/Typecheck/Lint，独立真实PG/SDK故障与专用子进程终止恢复、>10000会话及跨owner哨兵，截图及容器E2E/CI/合并。

不写新测试文件；未实际执行的验收不预填完成。初始设计门槛已由工作区扫描及并行审阅支撑，用户已授权实现，无缺失业务决策。

本地实际结果：51项现有后端检查、Web E2E、真实故障/SDK恢复与UI验收已通过。发布门槛必须对当前提交运行CI和容器验收，通过后才按持续授权合并；远程结果写入PR，不预填旧证据。
