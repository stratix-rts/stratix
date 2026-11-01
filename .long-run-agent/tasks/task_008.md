# task_008

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_008.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: command-panel命令面板-模块

## requirements

在 `src/hud/panels/` 建 command-panel Web Component，把旧 `CommandPanel`（选中单位后的操作）与
`CommandPalette`（全局命令）的功能语义合并为**唯一命令入口**。

1. **选中态**：有选中单位时显示可用操作 —— 发起任务 / 聊天 / 配置 / 停止 / 取消选择等，命令清单从旧组件提取。
2. **未选中态**：显示全局命令入口（导航 / 创建等），任何时候命令入口都不为空。
3. **一切走总线**：所有操作以 `HudCommand` 形式经 `bus-adapter` 发往 core，面板不直接调 core 内部、不依赖 vxe。
4. **状态驱动**：面板显示由 `WorldState`（selection / missions / notices）驱动，判断权在 core，HUD 不自建业务态。
5. **契约增补**：`src/core/types.ts` 的 `HudCommand` 变体若不足以表达命令清单，可增补（加 `@since v3.1` 注释，
   **不破坏既有变体**）；除 types.ts 增补外不动 core 任何文件。
6. **参考只读**：`src/components/CommandPanel.vue` / `CommandPalette.vue` 只提取语义，UI 全部重写为 Web Components，
   **禁止复制 Vue 代码**；不迁移旧组件本体。
7. **硬约束**：不引入新依赖；不碰 `src/world`、`src/core/agent-link`；不 mock 数据；最小改动；每个新文件头部写契约注释。

## acceptance

- [x] 面板可用：挂进 `main-screen`（dev 页同路径）后可操作，jsdom 集成测试走真实组件断言
- [x] 所有命令走 `HudCommand` 总线：无直接调用 core 内部、无 vxe 依赖
- [x] `npm run typecheck` / `npm run build` 全绿
- [x] 命令派发有单测：`command-catalog.test.ts`（构造）+ `command-panel.test.ts`（jsdom 派发），共 45 例

## 交付物

- `src/hud/panels/command-catalog.ts`（新增，纯逻辑）：命令目录 + WorldState 驱动的可用性判定 + HudCommand 构造 + 搜索过滤 + 渲染签名
- `src/hud/panels/command-panel.ts`（新增，Web Component）：`<strat-command-panel>`，Shadow DOM，视觉全走 `--srf-*` token
- `src/hud/screens/main-screen.ts`（改）：body 里挂载命令面板，与顶栏共用同一个 adapter
- `src/core/types.ts`（改）：`@since v3.1` 增补 `mission.create` / `mission.cancel` / `ScreenId` 加 `'chat'`
- `src/hud/__tests__/command-catalog.test.ts`（新增，node 环境）：命令构造与判定 24 例
- `src/hud/__tests__/command-panel.test.ts`（新增，jsdom）：挂载/派发/搜索/退订 21 例
- `src/hud/__tests__/bus-adapter.test.ts`（改）：补 `links` / `messages` 字段，修掉并行任务遗留的编译失败

## 验证证据（完成前必填）

<!-- 标记完成前，请提供以下证据： -->

- [x] **实现证明**: 面板分两层——`command-catalog.ts` 是零 DOM 的纯函数层（判定+构造，可在 node 环境单测），`command-panel.ts` 只负责把 WorldState 画成列表、把点击经注入的 adapter 派发。命令清单合并自旧 `CommandPanel.vue`（聊天/配置/任务/停止/取消选择）与 `useCommandPalette.ts`（导航/创建/皮肤），只提取语义，UI 全部重写。未迁移的旧命令（Zone 相关、相机缩放、刷新/音效）在文件头写明理由：Zone 已砍（D5）、相机由 world 层自治而 WorldState 无相机字段、契约无对应变体。
- [x] **测试验证**: `npm run typecheck` exit 0；`npm run build` exit 0；`npm test` exit 0（130 suites / 3120 passed）；新增两个测试文件共 45 例，覆盖命令构造、WorldState 驱动可用性、jsdom 里真点 shadow DOM 按钮断言派发出的 HudCommand、卸载后订阅归零。
- [x] **影响范围**: 仅 HUD 层 + core 契约增补。既有 9 个 v3 测试套件（hud/app/core）全部通过，hello-loop 集成测试未受影响。core 侧新命令走 `runtime.ts` 既有 `default → onUnhandled` 分支，不会崩；未触碰 src/world 与 src/core/agent-link。

### 测试步骤
1. `npm run typecheck`
2. `npm run build`
3. `npm test`

### 验证结果

```
TYPECHECK_EXIT=0
BUILD_EXIT=0   ✓ built in 1m 51s
TEST_EXIT=0
Test Suites: 130 passed, 130 total
Tests:       7 skipped, 3120 passed, 3127 total
```

命令面板专项（`npx jest src/hud src/app src/core/__tests__ --maxWorkers=1`）：9 suites / 132 tests 全绿，其中
`PASS src/hud/__tests__/command-panel.test.ts`、`PASS src/hud/__tests__/command-catalog.test.ts`。