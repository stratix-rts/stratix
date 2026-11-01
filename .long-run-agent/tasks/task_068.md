# task_068 hud: shortcut-help 关闭时释放焦点——修复 aria-hidden 告警

## 描述

用户点 `<strat-shortcut-help>` 浮层的 `×` 关闭钮时，console 报：

```
Blocked aria-hidden on an element because its descendant retained focus. ...
Element with focus: button
Ancestor with aria-hidden: <strat-shortcut-help role="dialog" aria-hidden="true">
```

根因链：macOS Chromium/Electron 点击 button 会给它焦点 → 点 `×` 时按钮先获焦 → click 派发 `SHORTCUT_HELP_CLOSE_REQUEST` → manager `setHelpOpen(false)` → `syncOpened(false)` 给宿主元素设 `aria-hidden="true"`（同时移除 `open` 属性 → display:none）——设 aria-hidden 那一刻焦点仍在浮层内的按钮上，Chromium a11y 引擎拦截告警。Esc / `?` 路径焦点在 body，不触发；只有点钮关闭才报。

## 需求（requirements）

1. `src/hud/components/shortcuts/shortcut-help.ts` 的 `syncOpened(false)` 关闭汇合点：在应用关闭态**之前**，若焦点在浮层内部（`this.shadowRoot.activeElement` 非空），先 `.blur()` 释放，再设 `aria-hidden` / 移除 `open`。一处改动覆盖所有关闭路径（close() / toggle() / manager 派发 / manager 卸载兜底）
2. 补单测（jsdom）：shadowRoot 内 focus `×` 钮 → 断言 `document.activeElement` 是宿主元素 → 调 `close()` → 断言焦点已离开宿主（回到 body）且 `aria-hidden="true"` 已设上。jsdom 的 `document.activeElement` 对 shadow 内焦点返回宿主元素，按此口径断言
3. 最小改动：只动 shortcut-help.ts + 对应测试文件

## 验收标准（acceptance）

- [ ] syncOpened(false) 在设 aria-hidden 前释放浮层内部焦点
- [ ] 单测覆盖「钮获焦 → close() → 焦点释放 + aria-hidden 设置」
- [ ] `npm run typecheck` 零错误
- [ ] `npx jest --silent` 全绿（3656 基线不回归）
- [ ] 最小改动原则

## 交付物

- `src/hud/components/shortcuts/shortcut-help.ts`：关闭前焦点释放逻辑 + 注释
- 对应测试文件：焦点释放用例

## 禁止事项

- 不加 focus trap、不引入 inert、不做打开时自动聚焦（超范围）
- 不重构组件结构、不改事件链路（close request → manager → close 的单一真相口径不动）
- 不 mock 数据、不引入新依赖

## 验证方式

```bash
npm run typecheck && npx jest --silent
```

## 验证证据（完成前必填）

- [ ] **实现证明**: 简要说明如何实现
- [ ] **测试验证**: 命令输出
- [ ] **影响范围**: 是否影响其他功能

### 测试步骤
1. npm run typecheck
2. npx jest --silent

### 验证结果
<!-- 粘贴命令输出或测试结果 -->
