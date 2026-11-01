# task_048 任务成果物解析
## 需求
CLI 输出解析出结构化成果物（文件改动清单/diff 统计），任务报告富展示。
## 要点
1. 输出解析器（纯函数）：提取「文件路径列表、+N/-M 行数、关键结论行」（各家 CLI 输出格式差异表）
2. 解析结果落 character_tasks.new_column（artifacts JSON）或独立表
3. 📋 报告气泡升级：文件清单折叠列表+改动统计徽标
4. 解析失败降级纯文本（不编造）
## 验收
- claude 实测任务报告显示文件清单与统计
- typecheck/jest 全绿

---

## 验证结果（task_048 执行后追加）

- **typecheck**：`npm run typecheck`（tsc --noEmit）0 错误；附 `typecheck:app` / `typecheck:tests` 同绿。
- **单测**：`npx jest --silent` → **133 套件 / 3032 通过 / 6 跳过 / 0 失败**（2980 基线 + 52 条新测试，无回归）。
  - 新增 `src/app/__tests__/task-artifacts.test.ts`（28 条）：diff 块解析（git diff / 裸 patch / 多 hunk 累加）/ CLI 摘要（英文 Updated…additions/removals、中文「修改了…新增 N 行」、diffstat 表）/ 路径行规约（bullet/动词前缀/:行号）/ 去重 / 层间合并不双计 / 降级（空串、纯叙述、URL/版本号不误伤）/ 序列化往返与坏形状宽容 / 渲染模型两态与 ≤10 折叠。
  - 新增 `src/app/__tests__/persistence/task-schema-v6.test.ts`（3 条）：全新库 v6、v5 库 ALTER ADD、v4 库五态重建+补列两步。
  - 扩展 task-report（4 条：报告两态 + 坏 JSON 降级 + failed 不附块）/ task-service（4 条：done 落列、前置快照不带、纯叙述缺省、failed 不带）/ task-record-dao（4 条：往返、相位覆盖、空串归一、v5 老表迁移）/ task-output-catalog（4 条：artifactsBlock 附尾）/ task-output-panel（3 条：附尾渲染 + XSS 零面、开工清空、不串台/空串清除）。
- **实现要点**：
  - `src/app/services/task-artifacts.ts`（新，纯函数永不抛）：三层提取（diff 块权威 → 摘要句 → 路径行存在性），summary 尾部优先；`formatTaskArtifactsBlock` 为报告与面板共用的渲染模型（files 空 → 空串，纯文本兜底）。
  - 落库：`character_tasks.artifacts TEXT NOT NULL DEFAULT ''`（schema v6，ALTER ADD）；task-service 仅在 `output` 非空时解析（占位文案不解析，避免假 summary）。
  - 报告：`buildTaskReportText` 尾部附「📎 摘要 + 📂 N 个文件 · +A/-B 行 + ≤10 条折叠清单」；解析为空格式与 039 逐字节一致。
  - 面板：`setTaskArtifacts(characterId, block)` 收渲染好的字符串（hud 不 import app/，铁律），新任务开工随流清空；IPC 校验 artifacts（string ≤100k 且可 JSON.parse）。
- **未尽事项**：summary-only（无文件有结论）已落库但报告/面板不单独展示（克制口径：正文已含全文，再摘一遍是噪音；未来消费方可放宽）。
