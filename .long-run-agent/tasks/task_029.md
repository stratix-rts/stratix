# task_029

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_029.md`

**工作目录**: 项目根目录

## 描述

world: 战场单位渲染用 AgentProfile.appearance 合成形象 + 全链路验收-模块

## requirements

①战场单位渲染换合成形象：BattlefieldScene/unit-layer 按 AgentProfile.appearance 用 CharacterComposer 合成精灵表加载（缓存纹理 key=characterId），走路动画；无 appearance 的角色回退现有 placeholder。②全链路验收：typecheck+jest 全量+build+dev 手测（向导：随机形象→canvas 预览动画→创建→战场单位=合成形象走路）。③素材路径真机可达验证。

## design

依赖 027/028。手测记录写任务文件。联调含 dev 手测，节奏：断点续传+机械锁定+单缺口卡 5 分钟记未尽继续。

## acceptance

- typecheck 零错误
- jest 全量通过
- npm run build 成功
- dev 手测向导全流程（含 canvas 动画预览、战场合成形象）记录在案

## 交付物

按 design 落地的新增/修改文件 + 测试

## 验证证据（完成前必填）

- [x] **实现证明**: 简要说明
- [x] **测试验证**: typecheck + jest 输出贴出
- [x] **影响范围**: 说明

### 实现说明

战场单位渲染改成「按角色的 AgentProfile.appearance 合成 LPC 精灵表」：

**分层（world 零 DOM 铁律不破）**

| 层 | 文件 | 职责 |
|---|---|---|
| 数据面 | `src/core/types.ts` | `UnitView.appearance?`（可选增补，老单位构造点不破） |
| 数据面 | `src/core/character/unit-projection.ts` | 角色档案 → 单位视图时把 `appearance` 一起投影（没有则 null） |
| 渲染面 | `src/world/objects/unit-object.ts` | 暴露 `appearance` / `characterId` getter；`update()` 用 `appearanceKey()` 判"外观变没变" |
| 几何（纯函数） | `src/world/objects/unit-sprite-sheet.ts` | 纹理 key（`strat-unit-sheet:<characterId>`）、帧名（`方向-列`）、精灵带尺寸、动画参数、缓存上限 |
| 端口（world 侧） | `src/world/objects/unit-sprite-source.ts` | `UnitSpriteSource` 接口 + `UNIT_SPRITE_SOURCE_KEY`（走 game.registry 注入） |
| 适配（app 侧） | `src/app/services/unit-sprite-source.ts` | 真实现：合成 → 裁出"走路 4 行"精灵带（合成串行化，共用一张合成画布） |
| 渲染 | `src/world/objects/unit-layer.ts` | 贴精灵 + 走路动画（全场一个定时器推进帧）、纹理 LRU 封顶 24 张、无 appearance 回退占位圆 |
| 接线 | `src/app/main/main-entry.ts` | 注册表与合成器**与向导预览共用同一份**（元数据 1.4MB 只加载一次）；`preBoot` 把精灵源放进 game.registry |
| 场景 | `src/world/scenes/BattlefieldScene.ts` | 从 `game.registry` 取精灵源（场景由 Phaser 实例化，构造器拿不到注入），取不到就用占位形体 |

**关键约定**

- 帧序沿用 LPC 的 `ANIMATION_CONFIGS.walk.cycle`（帧序只有一份真相，预览与战场长得一样）；
- 方向行 2 = 朝下（与 `LPC_DIRECTION_ROWS` 一致）；
- 精灵带只裁走路那 4 行 9 列（832×3456 的整表 → 576×256 进显存）；
- 纹理 key 按角色 id 走（同一角色的多个单位共用一张精灵表），LRU 封顶 24 张（perf 硬约束：纹理不许无限增长）；
- **无 appearance 的单位照旧走占位圆**（`resolveUnitSheetKey` 返回 null → 撤掉精灵、恢复占位半径）。

### 测试验证

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（零错误）

$ npx jest --silent --maxWorkers=2
Test Suites: 108 passed, 108 total
Tests:       6 skipped, 2439 passed, 2445 total
Snapshots:   0 total
Time:        20.847 s

$ npm run build
> stratix@0.1.0 build
> npm run build:backend && npm run build:frontend
> stratix@0.1.0 build:backend
> tsc && tsc-alias
> stratix@0.1.0 build:frontend
> vite build
✓ 70 modules transformed.
dist/frontend/assets/main-XuvOwtbL.js      181.83 kB │ gzip:  49.25 kB
dist/frontend/assets/phaser-DaAX4wSk.js  1,208.13 kB │ gzip: 332.21 kB
✓ built in 1m 44s
```

（上面这份是**最终提交代码**（含销毁竞态修复）上重跑的结果；首次跑出来的主包 hash 是
`main-JjhOq4dn.js`，差异只来自那处 `destroyed` 标志的补充改动。）

新增测试：
- `src/world/__tests__/unit-sprite-sheet.test.ts` —— 纯几何/命名（纹理 key、帧名、帧序、行数、动画参数有界、"要不要形象精灵"判定）；
- `src/app/__tests__/unit-sprite-source.test.ts` —— app 层编排（裁出走路 4 行、先等元数据就绪、失败降级返 null、并发请求串行化）；
- `src/core/__tests__/character.test.ts` —— `toCharacterUnit` 把 appearance 投影给单位（老角色无外观 → null）。

lint（只跑本次改动文件，未跑全量）：
```
$ npx eslint --cache=false <本次改动的 11 个源文件>
（零 error / 零 warning）
```

### 影响范围

- **改动面**：core 只加了一个可选字段（`UnitView.appearance`）+ 一处投影；world 只加渲染层与一个端口；app 只加一个服务实现与组合根接线。**没有改任何既有业务逻辑**。
- **性能**：合成画布复用（832×3456 只建一张）、合成串行（同一时刻只有一张合成大图）、纹理 LRU 封顶 24 张（约 14MB 上限）、动画只有一个全场定时器、素材元数据并发去重（`PartRegistry.loadMetadata` 的在途 promise）。
- **兼容性**：老单位没有 appearance → 走占位圆，行为与改动前一致。
- **顺带修的 027/028 内部缺陷（已注明）**：
  1. `PartRegistry.loadMetadata` 并发去重 —— 向导的随机形象与战场的形象合成会并发触发同一份 1.4MB 元数据加载，不去重就是白拉一次。
  2. `UnitLayer` 销毁后的竞态 —— 形象合成是异步的（要拉几十张精灵图），场景在这期间被关掉的话，合成 promise 回来后会在已销毁的场景上建纹理 / 重建显示对象。加了 `destroyed` 标志统一早退。
  3. `src/app/main/main-entry.ts` 的 `import/order` 报错 —— **HEAD 上就存在**（`../../world/*` 与 `../services/*` 同属 parent 组，中间却空了一行），不是本任务引入；本次借改该文件顺手修掉（删掉那一行空行）。

### dev 手测记录（2026-10-22）

环境：`npm run electron:dev`（backend + vite + electron，Node 23），`STRATIX_ONBOARDING_FORCE=1`。
手测用 CDP 驱动渲染进程（`--remote-debugging-port=9222`）做真实点击与裁剪截图取证。

| # | 步骤 | 结果 |
|---|---|---|
| 1 | 首启向导 → 扫描报告 | ✅ 11/11 项已探测，探测到 11 个 agent · 确认已装 4 个 · 可建档 4 个 |
| 2 | 下一步 → 起名与皮肤 | ✅ 列出 4 个已装 agent（Claude Code / OpenCode / Kimi / OpenClaw）+ 各自皮肤 + **形象预览 canvas（128×128）** |
| 3 | 形象预览 canvas 动画 | ✅ canvas 在 shadow DOM 内（`strat-onboarding-screen` 的 shadowRoot），Phaser WebGL 渲染；两次裁剪截图指纹不同 → **走路帧在动** |
| 4 | 点【随机形象】 | ✅ 形象整套换掉（截图对比：发色/肤色全变），预览 canvas 仍在动 |
| 5 | 下一步 → 人设生成 | ✅ 四道必答题（角色定位 / 沟通风格 / 自主程度 / 交付习惯），选完 persona 预览文本自动补上对应句 |
| 6 | 下一步 → 确认建档 | ✅ 确认页列出 4 个角色的完整形象规格，例如 `Claude Code … female · body:zombie_green · hair:ginger · eyes:blue · ears:dark gray · facial:ginger` |
| 7 | 点【完成建档】 | ✅ 向导关闭，HUD「单位 4」「单位总数 4」 |
| 8 | 战场单位渲染 | ✅ **4 个单位渲染成合成后的 LPC 形象**（不是占位圆），且**与确认页规格逐一对上**：zombie_green+ginger / bright_green+platinum / bronze+sandy / fur_white+purple |
| 9 | 战场走路动画 | ✅ 单位区两次裁剪截图指纹不同 → **走路动画在动**（8fps，帧序沿用 LPC walk cycle） |
| 10 | 渲染进程 console | ✅ **零应用报错**（只有 vite 连接日志、Phaser 版本横幅、Electron CSP 开发期警告） |
| 11 | 素材路径真机可达 | ✅ HTTP 实测：`/spritesheets/item-metadata.json` → 200 (1,426,719 B)；`/spritesheets/body/bodies/male/walk/light.png` → 200 (14,423 B)；`/spritesheets/shadow/adult/walk/shadow.png` → 200 (747 B)。另按 metadata 解析出的路径逐个核对 dist 里的真实文件均存在 |
| 12 | 收尾 | ✅ 手测后 electron / backend / vite 全部 kill 干净，7523 / 7524 / 7525 / 9222 端口已释放 |

**环境限制说明**：本机 Electron 窗口被摆在副屏且大部分在可视区外，AX 截图只能拿到极小一块画面；故改用 CDP `Page.captureScreenshot`（裁剪 + 指纹比对）取证，画面确认不受影响，动画"在动"由两次截图指纹差异客观判定，非肉眼估计。

截图存档：`docs/screenshots/task_029/`
- `01-wizard-step2-appearance-preview.png` —— 向导第②步：形象预览 canvas + 体型/部位选择器
- `02-wizard-random-appearance.png` —— 点【随机形象】后的新形象（对比 01 整套换掉）
- `03-battlefield-composed-sprites.png` —— 战场：4 个单位渲染成合成形象（单位 4 / 单位总数 4）
- `04-battlefield-units-closeup.png` —— 战场单位特写（zombie_green+ginger / bright_green+platinum / bronze+sandy / fur_white+purple，与确认页规格逐一对上）
- `05-wizard-canvas-preview-frame.png` —— 预览 canvas 单帧（shadow DOM 内嵌 Phaser）

**未尽事项（非本任务范围，仅记录）**：
- 角色档案目前只落在 `WorldState.characters`（core store，会话内），刷新页面后角色与战场单位都不在了 —— 是 v3 core 的会话级设计（"落库"指写入 store），不是 task_029 引入的。
- `shadow` 素材只有 `walk` / `shoot` / `spellcast` 等动画目录，**没有 `idle`** —— 预览与战场都用 `walk`（`DEFAULT_ANIMATION = 'walk'`），所以影子层正常合成；将来若改走 idle，影子层会被跳过（只是少一层影子，不影响画面）。

### 验证结果

见上「测试验证」「dev 手测记录」两节。
