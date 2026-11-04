# task_138 — 动效系统：签名瞬间 + 生产级节奏

## 描述

动效系统——签名瞬间 + 生产级节奏。目标 bar：`production`。
动效是「工具感」到「产品感」的分界线，但**每个动效必须有存在理由**。

## 交付物

| 文件 | 职责 |
|------|------|
| `src/core/theme/motion-spec.ts`（新） | **动效唯一事实源**：三档时长（120/200/360ms）+ 三档缓动（ease-out / ease-in / spring）+ 关键帧名 + CSS 变量映射。纯常量、零 IO、零 DOM。 |
| `src/hud/theme/motion-tokens.ts`（新） | **动效工具类层**：把 core 规格翻译成 CSS —— `:root` 变量表 + 四套关键帧 + 四个工具类（`.srf-motion-enter` / `-confirm` / `-check` / `-pulse`）+ `prefers-reduced-motion` 全量禁用兜底。 |
| `src/hud/components/toast/toast-host.ts` | 签名瞬间一：成功 toast 带**对勾描边 + scale/brightness 脉冲**；toast 入场从瞬现改为落位。 |
| `src/hud/panels/mission-confirm.ts` | 签名瞬间一：任务行 `running → done` **跃迁的那一次**播确认脉冲 + 对勾；面板入场位移。 |
| `src/hud/components/gateway-banner/gateway-banner.ts` | 签名瞬间二：横幅「不可见 → 可见」时落位入场（不再是瞬现）。 |
| `src/hud/panels/command-panel.ts` | 签名瞬间二：面板位移入场；列表项 hover 光标过渡（整行挪 2px）；命令行提交时输入行微脉冲。 |
| `src/hud/__tests__/motion-signature.test.ts`（新） | 契约层单测：token 双端一致 / 工具类齐备 / reduced-motion 兜底 / 完成确认一次性。 |
| `tests/e2e/motion.spec.ts` + `tests/e2e/playwright.motion.config.ts`（新） | 视觉层 e2e：computed style 断言 token、类切换 + 动画名断言、reduced-motion 断言、截图。 |

### 设计要点

- **双 token 体系**：数值只在 `core/theme/motion-spec.ts` 一份；HUD 侧 `motion-tokens.ts` 只做「常量 → CSS」翻译。
  两端一致性由单测逐项断言（`MOTION_TOKENS_CSS` 必须包含每个变量的 core 取值）。
- **动效只在 CSS 里**：组件只挂类名，不写 keyframes、不写时间字面量、不引 JS 动画库（零新依赖）。
- **一次性语义**：确认动效只在「相位跃迁的那一次」触发。面板每次状态变化整块重画 HTML，
  若按「当前是 done」挂类 → 动效无限重放（一行在发抖）。故用 `_phases` 表比对前后相位。
- **降级全量禁用**：用 `animation: none` / `transition: none`（不是 0.001ms）——
  前者 computed 直接是 `none` / `0s`，可被自动化断言，也真的不产生合成开销。

## 验证证据

- [x] **实现证明**：见上表 + 关键帧/工具类定义（`MOTION_COMPONENT_CSS`）。
- [x] **测试验证**：
  - `npx tsc --noEmit` → 无输出（通过）
  - `npx jest src/hud/__tests__/motion-signature.test.ts src/hud/__tests__/toast-host.test.ts src/hud/__tests__/command-panel.test.ts src/hud/__tests__/mission-confirm.test.ts src/hud/__tests__/gateway-banner.test.ts --maxWorkers=1` → 4+1 套件全绿（56 tests）
  - `npx playwright test --config=tests/e2e/playwright.motion.config.ts` → 2 passed（见下方原样输出）
- [x] **影响范围**：只动 HUD 动效层（toast / 任务确认面板 / 网关横幅 / 命令面板）+ 两个新增文件。
  不动布局骨架、不动 core 状态机、不动 gateway、不引依赖。

### 测试步骤

1. `npx tsc --noEmit`
2. `npx jest src/hud/__tests__/motion-signature.test.ts src/hud/__tests__/toast-host.test.ts src/hud/__tests__/command-panel.test.ts src/hud/__tests__/mission-confirm.test.ts src/hud/__tests__/gateway-banner.test.ts --maxWorkers=1 --silent`
3. `npx playwright test --config=tests/e2e/playwright.motion.config.ts`（vite 7523 需在跑；7524 不动）
4. 看截图：`reports/shots/toast-confirm-r5-motion.png`（对勾）、`gateway-banner-r5-motion.png`（横幅落位）、`motion-r5-full.png`（整屏）

### 验证结果（playwright 原样输出）

```
T138_TOKENS {"tokens":{"--srf-motion-fast":"120ms","--srf-motion-base":"200ms","--srf-motion-slow":"360ms","--srf-motion-ease-enter":"ease-out","--srf-motion-ease-exit":"ease-in","--srf-motion-ease-spring":"cubic-bezier(0.34, 1.56, 0.64, 1)"},"tokenInShadow":{"--srf-motion-base":"200ms"}}
T138_PANEL_ENTER {"panelEnter":{"animation-name":"srf-motion-enter-in","animation-duration":"0.2s","animation-timing-function":"ease-out"},"panelClass":"panel srf-motion-enter"}
T138_BANNER_ENTER {"className":"banner srf-motion-enter","animationName":"srf-motion-enter-in","animationDuration":"0.2s","hidden":false}
T138_CONFIRM {"toastClass":"toast srf-motion-enter","checkClass":"check srf-motion-confirm","pathClass":"srf-motion-check","animationName":"srf-motion-confirm-pop","animationDuration":"0.36s","pathAnimationName":"srf-motion-check-draw","pathDashOffset":"22px","text":"阿尔法 完成任务"}
T138_MISSION_PANEL {"className":"panel srf-motion-enter","animationName":"srf-motion-enter-in"}
  ✓  1 tests/e2e/motion.spec.ts:56:5 › 动效 token + 签名瞬间 + 位移入场（task_138） (1.9s)
T138_REDUCED {"panelAnimationName":"none","panelTransitionDuration":"0s","checkAnimationName":"none","checkTransitionDuration":"0s"}
  ✓  2 tests/e2e/motion.spec.ts:218:5 › prefers-reduced-motion: reduce 下全部动效禁用（task_138） (656ms)

  2 passed (4.4s)
```

**验收口径对照**

| 口径 | 证据 |
|------|------|
| ① 动效 token 双 token 体系可查（computed style） | `T138_TOKENS`：`:root` 六项取值全中；shadow 内取 `--srf-motion-base` = `200ms`（跨 shadow root 同源） |
| ② 任务完成瞬间有确认动效 + 截图 | `T138_CONFIRM`：`.check` = `srf-motion-confirm` / animation `srf-motion-confirm-pop`；`path` = `srf-motion-check` / animation `srf-motion-check-draw`；单测另覆盖任务行 `running→done` 只在跃迁那一次挂确认类。截图 `toast-confirm-r5-motion.png` |
| ③ 横幅与 ≥2 个面板有位移入场而非瞬现 | 横幅 `srf-motion-enter-in`；命令面板 `srf-motion-enter-in`；任务确认面板 `srf-motion-enter-in`（三处均有 class + animation 断言） |
| ④ reduced-motion 下全部禁用 | `T138_REDUCED`：`animationName: none`、`transitionDuration: 0s`（面板与对勾各两项） |
| ⑤ typecheck + jest 绿 | `tsc --noEmit` 无输出；jest 4 套件 + gateway-banner 套件全绿 |
| ⑥ 截图 `-r5` 前缀 + `-motion` 后缀 | `reports/shots/{gateway-banner,toast-confirm}-r5-motion.png`、`motion-r5-full.png` |

## 未尽事项

- 像素皮肤的 `steps()` 重帧感皮肤语言差异（加分项）—— 本轮未做（超时跳过，见最终输出）。
- 战场（Phaser 世界层）单位位置的完成确认动效 —— 本轮做在 HUD 列表项 + toast 上；
  世界层是 canvas，CSS 动效覆盖不到，需要 core 侧事件 + Phaser tween，另开一轮。
