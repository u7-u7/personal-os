# 实施计划

| PLAN | 产物 | 依赖 | 退出 |
| --- | --- | --- | --- |
| PLAN-01 | 进度服务/租约 | DES-01/02/03 | 真实Store/checkpoint失败后阶段可续，确认写不能复活 |
| PLAN-02 | 审批恢复与列表 | DES-04 | owner/版本/绑定/过期/并发拒绝正确，完成重放无新效果 |
| PLAN-03 | UI与阶段文案 | PLAN-02接口 | 页面可继续清理、不能把pending看成完成、错误可重试 |
| PLAN-04 | 验收/文档/PR/部署 | 前述 | 现有测试、真实PG/SDK重启/故障、Web/容器与远程CI通过后合并 |

主agent独占后端与根文档，UI agent独占workspace-pages/api.ts/messages；另外两agent只读审阅与验收建议。无新测试用例。无外部授权的Hy数据面验收保持blocked。
