# 实施计划

| PLAN | 产物 | 依赖与退出条件 |
| --- | --- | --- |
| PLAN-01 | 基线复现及REQ/DES | 实际任务1→2和旧unknown被遮住已记录；REQ-01..04全覆盖 |
| PLAN-02 | DES-01/02服务和Worker | backend独占execution_safety.py/worker.py；根agent接通Agent所有写工具与简报；只读review不编辑 |
| PLAN-03 | DES-03/04 HTTP/Scheduler | 根agent接通automations.py/main.py，全历史守卫及锁；核心控制语义明确 |
| PLAN-04 | 本轮实际验收/报告 | 先真实PG手工回读，再运行已有检查；失败修复后重新验证，不新增测试用例 |
| PLAN-05 | feature PR与协调运行 | 当前提交CI通过再按授权合并main；镜像同一构建，不混用新旧Agent/Worker/API |

实施授权来自用户持续开发与当前heartbeat；不需要外部服务授权，因此不恢复暂停的模型检测。性能/兼容/回退见design，保留roadmap全部其他任务。
