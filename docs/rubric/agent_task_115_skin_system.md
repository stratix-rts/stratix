# task_115 · 皮肤系统接通（theme.set + 现代/像素切换 + 持久化）—— 工作记录

> 日期：2026-11-03 ｜ 分支：`demo/v3.3` ｜ 任务：v3.6 task_115
> 类型：Bug 修复（死功能#3）+ 持久化接线（不是重构）

## 一、问题定位（先读代码 + 实测，不猜）

死功能报告说「三处入口点了 0% 像素差、console 报 `[Stratix] 未处理 command: theme.set`、
localStorage 里没有皮肤键」。实测后结论是：**token 切换的机制本来就能用，死的是「接线与真相」**。

| 症状 | 根因 | 修法 |
|------|------|------|
| console 报「未处理 command」 | core runtime 没有 `theme.set` 分支 → 掉进 `default:` → 记未处理 | core 显式**接地**这条命令（`case 'theme.set': return;`） |
| 切了不记忆 | 全链路没有任何 localStorage 读写 | 主题控制器接管记忆（键名冻结在 core） |
| 设置页高亮/菜单名会「说谎」 | `main-screen` 与 `settings-screen` **各存一份** `themeId`，刷新恢复后会指向旧皮肤 | 真源收敛到主题控制器，两个屏幕都改成读它 |
| 三处入口各写各的 | 三处切皮肤逻辑分散 | 统一走 `theme.set` → adapter 本地消费 |

实测确认 token 层没坏：背景 `#0f1116 → #0a0a14`、圆角 `6px → 0`、边框 `1px → 2px`、
字体栈 → Courier New，全页像素差 38%。**所以本任务不碰 token 文件本身。**

## 二、方案与改动清单

```
src/core/theme/skin-registry.ts                （改：冻结 SKIN_STORAGE_KEY）
src/core/runtime.ts                            （改：case 'theme.set' 接地）
src/core/types.ts                              （改：theme.set 契约注记「已接线 + 谁消费」）
src/hud/theme/theme-controller.ts              （改：记忆 + 订阅，成为皮肤唯一真相）
src/hud/bridge/bus-adapter.ts                  （改：暴露 themeId / subscribeTheme）
src/hud/screens/main-screen.ts                 （改：删本地 currentTheme，改读 adapter）
src/hud/screens/settings-screen.ts             （改：删本地 _themeId，改读 adapter + 订阅回显）
src/app/main/main-entry.ts                     （改：接上 defaultThemeStorage()）
src/app/dev/hello-loop-entry.ts                （改：同上，dev 入口同口径）
src/hud/dev/hud-dev-entry.ts                   （改：同上，dev 入口同口径）
src/hud/__tests__/skin-switch.test.ts          （新增，6 例：真控制器 + 真 adapter + 真 runtime）
src/hud/theme/__tests__/theme-controller.test.ts（改：记忆与订阅 5 例）
src/hud/__tests__/settings-screen.test.ts      （改：deps 补皮肤两项）
src/hud/__tests__/click-health.test.ts         （改：控制器桩补 subscribe）
src/app/__tests__/hello-loop.test.ts           （改：断言 core 不再报未处理）
src/hud/__tests__/{bus-adapter,main-screen,interaction-occlusion,director-toggle,
                    mission-detail,mission-confirm,v34-feature-matrix,status-screen,
                    session-panel,log-drawer,hud-layout,control-island,command-panel,
                    agent-panel}.test.ts  （改：桩补 subscribe / themeId / subscribeTheme）
tests/e2e/skin-switch.spec.ts                  （新增，5 例 playwright）
```

### 数据流

```
入口① 设置页皮肤区   ┐
入口② ⋯ 菜单「像素风」 ├─▶ adapter.dispatch({type:'theme.set', themeId})
入口③ 底栏命令 theme.pixel ┘        │
                                     ├─▶ 【HUD 本地消费】主题控制器.apply()
                                     │      ├─▶ 切 <style id="srf-theme-*">.disabled（token 真的变）
                                     │      ├─▶ localStorage['stratix.skin'] = id（记忆）
                                     │      └─▶ 订阅回调 → 菜单项改名 / 设置页高亮跟上
                                     │
                                     └─▶ 【core 接地】runtime: case 'theme.set' → return
                                            （不写 WorldState、不广播；只吞掉「未处理」告警）

启动：主题控制器构造时读 localStorage['stratix.skin'] → 记忆优先于 initial
      → 恢复皮肤的同时，菜单名/设置页高亮与实际皮肤一致
```

### 三条架构纪律（沿用仓库既有口径，非新发明）

1. **皮肤不进 WorldState**：皮肤是**每客户端本地**的展示偏好 —— `core/types.ts` 的 SettingsView
   注早已冻结这条。core 只「接地」命令，不落状态；token 也在本机 DOM 上，core 无从插手。
2. **键名冻结在 core**：`SKIN_STORAGE_KEY`（同 `DEMO_MODE.storageKey` 的纪律）——
   写入方（切皮肤）与读取方（启动恢复）必须认同一个键，抄两份字面量迟早对不上。
3. **真相单一**：皮肤真相 = 主题控制器。adapter 是窗口，屏幕不存第二份。
   （此前 `main-screen` 与 `settings-screen` 各存一份，正是「刷新后高亮指错皮肤」的来源。）

## 三、踩过的坑（都写进代码注释了）

| 坑 | 现象 | 解法 |
|----|------|------|
| 恢复逻辑校验时机错 | 构造时用 `styles.has(remembered)` 校验记忆值 → styles Map 还没填 → 永远判非法 → 刷新后回到默认皮 | 校验改成对 `options.sources` 做 `hasOwnProperty` |
| 快照式 stub 会过期 | 测试里 `themeId` 传的是快照值 → 切一次皮肤后高亮不动 | stub 一律用 **getter** |
| TS 推断把 id 收窄成 `'default'` | `createThemeController({initial:'default'})` → `Id` 推成字面量 `'default'` → `apply('pixel')` 报错 | 显式 `createThemeController<ThemeId>({...})` |
| jsdom 算不出 CSS 变量 | jsdom 无 computed custom properties，断言 token 切换全绿不了 | jsdom 断言样式表 `disabled` + `textContent`；token 真假交给 playwright computed style |
| playwright 默认 globalSetup 会杀 7523/7524 | 常驻 dev 服务（别的 worker 也在用）被打断 | 用临时配置（无 globalSetup、无 webServer）跑，跑完即删 |
| 改了接口 → 一批桩编译不过 | `ThemeController.subscribe` / `HudBusAdapter.themeId` 是新增必填项 → 14 个测试套件 TS 报错 | 逐个补桩（桩是契约的一部分，不是"绕过类型"） |

## 四、验证

| 项 | 命令 | 结果 |
|----|------|------|
| 类型 | `npx tsc --noEmit` | 通过（无输出，exit 0） |
| 单测（hud/core/app） | `npx jest src/hud src/core src/app --maxWorkers=2` | 156 套 / 2712 例全绿 |
| 单测（全量） | `npx jest --maxWorkers=2` | 269 套 / 4924 例绿；唯一失败 `brand-presets`（缺 `dist/` 构建产物，**改动前既有失败**） |
| e2e | `npx playwright test --config <临时配置>` | 5/5 通过（7.8s）：三入口 token 变化 / 记忆写盘 / 刷新保持 / console 零「未处理」 |

e2e 断言的是**真实视觉差**：切换前后读 `getComputedStyle(document.documentElement)`
的 `--srf-border-width` / `--srf-radius` / `--srf-accent` / `--srf-bg` / `--srf-font-ui`，
五项全部要求不同；刷新后要求三项相同且 `localStorage['stratix.skin'] === 'pixel'`。

## 五、未尽事项

- **像素字体素材不在本任务范围**（任务书明令）：本轮像素皮靠「直角 + 2px 硬边框 + 换色 + 等宽字体栈」
  落地视觉差，真实像素字库留后续任务。
- `theme.set` 的命令面仍是窄口径 `default | pixel`；皮肤库里另外 6 套（crimson/forest/ocean/
  sunset/mono/aurora）只在 dev 入口可切（`themeController.apply(id)`），未进正式命令词表 —— 本任务未扩词表。
- **Electron 正式包（file:// 源）**下 `localStorage` 可能不可用 → `defaultThemeStorage()` 已降级为
  「不记忆但切皮肤照常可用」，不会抛错；该场景下的持久化需要后续在 Electron 侧确认 origin 策略。
- 与并行 worker 的同文件冲突：`src/app/main/main-entry.ts` 双方都改（对方加网关横幅，我加皮肤记忆），
  已按「只提交自己 hunk」处理，未覆盖对方改动。
