# task_139

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_139.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

onboarding+声音图标回归+开发者口径清理-模块（v3.8 视觉 Loop A 收官）

## requirements

### A. onboarding 轻引导（首开三步指路）

- **首开才出现**：`localStorage` 一次性标记（`stratix.onboarding.tour.done`）—— 写过就不再现；
  标记写不进去（隐私模式）时用实例内兜底记忆，本会话不再弹。
- **三步**：① 点命令行试试（spotlight 打在底栏命令行上）→ ② 建一个角色（打在「新建角色」入口；
  入口不在时改指 ⋯ 溢出菜单，不卡流程）→ ③ 看战场态势（打在右下角小地图）。
- **形态**：轻量 spotlight 蒙层 + 一句话气泡 + 「下一步」/「跳过」两个按钮。
  蒙层 `pointer-events: none`（用户可照着提示直接点底下界面），只有气泡吃点击。
- **手写**：不引任何 onboarding 库；组件手写（`src/hud/components/onboarding-tour/`，
  逻辑代码 ≈150 行；样式表 15 行走 `--srf-*` token，两皮肤自动适配）。
- **reduced-motion**：`prefers-reduced-motion: reduce` 时取消过渡，纯切换。
- **与既有首启向导分工**：首启向导（建档扫描那套重流程）管「建档」，本组件管「先教一句从哪开始」；
  两层都是全屏覆盖 → 组合根等向导消失后再上引导（最多等 15 秒，超时也上）。

### B. 声音图标回归修复（task_130 收敛后的两处 UI 不同步）

- 现象：设置页把「音效」关掉，顶栏声音钮的 `aria-pressed` 仍停在旧值、图标不变 —— eval r3 的 P3。
- 病根：两处 UI 各自写 `localStorage`，没有共同的「有人改了」信号。
- 要求：**一把闸**（`stratix.sound.enabled` / `stratix.sound.volume` 仍是唯一真源），
  写入统一走声音引擎的写入口，写完广播一声 `stratix:sound-changed`（载荷不带状态 —— 不留第二份真相），
  订阅方重读真源即可；顶栏图标 / `aria-pressed` 立刻跟着变。

### C. 开发者口径清零

- 全 UI 中文文案里不得残留开发者词汇（数据流 / 管线 / 握手 / 注册表 / 网关 / 整屏 token …），
  要么人话化，要么挪进开发者专属区（自定义 agent 接入配置本身就是高级区）。
- 对齐 task_122 的口径（人话优先，技术细节留在 console.debug）。
- 不动布局骨架、不动 134-138 已落地的 token / 图标 / 空态 / 动效结构（文案与状态接线除外）。

## acceptance

- [x] 首开三步引导真走通（playwright：清 localStorage → 1/3 → 2/3 → 3/3 → 完成；跳过路径；
      二次打开不再现），现代 / 像素两皮肤截图各一张（`-r5-onb-` 后缀）
- [x] 声音图标 `aria-pressed` 真随设置页开关翻转（开 / 关两张截图，图标 `sound` ↔ `sound-muted`）
- [x] 全 UI 中文文案 grep 无开发者口径残留（改动前后对照表见下）
- [x] `npx tsc --noEmit` 绿；相关 jest 全绿
- [x] 截图文件名：`-r5` 前缀 + `-onb` / `-snd` 后缀
- [x] 不动 134-138 结构 / 不动布局骨架 / 不动 gateway / 不引依赖 / 不 mock 数据 / 最小改动

## 交付物

| 文件 | 作用 |
| --- | --- |
| `src/hud/components/onboarding-tour/onboarding-tour.ts` | 手写 spotlight 组件（挖洞蒙层 + 气泡 + 下一步/跳过 + 一次性标记） |
| `src/hud/components/onboarding-tour/onboarding-tour-catalog.ts` | 三步词表（标题 / 一句话 / 目标元素解析口） |
| `src/hud/components/onboarding-tour/` → `src/app/main/main-entry.ts` | 组合根接线：等首启向导走完再上引导 |
| `src/hud/sound-engine.ts` | 声音偏好写入口广播 `stratix:sound-changed`（单键真源不变） |
| `src/hud/screens/main-screen.ts` | 顶栏声音钮订阅广播 → 重读真源 → 图标 / `aria-pressed` 立刻翻转 |
| `src/hud/screens/settings-screen.ts` | 设置页「音效」行走声音引擎写入口 + 文案人话化 |
| `src/hud/screens/status-screen.ts` / `src/hud/bridge/gateway-link-port.ts` / `src/hud/panels/command-panel.ts` / `src/hud/panels/command-registry.ts` / `src/app/main/custom-agents-bridge.ts` | 开发者口径 → 人话（对照表见下） |
| `src/hud/__tests__/onboarding-tour.test.ts` | 引导单测（走完 / 跳过 / 二次不再现 / 有无目标两种摆位 / 注册幂等） |
| `src/hud/__tests__/sound-sync.test.ts` | 声音单键 + 广播单测 |
| `tests/e2e/onboarding-tour.spec.ts` + `tests/e2e/playwright.onboarding-tour.config.ts` | e2e（引导全流程 + 跳过 + 两皮肤 + 声音状态断言 + 文案 grep） |
| `reports/shots/onboarding-tour-r5-onb-{modern,pixel}.png`、`reports/shots/sound-icon-r5-snd-{on,off}.png` | 验收截图 |

## 验证证据（完成前必填）

- [x] **实现证明**: 见 requirements（A/B/C 三段）
- [x] **测试验证**: 见下方「验证结果」
- [x] **影响范围**: 仅 HUD 表现层 + 组合根接线；不动 core / world / gateway；无新增依赖

### 测试步骤

1. `npx tsc --noEmit`
2. `npx jest src/hud/__tests__/onboarding-tour.test.ts src/hud/__tests__/sound-sync.test.ts`（+ 相关套件）
3. `npx playwright test --config=tests/e2e/playwright.onboarding-tour.config.ts`
4. 文案 grep：`grep -rnE "数据流|管线|握手|注册表|网关|整屏 token" src/hud src/app`（用户可见字符串零命中）

### 验证结果

**tsc**

```
$ npx tsc --noEmit
TSC-OK
```

**jest（新增 + 相关套件）**

```
$ npx jest src/hud/__tests__/onboarding-tour.test.ts src/hud/__tests__/sound-sync.test.ts ...
Test Suites: 9 passed, 9 total
Tests:       239 passed, 239 total
```

**playwright（e2e，5 条全绿，18.8s）**

```
Running 5 tests using 1 worker
  ✓  1 首开三步引导真走通：1/3 → 2/3 → 3/3 → 完成；二次打开不再现 (4.6s)
  ✓  2 跳过路径：点「跳过」即收起 + 写标记 (1.7s)
  ✓  3 两皮肤截图（现代 / 像素） (3.1s)
  ✓  4 声音图标：设置页开关后 aria-pressed 与图标真实翻转（开 / 关截图对比） (5.1s)
  ✓  5 开发者口径清零：渲染后的 DOM 里没有开发者词汇 (2.4s)
  5 passed (18.8s)
```

**声音图标真翻转（e2e 断言 + 截图）**

| 场景 | `aria-pressed` | `icon` | 截图 |
| --- | --- | --- | --- |
| 设置页开（默认） | `true` | `sound` | `reports/shots/sound-icon-r5-snd-on.png` |
| 设置页关后回主屏 | `false` | `sound-muted` | `reports/shots/sound-icon-r5-snd-off.png` |

同一时刻的 `localStorage`：`stratix.sound.enabled = '0'`（设置页写的那一把闸）。

**开发者口径改动前后对照表**（用户可见文案）

| # | 位置 | 改前 | 改后 |
| --- | --- | --- | --- |
| 1 | `hud/bridge/gateway-link-port.ts`（横幅标题 · 在线） | 网关已连接 | 服务已连接 |
| 2 | `hud/bridge/gateway-link-port.ts`（横幅标题 · 离线） | 网关未连接 | 服务未连接 |
| 3 | `hud/bridge/gateway-link-port.ts`（在线说明） | 数据与实时通道均可用 | 数据和实时消息都正常 |
| 4 | `hud/bridge/gateway-link-port.ts`（降级说明） | 数据可用，实时通道断开 | 数据能看，实时更新断了 |
| 5 | `hud/screens/status-screen.ts`（状态屏行名） | 网关连接 | 服务连接 |
| 6 | `hud/screens/status-screen.ts`（状态屏行名） | 系统心跳 | 状态更新 |
| 7 | `hud/screens/settings-screen.ts`（自定义 agent 读取失败） | 注册表读取失败 | 读取自定义 agent 列表失败 |
| 8 | `hud/screens/settings-screen.ts`（自定义 agent 读取中） | 正在读取注册表… | 正在读取自定义 agent 列表… |
| 9 | `hud/screens/settings-screen.ts`（分组名） | 自定义 agent 注册 | 自定义 agent |
| 10 | `hud/screens/settings-screen.ts`（皮肤说明） | 整屏 token 一起切换，组件零改动 | 整屏配色与字号一起切换，界面各处自动跟着变 |
| 11 | `hud/screens/settings-screen.ts`（自定义 agent 说明） | 移除注册只断探测与执行接入：已建的角色档案保留（kind 还在档案里，不再参与检测与健康监测）…… | 移除注册只是不再检测它、也不再派活给它：已经建好的角色档案仍然保留。新增注册在首启向导的扫描步。 |
| 12 | `hud/panels/command-panel.ts`（回放失败提示） | 回放失败：回放服务（网关）没连上…… | 回放失败：回放服务没连上…… |
| 13 | `hud/panels/command-registry.ts`（回放命令说明） | 回放今天（网关没连上会给出重试指引） | 回放今天（服务没连上会给出重试指引） |
| 14 | `app/main/custom-agents-bridge.ts`（IPC 兜底文案） | 注册表读取失败 | 读取自定义 agent 列表失败 |

**grep 结果（改后，用户可见字符串零命中）**

```
$ grep -rnE "['\"\`][^'\"\`]*?(数据流|管线|握手|注册表|网关|整屏 token)[^'\"\`]*?['\"\`]" src/hud src/app \
    | grep -vE "__tests__|/dev/" | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*)"
（无命中 —— 只剩源码注释与开发者专属区的配置字面量）
```

**spotlight 蒙层确实在画**（深色主题下肉眼不明显，用像素差量出来）

```
on(100,300)  [ 5, 6,14]   ← 蒙层内
off(100,300) [13,17,38]   ← 同一像素无蒙层
```

**未做 / 留待后续**

- `src/app/main/main-entry.ts` 的 `import/order` 报错是**该文件既有欠账**（HEAD 即报错：import 块按话题分组、
  未按字母排序）；本任务新增的两行 import 放在合法位置后，全文件报错数由 50 降到 48，未做整块重排（避免动无关代码）。
- 自定义 agent 接入区仍保留 `plain` / `json` 等配置字面量（那是用户要照着填的实际配置值，属高级/开发者区）。
