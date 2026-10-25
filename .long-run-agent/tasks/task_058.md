# task_058 快捷键系统
## 需求
v2 ShortcutManager 移植：框选全选/编组 Ctrl+数字/选中编组数字/空格居中/Esc 取消选择等。
## 要点
1. 考古 git show master:src/stratix-rts/ui/ShortcutManager.ts 口径移植
2. 快捷键表集中常量（可后续做设置面板）；输入框聚焦时全局快捷键不劫持
3. 覆盖：全选/取消/编组 1-9/召回编组/居中选中/删除单位（如有删除语义则跳过）
4. HUD 帮助浮层（? 键）列出全部快捷键
## 验收
- 编组/召回/居中实测可用；帮助浮层齐全
- typecheck/jest 全绿

---

## 验证结果（执行完成）

- **typecheck**：`npm run typecheck` 通过（0 错误）。
- **jest**：`npx jest --silent` 全绿 —— 158 suites / **3523 passed / 6 skipped / 0 failed**（基线 3457 + 新增 66，无回归）。
- 新增/扩展测试：`src/core/__tests__/group.test.ts`（编组槽位纯函数 +12）、`src/core/__tests__/runtime.test.ts`（group.assign/recall 命令 +11）、`src/hud/__tests__/shortcut-catalog.test.ts`（键位映射/豁免/格式化 +15）、`src/hud/__tests__/shortcut-manager.test.ts`（命令分发/豁免/浮层开关/质心 +20）、`src/hud/__tests__/shortcut-help.test.ts`（浮层开关/渲染/关闭请求 +8）。

### 落地口径摘要

- **键位表**（hud/components/shortcuts/shortcut-catalog.ts，集中常量，血缘注记 v2 ShortcutManager）：
  Ctrl/⌘+A 全选（unit.select set 全体 id）｜Esc 取消选择（浮层打开时优先关浮层）｜Ctrl/⌘+1..9 编组存入（unit.group.assign）｜裸 1..9 召回（unit.group.recall）｜Space 居中选中质心（无选中/坐标未知回世界中心，camera.center）｜? 帮助浮层开关。
- **豁免**：input/textarea/select/contenteditable 聚焦时全部快捷键让路（isEditableTarget，contenteditable 双查兼容 jsdom）；按钮/链接焦点上 Space 让给原生激活（isActivatableTarget）。
- **分组存储**：WorldState.selectionGroups（ReadonlyMap<number, readonly string[]>，可选字段；起步建空 Map）；core/unit/group.ts 纯函数（isControlGroupSlot / assignControlGroup / readControlGroupUnitIds），不可变 + 同槽同成员幂等（同引用 → 零广播）；runtime 接线 unit.group.assign / unit.group.recall，反馈 Notice 与状态变更合并在**同一次** setState（一次操作一次广播），召回前对账已消失单位。
- **帮助浮层**：`<strat-shortcut-help>`（hud WebComponents，z-index 60），清单从 SHORTCUT_CATALOG 同源渲染（含 045/057 鼠标交互展示组）；Esc / ? / 点遮罩 / × 钮四路关闭，真相位在管理器（helpOpen），浮层只做渲染镜像。
- **取舍**（按任务可选条款）：不做 HUD 单位卡分组徽标 —— 召回反馈用 core Notice（「召回编组 N（x 单位）」/「已存入编组 N（x 单位）」）呈现于命令面板 notices 区，轻量且零新 UI 面。编组不落库（会话内有效；跨会话持久化留待后续任务，字段注已说明）。
- **接线**：main-entry mountShortcuts（dispatch → adapter.dispatch；坐标口复用小地图的 minimapPositions 同一份累积表）；pagehide 随之卸载。
