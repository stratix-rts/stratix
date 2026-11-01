# task_028

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_028.md`

**工作目录**: 项目根目录

## 描述

hud: 向导第②步重做——canvas 动画预览+随机形象+部件选择器（LPC）-模块

## requirements

hud 向导第②步（src/hud/screens/onboarding-screen）升级：①内嵌 Phaser 迷你 canvas 实时预览合成角色（走路动画帧步进，参考历史 CanvasPreview.vue 的实现思路——Phaser sprite + 手动帧推进，历史源码 git show a9498ae~1:src/components/character-creator/v3/components/CanvasPreview.vue）②「随机形象」按钮（随机 LPC 部件组合，body/hair/eyes/ears/facial 五类精选）③分类部件选择器 UI（每类列 variant，元数据来自 PartRegistry 注入）④character.create 提交带 appearance 字段。UI 主题色随机（024 皮肤库）保留。WebComponent 内嵌 Phaser 实例注意销毁清理（向导关闭即 destroy）。

## design

hud 组件不直接 import world 合成器？——总线铁律是 hud/world 互不引用。方案：main-entry 组合根创建 appearance 预览服务（持 Phaser 迷实例与合成器）注入向导屏；向导屏只发「部件变更/随机/预览」事件给服务。向导屏单测不碰真 canvas（注入桩预览服务），真 canvas 手测归 029。

## acceptance

- tsc 零错误
- 步骤流转/随机形象/选择器事件/提交带 appearance 单测（预览服务注入桩）
- Phaser 实例生命周期（destroy）单测
- jest src/hud 全绿

## 交付物

按 design 落地的新增/修改文件 + 测试

## 验证证据（完成前必填）

- [ ] **实现证明**: 简要说明
- [ ] **测试验证**: typecheck + jest 输出贴出
- [ ] **影响范围**: 说明

### 验证结果

### 实现证明

**分层与接线（总线隔离铁律）**

- `src/hud/screens/appearance-preview-port.ts`（新增）：hud 侧**端口契约** `AppearancePreviewPort`
  （bodyTypes / listCategories / whenReady / randomize / attach / preview / destroy）+ `AppearanceCategoryInfo`。
  屏只认这个接口，**不 import world / phaser**。
- `src/app/services/appearance-preview-service.ts`（新增）：端口实现 —— 认识 world 的
  `PartRegistry`（素材元数据 + 变体清单）与 `CharacterComposer`（合成），负责：
  ①按体型过滤出五类（body/hair/eyes/ears/facial）的可选变体；②随机形象（bodyType 在 male/female 间抽）；
  ③合成走路动画精灵表并交给预览实例（画布复用同一张，过期结果丢弃）；④懒加载 1.4MB 的素材元数据。
- `src/app/services/appearance-preview-game.ts`（新增）：**Phaser 迷你实例**（思路取自历史
  `CanvasPreview.vue`：sprite + 手动帧步进；帧序列用 `ANIMATION_CONFIGS.walk.cycle`，不另起一套）。
  只用 `import type` 引入服务侧类型 —— **Phaser 不进服务的依赖图**（jsdom 里 Phaser 连 import 都过不去，
  真 Phaser 的手测归 task_029）。
- `src/app/main/main-entry.ts`（组合根）：创建预览服务 → 注入 `createOnboardingHost` → 挂到向导屏；
  `pagehide` 时兜底 destroy。
- `src/hud/screens/onboarding-screen.ts`：第②步重做 —— 画布宿主（跨重渲染保留同一元素，
  否则 Phaser 的 canvas 被摘掉）+「随机形象」按钮 + 体型/部件选择器 + 每条身份可切换预览对象；
  `character.create` 提交带 `appearance`（没选过则不带该字段）。

**core 落地**：appearance 此前只到 `profile.ts` 这一层，`character.create` 命令并不带它。
本次补齐三处，让"选了长相"真的落库：`core/types.ts`（HudCommand 加 `appearance?`）、
`core/runtime.ts`（透传给 manager）、`core/character/manager.ts`（进 profile + 写进 CharacterView；
没给就不带这个键，老档案形状不变）。

### 测试验证

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（零错误）

$ npx jest src/hud --silent
Test Suites: 17 passed, 17 total
Tests:       375 passed, 375 total

$ npx jest --silent
Test Suites: 106 passed, 106 total
Tests:       6 skipped, 2428 passed, 2434 total
```

新增测试：
- `src/hud/__tests__/onboarding-appearance.test.ts`（13 例）：步骤流转 / 随机形象 / 部件与体型选择器 /
  预览对象切换 / 提交带 appearance / **预览实例 destroy 生命周期** / 无端口降级 / 画布宿主跨重渲染存活 /
  **架构护栏**（屏与端口不 import world-phaser；服务不把 Phaser 拖进依赖图）。
- `src/app/__tests__/appearance-preview-service.test.ts`（7 例）：变体清单按体型过滤 / 随机形象 /
  素材缺失返 null / attach 幂等 / preview 合成上屏 / 过期结果丢弃 / destroy 生命周期。
- `src/core/__tests__/character.test.ts`（+3 例）：appearance 落库 / 不带则无该键 / 非法 appearance 拒发。

### 影响范围

- 改动：`src/hud/screens/onboarding-screen.ts`、`src/hud/screens/appearance-preview-port.ts`（新）、
  `src/app/services/appearance-preview-service.ts`（新）、`src/app/services/appearance-preview-game.ts`（新）、
  `src/app/main/main-entry.ts`、`src/app/main/onboarding-host.ts`、
  `src/core/types.ts`、`src/core/runtime.ts`、`src/core/character/manager.ts` + 三个测试文件。
- 未动：`src/world/appearance/**`（只消费，不改内部）、无新依赖。
- 向导屏未注入端口时**照常能走完**（只是没有形象功能）—— 027 的合成栈不接也不会挡住首启。
