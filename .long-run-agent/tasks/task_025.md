# task_025

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_025.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 代码 + 测试

## 描述

hud: 首启向导屏（扫描报告→起名+皮肤→人设生成→完成 四步）-模块

## requirements

src/hud/screens/onboarding-screen.ts WebComponent 向导四步：①扫描报告（复用 detectedAgents，已装高亮+tier 标签）②逐 agent 起名+随机皮肤（可换）③人设生成（3-4 题问答拼装 persona 模板，预览可编辑）④确认→character.create→完成。覆盖层 z-index 50 规范同其他子屏。

## design

依赖 task_021/022/024 完成后可联。样式走既有 token 体系，无硬编码色值。

## acceptance

- tsc 零错误
- 步骤流转/表单校验/提交事件的单测
- jest src/hud 全绿

## 交付物

按 design 落地的新增/修改文件 + 对应测试

## 验证证据（完成前必填）

- [x] **实现证明**: 拆两层 —— `src/hud/screens/onboarding-catalog.ts`（纯逻辑：扫描报告派生 / 名字校验 / 人设问答拼装 / 建档清单）+ `src/hud/screens/onboarding-screen.ts`（`<strat-onboarding-screen>` Web Component，四步流转与渲染）。
  ① 扫描报告读 `WorldState.detectedAgents`（已装高亮 + tier 标签 + T2/T3 标「仅探测」）；
  ② 起名清单 = 已装 ∩ core `AGENT_KINDS`（只有 T1 五家可建档），默认名 = agent 显示名，皮肤由 `skin-registry` 抽签（`skinSource` 可注入 → 测试可复现），可换肤；
  ③ 4 题问答（每选项自带 fragment）拼装 persona，以 core 默认人设模板打底，预览可直接改（改过之后答案不再覆盖）；
  ④ 确认 → 逐条 `character.create` → `onboarding-complete` DOM 事件 → `ui.navigate main`。
  覆盖层 `:host { position:absolute; inset:0; z-index:50 }`，与 main-screen 的 `.hud-sub-screen` 同规范；样式全走 `--srf-*` token（本文件零色值字面量）。
- [x] **测试验证**: typecheck + 对应目录 jest 输出原样贴出（见下）
- [x] **影响范围**: 新增 3 个文件，未改动任何既有文件；不碰 src/core、src/world、src/app；未引入新依赖。

### 验证结果

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（零错误，无输出）

$ npx jest src/hud --silent
Test Suites: 17 passed, 17 total
Tests:       370 passed, 370 total
Snapshots:   0 total
Time:        3.179 s
```

新增用例（`src/hud/__tests__/onboarding-screen.test.ts`，27 例）：扫描报告渲染与广播联动、已装高亮/tier/仅探测标记、
可建档名单口径、名字校验（空/超长/重复/码点长度）、换肤、人设问卷与可编辑预览、提交命令序列与完成事件、
用户数据转义、卸载退订、步骤条状态。

