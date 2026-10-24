# task_032: 向导交互重做——每 agent 独立形象

## 描述
修复交互缺陷：目前向导第②步上方列所有 agent、下方只有一个共享形象选择框。需求是**每个 agent 都有自己的形象**：默认取品牌预设（task_031），用户可单独修改/重随机，提交时各带各的 appearance。

## 需求
1. **每 agent 一份形象状态**：向导屏内部 `Map<agentKind|agentId, AppearanceDraft>`，初始值 = 品牌预设（031），无预设走 minimal 档规则随机（030）一次生成后固定为该 agent 的初始值
2. **交互结构**（对齐现四步流，重做第②步布局）：
   - agent 列表（可折叠卡片或左右分栏：左列表右详情）
   - 选中某个 agent → canvas 预览显示**该 agent** 的形象（走路动画），下方是该 agent 的部件选择器（复用 028 的选择器组件，数据源切到该 agent 的 draft）
   - 每个 agent 卡片：小缩略/色点 + 「重随机」按钮（规则随机 normal 档）+ 「重置为品牌默认」按钮
   - 全部 agent 确认后才进第③步（或保持现有逐步流转，以现架构自然为准，不强制）
3. **提交**：每个 agent 走 `character.create`，appearance 带各自的（itemId 精确格式）
4. **预览服务**：继续走 main-entry 组合根注入的 AppearancePreviewService（总线铁律不动），支持切换目标形象时热替换
5. 单测：draft map 初始化（预设命中/兜底）、切换 agent 预览事件、重随机/重置按钮事件、提交逐 agent 带 appearance；jsdom 下无法真跑 Phaser 的部分照旧注入桩

## 上下文
- 现向导屏：`src/hud/screens/onboarding-screen/`（028 交付：canvas 预览+选择器，数据流事件化）
- 预览服务注入链：`src/app/main/main-entry.ts` → 向导屏
- 品牌预设：task_031 的 brand-presets；规则随机：task_030 的 appearance-randomizer（hud 不直接 import world——预设与随机器经组合根/注入提供）

## 验收标准
- [ ] tsc 零错误
- [ ] npx jest src/hud 全绿（028 的 375 测试允许因布局重构改断言，需注明）
- [ ] 交互单测：多 agent 各自 draft、预设/兜底初始化、重随机、提交带各自 appearance
- [ ] hud 无 world/core 越界 import（总线铁律）

## 验证方式
npm run typecheck && npx jest src/hud --silent

## 验证结果（2026-10-24，task_032 执行者填）

- `npm run typecheck`：零错误 ✅
- `npx jest src/hud --silent`：**381/381 全绿**（17 套件）✅
  - 028 原向导形象测试 12 条按新交互改写为 15 条（`onboarding-appearance.test.ts`）：
    初始随机 → 初始品牌预设；「随机形象」面板按钮 → 每 agent 卡片级「重随机 / 重置为品牌默认」（带 data-kind）。
    注：src/hud 原为 375 测试，因本重构改断言 + 新增草稿纯逻辑用例净 +6。
- `npx jest src/app --silent`：97/97 全绿（预览服务新增 preset/randomizeNormal 4 条用例）✅
- 全量 `npx jest`：2534 passed / 6 skipped / 0 failed ✅
- `npm run lint`：本任务改动文件 0 error（仓库存量 4 个 error 均在未触碰文件：
  appearance-preview-game.ts / OpenClawAgent.ts，HEAD 上即存在）✅
- 顺手修复：onboarding-screen.ts:55 的 `import/order` 空行 lint error ✅

## 交付说明

- **草稿模型**：`src/hud/screens/onboarding-catalog.ts` 新增纯逻辑层
  `AppearanceDraft` / `cloneAppearance`（深拷贝，两种部件形态都保留）/
  `createAppearanceDrafts`（Map 初始化：预设命中→独立深拷贝，预设返 null→不进表等回填）。
- **端口演进**：`AppearancePreviewPort` 的 `randomize()`（变体级随机）退役，
  换成 `preset(kind)`（品牌预设/规则随机兜底）与 `randomizeNormal()`（030 随机器 normal 档，itemId 格式）。
- **屏内**：`onboarding-screen.ts` 以 `_appearanceDrafts: Map<kind, AppearanceDraft>` 存每 agent 独立草稿；
  身份卡片各带「重随机」「重置为品牌默认」（data-kind 指定目标）；下方形象面板预览当前选中 agent
  （canvas 热替换 + 部件选择器数据源切到该 agent 的草稿）；提交逐 agent 带各自 appearance。
- **组合根**：hud 无任何 world import（护栏测试锁死）；品牌预设（brand-presets）与
  规则随机器（appearance-randomizer）只在 app 层 `appearance-preview-service.ts` 接入，
  注入链不变（main-entry → onboarding-host → 向导屏），main-entry 零改动。

## 未尽事项

- 部件选择器仍是**变体级**下拉（改某部件会丢该部件的 itemId 精确指定，其余部件保留）——
  条目级选择器（91 款发型逐款挑）留给 v3.x 换装面板（028 的口径未变）。
- 向导四步流转保持既有逐步推进（未强制"全部 agent 确认后才能进③"，任务允许）。
