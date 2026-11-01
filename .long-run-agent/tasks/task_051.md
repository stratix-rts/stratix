# task_051 多 agent 流水线
## 需求
任务模板编排多 agent 串行协作（如 claude 实现→kimi 审阅），中间件核心能力。
## 要点
1. core 增 pipeline 模型：steps[{kind,promptTemplate,dependsOn}]；上一站 output 注入下一站模板变量 {{prev_output}}
2. HUD 派发高级模式：预设模板 2-3 个（实现+审阅/翻译+校对/分析+总结）+ 自定义步骤
3. 执行编排器（app 层）：逐站派发、失败中断（后续站 skipped）、全链状态可见（战场各站单位依次 busy）
4. pipeline 记录落库（独立表或 character_tasks 关联 pipeline_id）
## 验收
- 两站流水线实测跑通：A 完成→B 自动接续，产出可见
- typecheck/jest 全绿

---

## 验证结果（task_051 完成回执）

- **typecheck**：`npm run typecheck` → 0 错误。
- **jest**：`npx jest --silent` → **143 套件 / 3182 通过 / 6 skipped / 0 失败**（3127 基线 +55 新测，零回归）。
- **新增测试分布**：
  - `src/core/__tests__/task-pipeline.test.ts`（11）：模板渲染 / 截断边界（保头截尾+注明）/ 承接人解析 / 规格与议题校验。
  - `src/app/__tests__/pipeline-service.test.ts`（11）：成功链（全文 prev_output 续站）/ 中断链（尾站失败、中段失败后续全 skipped）/ 角色缺失跳站（kind 无在档 + 显式 id 不在档）/ 取消断链（总线路径）/ 兜底路（微任务推进）/ 两路竞速幂等 / 指定目标入队 / 终态判定（含全跳 degenerate completed）/ feed 读数 / 落库序列与 steps JSON。
  - `src/app/__tests__/persistence/pipeline-record-dao.test.ts`（6）：建表幂等 / upsert 往返与终态覆盖 / 倒序 / 词表外 status 防御归一 / 新库 pipeline_id 往返 / v7 旧表 ALTER ADD 迁移 / CASE 守卫（相位快照不抹归属）。
  - `src/app/__tests__/persistence/task-schema-v8.test.ts`（4）：全新库 / v7 / v6 / v4 四起点迁移 → v8（pipeline_id 列 + pipelines 表 + 版本 8 + 老数据零丢失 + 站快照可写可读）。
  - `src/hud/__tests__/pipeline-catalog.test.ts`（8）：预设 3 个契约形状 / 相位徽标映射（✓/✗ 锁口径）/ 卡片模型（跳过站占位「第 N 站」）/ 命令构造（预设 / 自定义 / 四种拒绝路径）。
  - `src/hud/__tests__/agent-panel-pipeline.test.ts`（8）：模式切换控件互斥 / 预设列表 + 自定义两站下拉 / 预设与自定义提交派发 pipeline.start / 拒绝路径不发不关 / 实时卡片渲染与相位迁移 / 断链读数 / 卸载退订。
- **收尾**：`task_list.json` 已置 task_051 = completed；本文件已补验证结果区；提交 `v3(task_51): 多agent流水线`（选择性 add，只含改动文件）。
- **未尽事项（不阻塞验收，已注记在相应文件头）**：
  1. `pipelines.status='running'` 的行在应用重启后是停机遗骸（不复活不回滚，审计可见 —— 与 049 挂单同取舍；见 pipeline-record-dao.ts 文件头存活语义注）。
  2. 流水线不额外发 exp（各站照常按单任务发，不双计 —— 见 pipeline-service.ts 文件头禁止事项 4）。
  3. world 无单位特殊 fx：各站 busy 由既有任务链路自然呈现（需求④的轻量口径）。
  4. 自定义两站的角色下拉在表单打开时构建一次，不随档案广播实时重建（草稿不能被冲掉 —— 见 agent-panel.ts 取舍注）。
