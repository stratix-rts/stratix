# task_024

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_024.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 代码 + 测试

## 描述

hud: 皮肤库扩展（≥6 套 token 变体 + 徽标色 + 随机分配）-模块

## requirements

src/hud/theme/ 扩展皮肤库：在现有 tokens-default/pixel 基础上新增 ≥6 套 token 变体（命名如 crimson/forest/ocean/sunset/mono/aurora），每套含徽标色 accent。skin-registry.ts 提供 listSkins()/randomSkin()。角色头像/单位染色用 skin accent。

## design

纯 token 文件 + registry，不动组件结构。像素皮肤保留既有像素变体位。

## acceptance

- tsc 零错误
- randomSkin() 不重复抽签单测（种子注入）
- 每套皮肤 CSS 变量齐全性单测（键集合一致）
- jest src/hud 全绿

## 交付物

按 design 落地的新增/修改文件 + 对应测试

## 验证证据（完成前必填）

- [x] **实现证明**: 简要说明如何实现
- [x] **测试验证**: typecheck + 对应目录 jest 输出原样贴出
- [x] **影响范围**: 是否影响其他功能

### 验证结果

<!-- 粘贴命令输出 -->

#### 实现说明

1. **token 变体（新增 6 套）**：`src/hud/theme/tokens-{crimson,forest,ocean,sunset,mono,aurora}.css`。
   每套都是**自足**的 token 集（30 个 `--srf-*` 变量，不依赖 default 先挂载），键集合与规范清单严格一致
   （`skin-tokens.test.ts` 逐套核对：不多不少、每个都有非空值）。
   同时把 `tokens-default.css` / `tokens-pixel.css` 补齐到同一键集合
   （pixel 原先只覆写差异字段、缺 6 个变量，现补 `--srf-line-height` + 4 个 `--srf-spacing-*`；
   像素变体位保留：radius 0 / border 2px / pixelated / scanline 0.08 / Courier New 均有回归用例）。
2. **徽标色**：每套皮肤新增 `--srf-badge-accent` token（角色头像 / 单位染色用），
   值与 `skin-registry.ts` 里该皮肤的 `accent` 同值 —— 两者由单测锁死，防漂移。
3. **skin-registry.ts**（新增）：
   - `listSkins()` / `getSkin(id)` / `isSkinId(id)` / `resolveAccent(skinId)`；
   - `randomSkin(seed?)` + `createSkinRandomizer(seed?)`：mulberry32 确定性 PRNG + 洗牌袋，
     **一轮之内不重复**，抽完整轮才重新洗牌；`seed` 可注入 → 同种子同序列（可测）。
     `SkinId` 是字符串资源键，可直接当 `AgentProfile.skinId` 用（core 只校验非空 + 长度）。
   - registry **不 import *.css**（jest 无 css transform），样式表由调用方注入。
4. **theme-controller.ts**：id 词表改为泛型（`ThemeController<Id extends string = string>`）——
   新增皮肤不必再改控制器；`apply()` 遇未注册 id 直接抛错（否则会把所有样式表 disable 掉，HUD 掉光 token）。
   core 的 `theme.set` 载荷仍是 `'default' | 'pixel'`（**未改 core**），故新皮肤走 hud 本地控制器切换。
5. **hud-dev-entry.ts**：一次性注入全部 8 套皮肤（`Record<SkinId, string>` —— 漏引样式表 tsc 立刻报错），
   dev 下可用 `__srfHud.themeController.apply('crimson')` 现场切皮肤。

#### 验证输出

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（无输出 = 零错误）

$ npx jest src/hud --silent
Test Suites: 16 passed, 16 total
Tests:       343 passed, 343 total
Snapshots:   0 total
Time:        3.506 s
```

其中新增用例：`src/hud/theme/__tests__/skin-registry.test.ts`（清单 / 徽标色 / 抽签不重复 / 同种子可复现，
16 例）、`src/hud/theme/__tests__/skin-tokens.test.ts`（8 套皮肤键集合一致性 + 值非空 + 像素变体位，
42 例）、`theme-controller.test.ts` 追加「多皮肤」2 例。

全量回归（防止改动外溢）：`npx jest --silent` → **96 suites / 2291 passed / 6 skipped / 0 failed**。
lint（只跑改动文件）：`npx eslint --cache src/hud/theme/skin-registry.ts src/hud/theme/theme-controller.ts src/hud/dev/hud-dev-entry.ts` → 0 error。

#### 影响范围

- 只动 `src/hud/theme/**` 与 `src/hud/dev/hud-dev-entry.ts`（+ README）；**未碰** `src/core` / `src/world` / `src/app`，
  未引入新依赖，未改任何组件结构（DOM / 组件层级零改动）。
- 行为变化仅两处：① `theme-controller.apply()` 对未注册 id 由「静默 disable 全部样式表」改为抛错（更早暴露）；
  ② 控制器可切皮肤 id 从 2 个放宽到任意（词表由调用方给）。
- 既有 `theme.set` 通路（default / pixel）行为不变；core 侧记录口径未变。
- **未尽事项**：HUD 设置屏只列 default / pixel 两个皮肤按钮 —— core 的 `theme.set` 载荷是
  `'default' | 'pixel'` 窄联合，放宽它必须改 `src/core/types.ts`（本任务禁改 core）。
  新皮肤当前通过 registry API + dev 控制器可达，正式 UI 入口留待 core 侧放开后再接。
