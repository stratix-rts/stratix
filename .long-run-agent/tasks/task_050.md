# task_050 派发智能推荐
## 需求
派任务时按 agent 特长+忙碌状态推荐承接人，支持手动指定。
## 要点
1. 派发表单增「交给谁」选择器：默认自动（推荐徽标）+ 各 agent 卡片（忙碌态实时）
2. 推荐算法纯函数：idle 优先 + suitableKinds 匹配（043 预设反向利用）+ 历史成功率（character_tasks 统计）
3. task.assign 命令扩展 targetKind 可选字段（缺省=自动）
4. 全忙时提示排队预计（FIFO 长度×平均时长）
## 验收
- 表单可见各 agent 忙闲与推荐；指定后任务进指定 agent 队列
- typecheck/jest 全绿

---

## 验证结果（task_050 执行记录）

**日期**：2026-10-25 · **分支**：refactor/game-v3 · **结果**：✅ 全部通过

### 验证输出

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（零错误）

$ npx jest --silent
Test Suites: 137 passed, 137 total
Tests:       6 skipped, 3127 passed, 3133 total
```

基线 3091 → 3127（+36 用例，无回归）。

### 改动文件

| 层 | 文件 | 内容 |
|---|---|---|
| core | `src/core/types.ts` | task.assign 增可选 targetCharacterId（缺省=038 行为） |
| core | `src/core/task/manager.ts` | 指定承接人直达目标队列；不存在 → error Notice 拒绝 |
| core | `src/core/runtime.ts` | targetCharacterId 透传 |
| hud | `src/hud/panels/task-assign-catalog.ts` | **新**：推荐纯函数（评分/排序/理由短语/排队预计），权重集中可调 |
| hud | `src/hud/panels/agent-panel.ts` | 表单「交给谁」选择器（自动卡+候选人卡片+排队提示）；统计打开时刷新 |
| hud | `src/hud/panels/agent-catalog.ts` | buildTaskAssignCommand 增可选 target |
| hud | `src/hud/screens/persona-presets.ts` | dedicatedPresetCount（suitableKinds 反向读数） |
| hud | `src/hud/screens/main-screen.ts` | MainScreenOptions.taskStats 透传 |
| hud | `src/hud/README.md` | Layout 说明补 task_050 |
| app | `src/app/services/persistence/task-record-dao.ts` | aggregateTaskStatusCounts（GROUP BY character_id, status + AVG 耗时） |
| app | `src/app/services/persistence/task-record.ts` | game:taskStats IPC 面 + reduceTaskStatRows + makeTaskStatsProvider |
| app | `src/app/main/main-entry.ts` | 组合根注入统计提供口 |
| electron | `src/electron/main.ts` / `src/electron/preload.ts` | game:taskStats IPC 通道 |
| tests | 新 2 个测试文件 + 扩 3 个（task-assign-catalog / task-record-stats；task.test / agent-panel.test / task-record-dao.test） |

### 推荐算法

`score = W.idle × 空闲(0|1) + W.specialty × 专属度(0–1) + W.successRate × 成功率(0–1)`，默认权重 0.5 / 0.3 / 0.2（`RECOMMEND_WEIGHTS` 集中可调）。
- **空闲**：在办任务数（queued+running+awaiting_approval）为 0 —— 用任务相位真相，不用 UnitView.status（后者只由 running 派生，排队中看着空闲其实接不动）。
- **专属度**：suitableKinds 点名该角色 kind 的预设数（`dedicatedPresetCount`），÷饱和常数 1 夹到 1。
- **成功率**：completed/(completed+failed)，无历史退 0.5 中性（不惩罚新角色不奖励它）。
- 排序：score ↓ → 在办数 ↑ → 原序稳定；第一位带「推荐」角标。理由短语「空闲 · 擅长此类 · 成功率 86%」按实际读数三段拼接，缺哪段不编。

### 验收对照（task_050.md 五条验收）

1. ✅ 自动推荐排序 + 三段式理由短语（含成功率百分比）—— `task-assign-catalog.test.ts` 评分排序/短语/中性值三组。
2. ✅ 「交给谁」选择器：自动（推荐）缺省 + 手动指定卡片（kind 徽标/忙闲实时/推荐角标第一位）—— `agent-panel.test.ts`「交给谁」describe 七用例。
3. ✅ 指定角色直达队列；不存在角色 error Notice —— `task.test.ts` 指定承接人三用例 + runtime 闭环。
4. ✅ 全忙排队预计：队列长度 × 历史均值，无历史「未知」—— `buildQueueEstimateHint` 用例 + 面板全忙提示用例。
5. ✅ 成功率统计经注入（DAO 聚合 → IPC → app 归约 → 打开表单时刷新一次）—— DAO GROUP BY 用真库断言 + provider 兜底用例。

### 未尽事项

- **缓存粒度**：统计快照在表单持有（打开时刷新一次），未做跨表单共享缓存对象 —— 单面板单表单场景下等价；未来多入口取统计时可在 app 层加带 TTL 的 memo。
- **预计口径**：running 任务的剩余时长按整段均值近似（无中途进度真相），队首正在跑的活按满时长估计 —— 偏保守，宁多报不少报。
- **推荐无「任务类型」维度**：任务为自由文本、无 kind 可正向匹配，suitableKinds 反向匹配是角色侧静态先验；后续若任务带结构化分类，可加正向匹配项（权重位已留）。
