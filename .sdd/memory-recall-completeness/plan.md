# 实施与验证计划

1. 主agent独占memory.py和本轮文档；两个只读agent检查调用链、权限和性能，不重叠编辑。
2. 用服务端批次投影和标准库top-k替换500条ORM预截断，保留现有匹配语义。
3. 在临时PostgreSQL schema写入明确QA记忆，复现原501+遗漏；实际调用MemoryService及Agent工具，检查旧相关记录、来源、同分、空白、零命中、中文原有字面规则、长输入、状态/owner边界和异常关闭。
4. 检查执行计划/IO、游标批次与客户端内存；原始观察不能当生产负载承诺。
5. 运行既有Pytest/Ruff及必要Web/API验收，不增加或修改测试用例。只读复审后提交feature分支、PR，exact-head CI通过才合并main。
6. 保留模型网络、Hy/Jev外部验收和中文语义、任务Working Memory缺口；不重试已暂停的真实模型调用。
