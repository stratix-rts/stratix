# task_144

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_144.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

输入面重造：单行input到多行composer-模块

用户原话：「命令输入的文本框是最基础的人和应用交互点……肉眼难辨的小区域如何让用户输入大段提示词」。
产品本质是 agent 指挥台 —— **prompt 就是产品**，输入面必须配得上。

## 交付物

| 文件 | 作用 |
|---|---|
| `src/hud/panels/prompt-composer.ts`（新增） | 提示词 composer：自动长高 / 键位（Enter、Shift+Enter、⌘Enter、Esc）/ IME 合成保护 / ↑↓ 历史导航（localStorage 50 条）/ 粘贴后长高。纯 DOM 组件，零业务依赖 |
| `src/hud/panels/command-panel.ts`（改） | 输入面重造：单行 `<input>` → 多行 `<textarea>`；紧凑条形态改两行（composer 独占第 1 行铺满整行）；聚焦描边 + 微光晕；字号 14px；回执区 xs(11px)→sm(12px) + 长输出内滚；多行/长自由文本回车走任务通路 |
| `src/hud/__tests__/prompt-composer.test.ts`（新增） | composer 键位契约单测（15 例） |
| `src/hud/__tests__/command-panel.test.ts`（改） | 面板层回归（+6 例：多行编辑区 / Enter 执行 / Shift+Enter / IME / 提示词任务通路 / 卸载不泄漏） |
| `tests/e2e/prompt-composer.spec.ts`（新增） | e2e 验收（6 例）：800 字粘贴 / 真 IME 合成 / 历史导航 / 聚焦对照 / 像素皮 / 五命令回归 |
| `tests/e2e/playwright.prompt-composer.config.ts`（新增） | 不杀端口的 playwright 配置（复用 7523，**不动网关 7524**） |
| `tests/e2e/command-line.spec.ts`（改） | 选择器 `input[data-role="query"]` → `textarea[data-role="query"]`（输入面换了元素） |
| `reports/shots/prompt-composer-r7-*.png` | 截图证据：blur / focus / longtext / pixel |

## 验证证据（完成前必填）

- [x] **实现证明**
  - 输入面：`data-role="query"` 由 `<input type="search">` 换成 `<textarea rows="1">`；
    高度由 `PromptComposer.autoGrow()` 按 `scrollHeight` 走（≤10 行后 `overflow-y:auto` 内滚），
    紧凑条形态下多行时**脱流浮到控制岛上方**（就地长高会把岛顶出屏幕，岛是底对齐的）。
  - 键位：Enter 提交 / Shift+Enter 换行 / ⌘Enter 必交 / Esc 清空草稿（再按一次失焦）。
  - IME：`isComposing` / `keyCode 229` / 自维护合成标记三层判据；
    合成标记用 **微任务**解除（实测 setTimeout 会被浏览器后排，合成态迟迟不解除 → 回车永远提交不了）。
  - 历史：↑↓ 只在光标位于首/末行时接管，中部光标不抢键；localStorage 存最近 50 条。
  - 视觉：字号 `--srf-font-size-md`(14px)、聚焦 `border-color: var(--srf-accent)` + 双层 `color-mix` 光晕、
    `prefers-reduced-motion: reduce` 下 `transition: none`；全部走 `--srf-*` token（像素皮自动跟随）。
  - 自由文本通路：多行 / >80 字的未命中输入 → 走既有任务通路（新建任务对话框预填），
    不新造 core 契约（面板能落地的出口只有既有契约）。

- [x] **测试验证**
  - `npx tsc --noEmit` → exit 0（无输出）。
  - `npx jest src/hud --maxWorkers=2` → **69 suites / 1309 tests 全绿**。
  - `npx playwright test --config=tests/e2e/playwright.prompt-composer.config.ts` → **13 passed**
    （含既有 command-line.spec.ts 7 例全回归）。
  - 截图（reports/shots/）：`prompt-composer-r7-blur.png` / `-focus.png` / `-longtext.png` / `-pixel.png`。

- [x] **影响范围**
  - 只动命令面板的**输入区**：命令面板（src/hud/panels/command-panel.ts）+ 新增 composer 模块 + 两处测试 + e2e。
  - 未动 gateway（7524 进程全程在跑）、session-panel、z-index 结构、控制岛高度预算（实测岛高 96px ≤ 100px 上限）。

### 测试步骤

1. `npx tsc --noEmit` → exit 0
2. `npx jest src/hud --maxWorkers=2 --silent` → 69 suites / 1309 tests passed
3. `npx playwright test --config=tests/e2e/playwright.prompt-composer.config.ts` → 13 passed
   （该配置不挂 globalSetup / 不管 webServer —— 不杀 7523/7524）

### 验证结果

```
Test Suites: 69 passed, 69 total
Tests:       1309 passed, 1309 total

Running 13 tests using 1 worker
  ✓  command-line.spec.ts × 7（五命令 / 中文别名 / mission / theme / settings / replay / help 完整可见）
  ✓  prompt-composer.spec.ts × 6（800 字粘贴 / IME 合成 / 历史导航 / 聚焦对照 / 像素皮 / 五命令回归）
  13 passed (10.6s)
```

关键实测数据（调试脚本）：
- 800 字 7 行中文提示词粘贴后：`value.length === 原文长度`、`data-expanded="true"`、
  `scrollWidth <= clientWidth`（无横向溢出）、控制岛 `scrollWidth <= clientWidth`。
- 回执区：fontSize 12px（原 11px），help 清单 `clientWidth=632 / scrollHeight=clientHeight=109`（不裁）。
- 控制岛高度 96px（上限 100px），composer 铺满整行 792px。

### 未尽事项

- 多行/长自由文本目前落到**任务标题**通路（既有契约能落地的唯一出口）；
  真正的「把提示词直接派给 agent」需要 core 加契约 —— 属后续任务，本次未动 core。
- 自由文本门槛（>80 字 / 含换行）是启发式：短句提示词仍按命令解析（「瞎敲的」照旧给命令清单，既有反馈不变）。
