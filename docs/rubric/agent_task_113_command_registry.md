# task_113 —— 命令行命令注册表（P1）

> 死功能 #2：底栏命令行（`<strat-command-panel>` 的搜索框）此前只做模糊搜索、Enter 毫无反应，
> placeholder 承诺的「mission / 主题 / 设置」实测全是「没有匹配的命令」。

## 方案

**词表只有一份**。新增纯逻辑模块 `src/hud/panels/command-registry.ts`（零 DOM、零总线依赖，node 可直测）：

- `CLI_COMMANDS` —— 五条命令的词表（`mission` / `theme` / `settings` / `replay` / `help`），含
  中文别名（底栏提示词早就承诺过「主题 / 设置」）、用法串、一句话说明、参数必填标记、白名单参数。
- `parseCliInput(raw)` —— 可判别的五态联合：`empty` / `matched` / `missing-arg` / `invalid-arg` / `unknown`。
  参数取「第一个词之后的整段」（任务标题里的空格不能丢）；未命中给**子序列近似候选**（`sett` → `settings`）。
- `cliHelpText()` / `cliUnknownText()` / `cliUsageHint()` / `cliUsageList()` —— 文案全部从同一份词表派生，
  所以「help 列出来的」与「真能敲的」必然同源（两份清单迟早对不上 = 又一个假入口）。

**why 不并进 `command-catalog.ts`**：command-catalog 是**按钮目录**（点一条 = 一条 HudCommand，可用性看当前
WorldState）；本注册表是**命令行目录**（敲一串 = 一次带参调用，可用性只看输入串本身）。形态不同、判定口径不同，
混在一处必然互相污染。

**执行落在面板**（`command-panel.ts`）：搜索框回车即执行，回执写进面板自己的 `data-role="output"` 区
（`textContent` 写入，不走 innerHTML），**不甩到 toast** —— 命令就在眼前，回执也得在眼前。

| 命令 | 落地面 | 契约 |
|---|---|---|
| `mission <标题>` | 复用 `NEW_TASK_OPEN_EVENT`（task_112 通路），标题草稿同步成同一句 | DOM 事件（组合根开对话框） |
| `theme` | 派 `theme.set`，真切 token 样式表 | `HudCommand` |
| `settings` | 派 `ui.navigate` | `HudCommand` |
| `replay` | 走组合根建的**同一个**回放控制器（与底栏回放条共用一份） | 注入的控制器接口 |
| `help` | 列全部可用命令 | — |

**不假装成功**：theme 派出去后核对皮肤有没有真换掉（没换 = handler 没接上，如实说「皮肤系统接入中，请到设置页操作」）；
replay 三种落点各有话可说 —— 没接控制器 / 读失败（网关没连上）/ 今天没活儿，都是**人话 + 重试指引**，不给错误码。

## 途中修掉的一个真 bug

Chromium 下 `style.disabled = true`（IDL 属性）**不反射**成同名 content attribute（实测
`hasAttribute('disabled')` 仍为 false）。于是 `style[data-srf-theme]:not([disabled])` 会把**两张表都**算成
「启用」，`querySelector` 永远取到第一张 —— 皮肤换了，探测却说没换，命令回执谎报「皮肤系统接入中」。

修法：读 IDL 属性（`!node.disabled`）而不是 CSS 属性选择器；jsdom 干脆没实现
`HTMLStyleElement.disabled`（读出 undefined），所以用 `!node.disabled` 而不是 `=== false`。

## 验证

- `npx tsc --noEmit` —— 本任务文件零报错（余下两处报错在 task_117 的 `mode-strip.ts`，不在本任务范围）。
- `npx jest src/hud/__tests__/command-line.test.ts src/hud/__tests__/command-panel.test.ts` —— 38 例绿。
- `npx playwright test tests/e2e/command-line.spec.ts` —— 5 例绿（逐条命令真浏览器实测）。
- 真实浏览器里逐条敲的回执原文：

```
mission 重构总线验收 → 已打开新建任务对话框，标题已预填「重构总线验收」
theme                → 已切换到像素风（再敲一次 theme 切回去）   [当前皮肤: pixel]
theme                → 已切换到现代风（再敲一次 theme 切回去）
replay               → 今天还没有任务记录 · 跑一条任务就有回放了（再敲一次「replay」重试）。
help                 → 可用命令：mission <标题> · theme [default|pixel] · settings · replay · help …
瞎敲的               → 没有匹配的命令「瞎敲的」 可用命令：mission <标题> · theme … · replay · help
```

## 影响范围

只动 HUD 面板层 + 命令面板的挂载入参。`src/hud/screens/main-screen.ts` 是**并行任务共享文件**，
本任务只提交了自己那一个 hunk（把回放控制器注入命令面板），其余 115 / 117 的未提交改动原样留在工作区。
