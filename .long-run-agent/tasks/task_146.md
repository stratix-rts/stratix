# task_146

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_146.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 见下（登记制度本体 = `src/hud/theme/layer-tokens.ts`）

**这是配置文件**，不是最终产出！

## 描述

重叠bug根治：浮层堆叠登记制度-模块

## requirements

1. **复现**：在 7523 上构造用户场景（信息层级框 + agent 事件列表同屏），量出实际重叠值；若难复现则读 DOM 说明两者的 stacking context。
2. **堆叠登记制度**：单一 z-index 刻度表（`hud/theme/layer-tokens.*`），全部浮层组件从 token 取值；grep 全部硬编码 z-index 逐个收编，收编清单写进交付。
3. **修重叠**：按登记顺序修掉用户报告的重叠；跑浮层组合矩阵（横幅×抽屉×spotlight×toast×dialog 两两同屏），能自动的自动、其余人工核。
4. **stacking context 卫生**：统一浮层挂载位置，排查并修掉「组件自己的 transform/filter 造出上下文把自己困住」的病灶。

## acceptance

- [x] 复现并修复用户报告的重叠，有前后截图 / 复现步骤与实测数值
- [x] grep 证明 `src/hud` 内零硬编码 z-index 残留（刻度表文件除外）
- [x] 浮层组合矩阵 ≥ 8 组两两同屏验证无叠错（本次 18 组，0 FAIL）
- [x] `npx tsc --noEmit` + 相关 jest 全绿
- [x] 截图采用 `-r7` 前缀 + `-z` 后缀命名

## 交付物

### 1. 制度本体（新增）

| 文件 | 职责 |
|------|------|
| `src/hud/theme/layer-tokens.ts` | **浮层堆叠登记制度**：① `LAYER_TOKENS` 全局刻度表（20 个档位）；② `zVar(name)` 唯一取值口径（带刻度表兜底值）；③ `installLayerTokens()` 幂等注入 `:root` 的 `--srf-z-*`；④ `OVERLAY_REGISTRY` **浮层家族登记表**（22 个家族：档位 / 象限 / 宿主 / 说明）；⑤ `CORNER_OWNERS` **象限归属表**（一块屏幕一个主人） |
| `src/hud/theme/__tests__/layer-tokens.test.ts` | **机器守纪律**（8 条单测）：零裸 z-index / 每条声明都走刻度表 / 档位单调 / 登记表完整 / 象限归属非空 |

### 2. 病灶与修复（用户报告的「信息层级框和 agent 事件列表压在一起」）

- **复现**：1440×900 下 `.hud-layer-switch`（16,714 174×78，z28）与 `.hud-rail-left`（12,52 320×736，z20）**重叠 174×74px**。
- **根因**：不是 z-index 大小，是**左下角的带互相咬合** —— 左栏下边界 112px / 事件轨最高 175px / 开关贴 108px，三者纵向区间交叉。
- **修复**：新增唯一事实源 `core/theme/visual-spec.ts` 的 `HUD_OVERLAY_BAND_METRICS`，把左下角切成**两条互不重叠的带**
  （事件轨带 16–191px、信息层级开关带 199–291px），左栏下边界按整条带高 `cornerBandPx=283px` 让开。

### 3. 收编清单（全部硬编码 z-index → 刻度表）

| # | 文件 | 元素 | 原值 | 新档位 | 取值 |
|---|------|------|------|--------|------|
| 1 | `hud/screens/main-screen.ts` | 顶栏 `.hud-topbar` | 30 | `raised` (30) | `zVar('raised')` |
| 2 | `hud/screens/main-screen.ts` | 顶栏弹出层 `.hud-popover` | 40 | `sticky` (40) | `zVar('sticky')` |
| 3 | `hud/screens/main-screen.ts` | 左栏 `.hud-rail-left` | 20 | `panel` (20) | `zVar('panel')` |
| 4 | `hud/screens/main-screen.ts` | 右栏 `.hud-rail-right` | 20 | `panel` (20) | `zVar('panel')` |
| 5 | `hud/screens/main-screen.ts` | 控制岛 `.hud-bottom-bar` | 25 | `island` (25) | `zVar('island')` |
| 6 | `hud/screens/main-screen.ts` | 子屏壳 `.hud-sub-screen` | 50 | `modal` (50) | `zVar('modal')` |
| 7 | `hud/layers/layer-switch.ts` | 信息层级开关 `.hud-layer-switch` | **28** | `sticky` (40) | `zVar('sticky')` |
| 8 | `hud/components/toast/toast-host.ts` | toast 宿主 `:host` | 50（右上角） | `toast` (55) | `zVar('toast')` + **落位改底中** |
| 9 | `hud/components/battlefield-empty/battlefield-empty.ts` | 空态覆盖层 | 15 | `underlay` (15) | `zVar('underlay')` |
| 10 | `hud/components/marquee/marquee.ts` | 事件轨 `:host` | 21 | `track` (21) | `zVar('track')` |
| 11 | `hud/components/marquee/marquee.ts` | 事件详情板 | 3 | `localTop` (3) | `zVar('localTop')` |
| 12 | `hud/components/marquee/milestone.ts` | 里程碑大字 | 45 | `overlay` (45) | `zVar('overlay')` |
| 13 | `hud/components/minimap/minimap.ts` | 小地图 `:host` | 45 | **`sticky` (40)** | `zVar('sticky')`（改档：角件不得压半模态抽屉） |
| 14 | `hud/components/chat-drawer/chat-drawer.ts` | 抽屉宿主 | 40 | **`overlay` (45)** | `zVar('overlay')`（改档：焦点浮层高于角件） |
| 15 | `hud/components/chat-drawer/chat-drawer.ts` | 抽屉面板 `.rail` | 1 | `localMid` (2) | `zVar('localMid')` |
| 16 | `hud/components/chat-drawer/chat-drawer.ts` | 对侧压暗 `.rail-dim` | 0 | `localBase` (0) | `zVar('localBase')` |
| 17 | `hud/components/replay/replay-clock.ts` | 回放角标 | 40 | `sticky` (40) | `zVar('sticky')` |
| 18 | `hud/components/mode-strip/mode-strip.ts` | 模式状态条 | 32 | `strip` (32) | `zVar('strip')` |
| 19 | `hud/components/gateway-banner/gateway-banner.ts` | 网关横幅 | 31 | `banner` (31) | `zVar('banner')` |
| 20 | `hud/components/shortcuts/shortcut-help.ts` | 快捷键帮助遮罩 | 60 | `spotlight` (60) | `zVar('spotlight')` |
| 21 | `hud/components/new-task-dialog/new-task-dialog.ts` | 新任务对话框 | 60 | `spotlight` (60) | `zVar('spotlight')` |
| 22 | `hud/components/onboarding-tour/onboarding-tour.ts` | onboarding 聚光 | 60 | `spotlight` (60) | `zVar('spotlight')` |
| 23 | `hud/components/screen-fx/scan-band.ts` | 扫描光带 | 1 | `fx` (1) | `zVar('fx')` |
| 24 | `hud/components/screen-fx/error-glow.ts` | 报错红光晕 | 2 | `fxRaised` (2) | `zVar('fxRaised')` |
| 25 | `hud/panels/command-panel.ts` | 事件详情板 | 3 | `localTop` (3) | `zVar('localTop')` |
| 26 | `hud/panels/command-panel.ts` | 空提示条 | 2 | `localMid` (2) | `zVar('localMid')` |
| 27 | `hud/screens/onboarding-screen.ts` | 向导屏 `:host` | 50 | `modal` (50) | `zVar('modal')` |
| 28 | `hud/screens/settings-screen.ts` | 危险区确认框 `.confirm-layer` | 70 | `max` (70) | `zVar('max')` |
| 29 | `hud/theme/skin-pixel-layer.css` | 像素皮 CRT 扫描线 `body::after` | **999** | `max` (70) | `var(--srf-z-max, 70)` |

**共 29 处硬编码 z-index 全部收编**（含 2 处改档：minimap 45→40、chat-drawer 40→45；1 处落位改写：toast 右上→底中）。

### 4. 刻度表（`LAYER_TOKENS`）

```
全局档位（跨件可比）：
  base 10 · underlay 15 · panel 20 · track 21 · island 25 · raised 30 · banner 31 ·
  strip 32 · sticky 40 · overlay 45 · modal 50 · toast 55 · spotlight 60 · max 70
局部档位（只在组件自己的 stacking context 内比较）：
  fx 1 · fxRaised 2 · localBase 0 · localMid 2 · localTop 3
```

### 5. 浮层组合矩阵（18 组两两同屏，0 FAIL）

| 对 | 判定 | 依据 |
|----|------|------|
| layer-switch × agent-rail | OK 无重叠 | 16,623 174×78 z40 ‖ 12,52 320×565 z20 |
| layer-switch × 事件轨 | OK 无重叠 | 16,623 174×78 z40 ‖ 16,707 260×177 z21 |
| agent-rail × 事件轨 | OK 无重叠 | 12,52 320×565 z20 ‖ 16,707 260×177 z21 |
| layer-switch × toast | OK 无重叠 | 16,623 ‖ 625,721 190×67 z55 |
| toast × 控制岛 | OK 无重叠 | 625,721 ‖ 317,804 806×96 z25 |
| toast × 顶栏 | OK 无重叠 | 625,721 ‖ 0,0 1440×40 z30 |
| toast × 小地图 | OK 无重叠 | 625,721 ‖ 1222,742 202×142 z40 |
| 事件轨 × toast | OK 无重叠 | 16,707 ‖ 625,721 |
| toast × 新任务对话框 | OK 整片盖住 | 对话框(spotlight 60) ⊃ toast(55) |
| layer-switch × 新任务对话框 | OK 整片盖住 | 对话框 ⊃ 开关 |
| toast × 设置子屏 | OK 整片盖住 | 几何上子屏(modal 50) ⊃ toast；层序上 toast(z55) **浮在**子屏之上 —— 「反馈层不挡焦点面」的设计意图（toast 档 = 弹窗之上） |
| layer-switch × 设置子屏 | OK 整片盖住 | 子屏 ⊃ 开关 |
| 事件轨 × 设置子屏 | OK 整片盖住 | 子屏 ⊃ 事件轨 |
| shortcut-help × toast | OK 整片盖住 | 快捷键帮助(spotlight 60) ⊃ toast |
| shortcut-help × layer-switch | OK 整片盖住 | 快捷键帮助 ⊃ 开关 |
| toast × 聊天抽屉 | OK 无重叠 | 704,756 32×32 z55 ‖ 1080,0 360×900 z45 |
| chat-drawer × 小地图 | OK 整片盖住 | 抽屉(overlay 45) ⊃ 小地图(sticky 40) —— **改档后由错位转正确** |
| onboarding tour × 控制岛 | OK 整片盖住 | 聚光(spotlight 60) ⊃ 控制岛(island 25) |

> 判定口径：上层把下层**整片盖住** = 合法（模态遮罩压住下层是设计意图）；只盖住下层**一角** = 错位（FAIL）。
> 逐对截图：`reports/shots/z-matrix-r7-z-01…18-*.png`（18 张）。

### 6. stacking context 卫生（`node tmp/stackctx-z.mjs`）

逐浮层回溯祖先链，找出**谁造出了 stacking context**（transform / filter / backdrop-filter / perspective /
mix-blend-mode / contain:paint / will-change / opacity<1 / position+z-index）：

| 浮层 | 最近祖先上下文根 | 自身上下文成因 |
|------|----------------|--------------|
| layer-switch / agent-rail / right-rail / marquee / minimap / topbar / bottom-bar / toast / banner / mode-strip | **全部 = `div#hud-side`** | 自身 z-index（base 档 10 之上的那一档） |

结论：
- **✓ 全部浮层共享同一个层序空间**（`#hud-side` 是唯一 stacking context 根）→ 全局刻度表**跨件可比**，
  「登记制度」成立；若某浮层被挂到 `#hud-side` 之外，它的档位就会与别人不可比 —— 登记表的 `host` 字段正是这条约束。
- **✓ 无病理性陷阱**：命中的 `transform` 都长在浮层**自己**的根上（toast 的 `translateX(-50%)` 居中、
  控制岛/横幅的入场位移动画），没有「祖先 transform 把浮层关进局部层序」的情况。
- 局部档位（localBase/localMid/localTop）只在**组件自己的**上下文内比较（组件根带 z-index 即自成上下文），
  不与全局档位混用 —— 刻度表把两类分开登记（全局段 / 局部段）。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上「制度本体 / 病灶与修复 / 收编清单」。核心 = `LAYER_TOKENS` 单一刻度表 + `zVar()` 唯一取值口 + `OVERLAY_REGISTRY` 家族登记表 + `CORNER_OWNERS` 象限归属表；`installLayerTokens()` 在 `app/main/main-entry.ts` 的 `boot()` 里**早于任何浮层挂载**注入 `:root` 的 `--srf-z-*`。
- [x] **测试验证**: 见下（grep 零硬编码 + 18 对矩阵 0 FAIL + tsc + jest 全绿）
- [x] **影响范围**: 只动 HUD 浮层的**层序与落位**；不改布局骨架、不改 gateway/、不改 144 输入区与 145 渲染逻辑（仅样式 token 化）、零新依赖。

### 测试步骤

1. 复现（修复前）：`node tmp/repro-z.mjs` → 打印 `layer-switch × agent-rail 重叠 174×74px`，截图 `reports/shots/z-repro-r7-z-before.png`。
2. 修复后取证：`node tmp/after-z.mjs` → 默认态与展开态（agent 事件列表 5 条 + 信息层级开关同屏）**均为「无重叠」**，截图 `reports/shots/z-repro-r7-z-after.png` / `z-scenario-r7-z-after.png`。
3. 组合矩阵：`node tmp/matrix-z.mjs` → 18 组两两同屏，输出上表 + 18 张 `-r7-z-` 截图。
4. 纪律守卫：`npx jest src/hud/theme/__tests__/layer-tokens.test.ts`（8 条全绿，其中两条直接 grep src/hud 全目录）。
5. 全量相关单测：`npx jest src/hud src/core --silent --maxWorkers=2`；类型：`npx tsc --noEmit`。

### 验证结果

```
$ grep -rnE "z-index[[:space:]]*:[[:space:]]*[0-9]+" --include='*.ts' --include='*.css' src/hud | grep -v "src/hud/theme/layer-tokens.ts"
src/hud/theme/__tests__/layer-tokens.test.ts:133:      // 只抓「属性值是裸数字」的写法：z-index: 40 / z-index:40（z-index 1 —— 这种注释不算）。
（唯一命中是守卫测试里的一句注释 —— src/hud 内零硬编码 z-index ✓）

$ grep -rnoE "z-index[[:space:]]*:[[:space:]]*[^;]+;" --include='*.ts' --include='*.css' src/hud | grep -v "^src/hud/theme/layer-tokens.ts"
28 条声明，全部为 ${zVar('…')} / var(--srf-z-…, N)（见收编清单 29 条，其中 skin-pixel-layer.css 为 CSS 直写 var()）

$ node tmp/after-z.mjs
【默认态】layer-switch × agent-rail 重叠： 无重叠
【展开态】layer-switch × agent-rail 重叠： 无重叠
【展开态】layer-switch × 事件轨 重叠： 无重叠
【展开态】agent-rail × 事件轨 重叠： 无重叠
  layer-switch: 16,623 174×78  z40      （带：199–291px）
  agent-rail:   12,52  320×565 z20      （栏：52–617px）
  marquee:      16,707 260×177 z21      （带：707–884px）

$ node tmp/matrix-z.mjs
共 18 组，FAIL 0 组

$ npx jest src/hud src/core --silent --maxWorkers=2
Test Suites: 109 passed, 109 total
Tests:       2154 passed, 2154 total

$ npx tsc --noEmit
（无输出，退出码 0）
```

## 未尽事项

- `hud/` 之外的目录（`src/world/`、`src/app/`）仍有 z-index 硬编码 —— 本任务范围限定 hud，未动。
- 局部档位（localBase/localMid/localTop/fx/fxRaised）只在组件自身 stacking context 内比较，跨 shadow 边界不可比 —— 这是刻度表的**设计约束**，不是漏洞；后续若要跨件比较需再登记。
- 组合矩阵为**几何 + 层序**断言（Playwright 量包围盒），未做像素级视觉回归。
- 未做浏览器兼容性验证（`z-index: var()` 与 `position: fixed` + `transform` 的组合在旧 Safari 需另行验证）。
- **仓库状态说明（非本任务引入）**：`a0c6355`（本次提交前）起，`HudBusAdapter` 已要求 `themeId` / `subscribeTheme`，
  而 `src/hud/__tests__/` 下 10 个套件的假 adapter 尚未同步 → 这 10 个套件在 **HEAD 上就已报 TS2345 跑不起来**
  （已在独立 worktree 上复验：`git worktree add --detach /tmp/verifyhead HEAD` → 同样 10 failed）。
  工作区里这些测试文件已被并行会话改好，故本任务在**工作区**跑 `npx jest src/hud src/core` 是 109/109 全绿。
  本任务不越界提交他人改动。

## 复现脚本（可直接粘贴；本次探针脚本落在被 gitignore 的 `tmp/`）

```bash
# ① 复现（修复前）与修复后取证：量「信息层级开关 × 左栏 × 事件轨」三件两两是否交叠
node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:7523/src/app/main/index.html');
  await p.waitForSelector('strat-command-panel', { timeout: 15000 });
  const skip = p.locator('strat-onboarding-screen [data-action=\"skip\"]');
  if (await skip.count()) { await skip.first().click(); await p.waitForTimeout(600); }
  await p.waitForTimeout(800);
  const box = await p.evaluate(() => {
    const pick = (s) => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, z: getComputedStyle(e).zIndex }; };
    return { sw: pick('.hud-layer-switch'), rail: pick('.hud-rail-left'), mq: pick('strat-marquee') };
  });
  const ov = (a, c) => { const ox = Math.min(a.x+a.w, c.x+c.w) - Math.max(a.x, c.x);
    const oy = Math.min(a.y+a.h, c.y+c.h) - Math.max(a.y, c.y); return ox>1&&oy>1 ? ox+'×'+oy+'px' : '无重叠'; };
  console.log('开关×左栏 :', ov(box.sw, box.rail));
  console.log('开关×事件轨:', ov(box.sw, box.mq));
  console.log('左栏×事件轨:', ov(box.rail, box.mq));
  await b.close();
})();
"
# 修复前输出：开关×左栏 174×74px（压在一起）；修复后：三行全是「无重叠」
```

