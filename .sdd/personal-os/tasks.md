# PersonalOS 可执行任务

所有需求保留；“有代码”“已本地验证”“外部验收通过”分开标记。

| TASK | 路径/产物 | 关联 | 完成条件与验证 | 状态 |
|---|---|---|---|---|
| TASK-01 | .sdd/personal-os、AGENTS.md、Git | PLAN-01/DES-06/REQ-K | 文档齐全，独立 feature 分支 | 已完成：独立仓库、设计和feature分支 |
| TASK-02 | apps/api/personalos/{main,models,services,auth} | PLAN-01/03/05、DES-02、REQ-C/D/E/H/I | 注册、隔离、CRUD/CAS、真实 DB 集成 Pytest | 本地API/安全验证通过；第三方授权待验收 |
| TASK-03 | apps/api/personalos/agent.py、memory service | PLAN-02/DES-01、REQ-A/B | 真 SSE、历史、持久 graph、确认记忆 | 真实框架/PG协议测试通过；外部模型待授权 |
| TASK-04 | apps/api/personalos/integrations | PLAN-02/04/DES-01/04、REQ-B/G/J | 官方 SDK 核查，provider 可替代，外部授权测试 | SDK核查与provider契约通过；Hy数据面/Jev服务待授权 |
| TASK-05 | apps/web | PLAN-01/03/05/DES-05、REQ-L | 9 路由真实 API、响应式/明暗/状态、Playwright | 九页代码、生产build和真实API浏览器流程通过 |
| TASK-06 | apps/api/personalos/worker.py | PLAN-04/DES-03、REQ-F/E | 独立进程、claim/租约/失败恢复测试 | 6项PG事务测试及独立进程/容器Worker验证通过 |
| TASK-07 | compose.yaml、Dockerfile、CI、tests | PLAN-06/DES-06/NFR | 一键运行、后端安全测试与 UI 实测 | API/Web镜像与全Compose浏览器通过；远程CI待PR执行 |
| TASK-08 | docs、README、截图、GitHub PR | PLAN-07/DES-06/REQ-K | 可重复启动、课程、完整验收矩阵和 PR 链接 | 文档/截图/完整报告已生成；PR与远程CI收敛中 |

前置：TASK-01→其余；TASK-02 与 TASK-05 共享设计契约并行；TASK-03 依赖 TASK-02 和 provider 接口；TASK-06 依赖 TASK-02 数据契约；TASK-07/08 最终收敛。授权不足的真实外部测试标 blocked，不用 mock 替代通过。

## 外部验收门槛（保留完整需求）

- [ ] 用户的DeepSeek/OpenAI兼容Key：真实流式/工具选择/记忆提取与简报质量。
- [ ] Google OAuth应用配置与用户consent：真实日历查询/改删/撤销/冲突读回。
- [ ] Hy Memory完整数据面和embedding授权：Chat/Working真实读写、冲突、跨进程持久化、所有索引缓存历史删除。
- [ ] Jev真实System One服务与标注评测；当前规则/普通LLM为显式替代。
- [ ] 管理员allowlist的受控public HTTPS MCP：真实工具发现/审批/执行。
- [ ] GitHub Actions远程通过、全Compose Web业务复验、候选版最终验收。

最新状态与命令证据见 `docs/verification.md`，不能把adapter实现或fixture通过当外部集成完成。
