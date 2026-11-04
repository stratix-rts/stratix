# task_152

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_152.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

onboarding跳过/完成后浮层不退场修复-模块

## requirements

1. 判定「浮层不退场」的真实根因：跳过 / 完成两个 handler 是否只写标记而没触发 DOM 拆除；
   「下一步」三步走完的完成路径是否同病；ESC 能否关掉引导（按 146 的栈顶语义）。
2. 退场后**底层交互必须完全恢复**（不能留一层吃掉点击的全屏壳）。
3. 顺带定位用户实测的「模态框遮挡页面」到底是谁（实测发现是 ⌘K 命令面板的遮罩挂载即可见）。
4. 最小改动；零新依赖；不动引导文案与步骤设计；不动 146 堆叠秩序 / 147 token；不动 gateway/；
   不动 HEARTBEAT.md / .long-run-agent（除本文件）/ reports/（截图除外）。
5. 先 commit 再打最终输出。

## acceptance

- [x] 「跳过」→ 浮层当场消失 + 交互恢复 + 标记写入（playwright 断言）
- [x] 三步走完「完成」→ 同样当场退场
- [x] ESC 能关掉引导（焦点不在引导里也生效）
- [x] 二次打开不再现（既有持久化口径不破坏）
- [x] `npx tsc --noEmit` 零错 + onboarding 相关 jest 全绿
- [x] 截图带 `-r10` 前缀

## 交付物

### 一、根因（实测定位，两处，都不是"引导文案/步骤设计"问题）

**根因 A：⌘K 命令面板的遮罩一直铺在全屏上（这才是用户说的「模态框遮挡页面 / 糊屏」）**

`src/hud/components/command-palette/command-palette.ts`（task_150 引入）：

1. `connectedCallback()` 只调 `renderChrome()`（造 DOM），**没调 `render()`** ——
   而 `render()` 是唯一给遮罩 / 面板打 `hidden` 的地方。于是「关着的命令面板」的遮罩是
   **可见的、全屏的、`pointer-events: auto`**：`background: var(--srf-backdrop)` = rgba(9,11,16,0.72)
   糊住整个页面，且吃掉页面上**所有**点击。
2. 就算补上 `hidden` 属性也不够：`.panel` 自带 `display: grid`（作者样式）——
   **作者样式压过 UA 的 `[hidden]{display:none}`**，面板仍会被画出来。必须组件自己压一条 `display:none`。

实测（修复前）：`document.elementFromPoint(顶栏「更多」按钮)` → `strat-command-palette`（点击被吃）；
像素对照：遮罩在 → 战场 `[21,23,30]`；遮罩不在 → 战场 `[83,112,163]`（亮）。

**用户为什么看到的是"引导不拆"**：聚光引导的浮层在 z=60（spotlight），命令面板遮罩在 z=50（modal）——
引导浮在遮罩**上面**，所以用户点得到引导的「跳过」（标记确实写进去了），
引导退场后**页面仍旧被命令面板的遮罩罩着**（发暗 + 点不动）= 「当场浮层不拆，糊屏直到刷新」。

**根因 B：聚光引导的退场只"隐藏"不"拆除"，且 ESC 收不到**

`src/hud/components/onboarding-tour/onboarding-tour.ts`（task_139 引入）：

3. `finish()` 只写标记 + `this.hidden = true` —— 宿主里**永久留下**一个
   `position:fixed; inset:0` 的全屏浮层壳（显示层虽隐藏，它仍是"一层浮层"）；
   重复挂载时更会叠两层（点掉上层还剩一层）。
4. `keydown` 监听挂在**元素自己**身上 —— keydown 从焦点所在元素**向上**冒泡，
   引导没被点过（焦点还在 body）时事件永远流不到这个未聚焦的兄弟节点 → **ESC 根本关不掉引导**。

### 二、改动（最小改动，零新依赖）

| 文件 | 改动 |
|------|------|
| `src/hud/components/command-palette/command-palette.ts` | ① `connectedCallback` 补 `this.render()`（落关闭态）；② 样式表补 `.backdrop[hidden], .panel[hidden] { display: none; }` |
| `src/hud/components/onboarding-tour/onboarding-tour.ts` | ① `finish()` = 写标记 → 隐藏 → 派事件 → **真拆 DOM**（`this.remove()`），且幂等；② ESC 监听从元素改挂 `ownerDocument`（断连时摘掉）；③ `start()` 发现已走过 → 直接拆掉本体；④ `mountOnboardingTour` 幂等：同一宿主先清旧实例（杜绝"两层叠着"） |
| `src/hud/screens/main-screen.ts` | ESC **栈顶语义**：顶栏弹层开着时，这次 ESC 归弹层（`stopImmediatePropagation`），下层浮层不跟着关 |
| `tests/e2e/onboarding-tour-dismiss.spec.ts`（新） | 退场四路径 e2e（跳过 / 完成 / ESC / 二次打开不现）+ 交互恢复断言 + `-r10` 截图 |
| `tests/e2e/onboarding-tour.spec.ts` | task_139「两皮肤截图」用例：ESC 口径更新（ESC 现在关引导）—— 截图挪到 ESC 之前，画面内容不变 |
| `tests/e2e/playwright.onboarding-tour.config.ts` | testMatch 纳入新 spec |
| `src/hud/__tests__/{onboarding-tour,command-palette,main-screen}.test.ts` | 单测：退场拆 DOM / ESC 无焦点也生效 / 重复挂载只剩一个 / 遮罩挂载即隐藏 / ESC 栈顶吃掉 |

**没动**：引导文案与步骤设计、146 堆叠秩序（layer-tokens.ts 未改）、147 token、gateway/、零新依赖。

### 三、口径澄清（与任务书的一处出入，已按仓库既有语义执行）

任务书写「引导期间底层不可交互是对的（聚光蒙层语义）」——**本组件的既有语义相反**：
聚光引导的蒙层 `pointer-events: none`，用户可以照着提示直接点下面的界面
（组件头注释「③ 拦底下界面」明写；task_139 的 e2e 也在引导开着时点顶栏「更多」切皮肤）。
改成"引导期间锁死底层"会与 task_139 的既有用例冲突，故**保持原语义**；
任务书真正要的那半句「**退场后必须完全恢复交互**」已落实（退场即拆 DOM + 遮罩不再吃点击）。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上「根因 A/B」—— 命令面板遮罩挂载即隐藏 + 显式 display:none；引导退场真拆 DOM + ESC 挂 document + 挂载幂等
- [x] **测试验证**: 单测 3 个文件新增 10 例；e2e 新增 4 例；`npx tsc --noEmit` 0 错；`npx jest` 全量 293 套件 / 5358 例全绿
- [x] **影响范围**: 只影响 onboarding 聚光引导、⌘K 命令面板、顶栏弹层的 ESC 归属；gateway/ 与 world 层零改动

### 测试步骤

1. `npx jest src/hud/__tests__/onboarding-tour.test.ts src/hud/__tests__/command-palette.test.ts src/hud/__tests__/main-screen.test.ts`
2. `npx tsc --noEmit`
3. `npx jest --silent --maxWorkers=2`（全量）
4. `npx playwright test --config=tests/e2e/playwright.onboarding-tour.config.ts`（复用已在跑的 7523，不动 7524 网关）
5. `npx playwright test --config=tests/e2e/playwright.command-palette.config.ts`（⌘K 面板回归）

### 验证结果

**单测**（`npx jest src/hud/__tests__/onboarding-tour.test.ts src/hud/__tests__/command-palette.test.ts src/hud/__tests__/main-screen.test.ts`）：

```
PASS src/hud/__tests__/onboarding-tour.test.ts
  轻引导退场（task_152）
    ✓ 跳过 → 浮层本体当场拆掉（不只是隐藏）+ 写标记 + 派事件
    ✓ 三步走完「完成」→ 同样当场拆掉
    ✓ ESC → 退场（焦点不在引导里也生效：监听挂在 document 上）
    ✓ ESC 在已退场后不再重复收场（不重复派事件）
    ✓ 重复挂载 → 宿主里只留一个浮层（杜绝「点掉一层还有一层」）
PASS src/hud/__tests__/command-palette.test.ts
  关着的时候不能挡页面（@since v3.9，task_152）
    ✓ 挂载即关闭态：遮罩与面板都带 hidden（不铺在全屏上）
    ✓ 样式表里显式压掉 hidden 的 display（作者样式压过 UA 的 [hidden]）
    ✓ 打开 → 遮罩与面板现身；关闭 → 又藏回去
PASS src/hud/__tests__/main-screen.test.ts
    ✓ ESC 收起弹出层，并把这次键击吃掉（下层浮层不跟着退场）
    ✓ 没有弹层开着：ESC 不被吃掉（下层浮层照常能收场）
Test Suites: 2 passed, 2 total   Tests: 31 passed, 31 total
```

**类型检查**：`npx tsc --noEmit` → 0 错误（exit 0）

**全量单测**：`npx jest --silent --maxWorkers=2` →
`Test Suites: 293 passed, 293 total / Tests: 6 skipped, 5358 passed, 5364 total`

**e2e（退场四路径 + 任务书验收）**：

```
✓ 1 tests/e2e/onboarding-tour-dismiss.spec.ts:64  › 点「跳过」→ 浮层当场消失 + 交互恢复 + 写标记 (2.5s)
✓ 2 tests/e2e/onboarding-tour-dismiss.spec.ts:84  › 三步走完「完成」→ 同样当场退场 (2.3s)
✓ 3 tests/e2e/onboarding-tour-dismiss.spec.ts:107 › ESC 关闭引导生效（焦点不在引导里也关得掉） (2.2s)
✓ 4 tests/e2e/onboarding-tour-dismiss.spec.ts:126 › 二次打开不再现（持久化口径不破坏） (4.1s)
✓ 5 tests/e2e/onboarding-tour.spec.ts:87   › 首开三步引导真走通：1/3 → 2/3 → 3/3 → 完成；二次打开不再现 (4.5s)
✓ 6 tests/e2e/onboarding-tour.spec.ts:112  › 跳过路径：点「跳过」即收起 + 写标记 (1.7s)
✓ 7 tests/e2e/onboarding-tour.spec.ts:122  › 两皮肤截图（现代 / 像素） (3.1s)
✓ 8 tests/e2e/onboarding-tour.spec.ts:143  › 声音图标：设置页开关后 aria-pressed 与图标真实翻转 (5.4s)
✓ 9 tests/e2e/onboarding-tour.spec.ts:183  › 开发者口径清零：渲染后的 DOM 里没有开发者词汇 (2.5s)
  9 passed (29.8s)
```

**⌘K 面板回归**（`playwright.command-palette.config.ts`）：`6 passed (11.1s)`

**截图**（`-r10` 前缀）：

- `reports/shots/onboarding-tour-r10-01-before-skip.png` —— 退场前（引导 1/3 在场）
- `reports/shots/onboarding-tour-r10-02-after-skip.png` —— 点「跳过」后：**页面无遮罩、无发暗、顶栏可点**（修复前同一画面是被 ⌘K 面板遮罩糊住的）
- `reports/shots/onboarding-tour-r10-03-step3.png` —— 三步走完前（3/3「完成」）
- `reports/shots/onboarding-tour-r10-04-after-complete.png` —— 「完成」后同样干净
- `reports/shots/onboarding-tour-r10-05-after-esc.png` —— ESC 退场后同样干净

**修复前后的像素对照**（命令面板遮罩在 / 不在）：

```
with-backdrop:    topbar(300,20)=[12,16,23]  battle(640,300)=[21,23,30]   点击「更多」→ strat-command-palette（被吃）
without-backdrop: topbar(300,20)=[24,28,38]  battle(640,300)=[83,112,163]  点击「更多」→ strat-button（可点）
```
