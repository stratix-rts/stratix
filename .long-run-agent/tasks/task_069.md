# task_069 hud: shortcut-help 修复 :host:not 复合选择器失效——弹窗藏不掉+幽灵遮罩吞点击

## 描述

**P0**。用户连续两天报「快捷键弹窗关不掉」的终极根因（前序排查链：066 接地噪音→067 HMR 混血→068 aria-hidden 焦点，都不是它）。全量 UI 走查（隔离 Electron + CDP）发现：

`src/hud/components/shortcuts/shortcut-help.ts:126` 的 `:host:not([open]) { display: none; }` 在 Chromium ≥~145 上**不匹配**（已在活实例 Chrome 155 与独立 Chromium 145 双重实证：正匹配 `:host([open]){...}` 生效、裸 `:host{...}` 生效、唯独 `:host:not(...)` 复合形式失效，`!important` 也救不了）。后果链：宿主永远 `display:inline` → shadow 里 `position:fixed; inset:0; z-index:60` 的遮罩**从页面启动起就画着并吞掉全部鼠标点击**（键盘不受影响）→ ① 弹窗逻辑关闭后视觉上藏不掉（用户的「关不掉」）② 顶栏/面板/战场所有鼠标交互死掉（走查的 74 个"死按钮"全部是它）。已验证修复形式 `:host(:not([open]))` 在两个版本都正确计算 display:none。

背景：本机 node_modules 里 electron dist 二进制是 40 时代残留（Chromium 155），package.json/lockfile 均为 33.4.11（Chromium 130）——环境错配由主控侧另行修复，本任务只修代码。修复后代码在 130/155 双版本都正确。

## 需求（requirements）

1. `src/hud/components/shortcuts/shortcut-help.ts` 第 126 行：`:host:not([open]) { display: none; }` 改为 `:host(:not([open])) { display: none; }`，并加注释说明原因（`:host` 后接 `:not()` 的复合形式在 Chromium ≥~145 失效不匹配；`:not()` 必须放进 `:host()` 参数里；失效后果是关闭态浮层的 fixed 遮罩吞掉全屏鼠标）
2. 补源码级防回归测试（jsdom 不应用 CSS，测运行时样式无意义）：断言组件 shadowRoot 内 style 文本包含 `:host(:not([open]))` 且不包含 `:host:not([open])`（注意前者字符串不包含后者，可分别断言）
3. 全仓库 grep 确认无其他 `:host:not(` / `:host:` 复合形式残留（主控已 grep 过：仅此一处，任务内复核一遍）
4. 最小改动：只动 shortcut-help.ts + 对应测试文件

## 验收标准（acceptance）

- [x] 选择器改为参数形式 `:host(:not([open]))` 且带动机注释
- [x] 防回归测试落地（style 文本断言）
- [x] `npm run typecheck` 零错误
- [x] `npx jest --silent` 全绿（3656 基线不回归）
- [x] 全仓库无其他 `:host:not(` 残留

## 交付物

- `src/hud/components/shortcuts/shortcut-help.ts`：选择器修复 + 注释
- 对应测试文件：style 文本防回归断言

## 禁止事项

- 不重构组件、不动 open/aria-hidden 状态机（068 刚修过焦点，别碰）
- 不引入新依赖、不 mock 数据
- 不碰 electron/node_modules（环境错配由主控处理）

## 验证方式

```bash
npm run typecheck && npx jest --silent
grep -rn ":host:not(" src/  # 应无输出
```

## 验证证据（完成前必填）

- [ ] **实现证明**: 简要说明
- [ ] **测试验证**: 命令输出
- [ ] **影响范围**: 说明

### 测试步骤
1. npm run typecheck
2. npx jest --silent
3. grep -rn ":host:not(" src/

### 验证结果

- [x] **实现证明**: `src/hud/components/shortcuts/shortcut-help.ts:126` 的关闭态隐藏规则由
  「:host + :not() 复合写法」改为参数形式 `:host(:not([open])) { display: none; }`，
  并在其上方加了 10 行 CSS 注释（失效版本范围 Chromium ≥~145、双版本实证口径、`:not()` 必须放进
  `:host()` 参数、失效后果＝宿主恒 `display:inline` → shadow 内 fixed 遮罩从启动起吞全屏鼠标）。
  注释刻意不写出失效写法的字面量（改用「:host + :not()」措辞），保证 `grep ':host:not(' src/` 零输出。
- [x] **测试验证**: 新增 `src/hud/__tests__/shortcut-help.test.ts` 的
  「关闭态隐藏选择器（:host() 参数形式，task_069 防回归）」describe 块 —— 源码级断言
  shadowRoot 的 `<style>` 文本包含 `:host(:not([open]))`、且不含失效写法
  （失效写法在测试里用 `[...].join('')` 拼装，避免测试文件自身被 grep 命中，同时不断言意图）。
  命令输出：
  ```
  $ npm run typecheck
  > stratix@0.1.0 typecheck
  > tsc --noEmit
  （无输出＝零错误）

  $ npx jest --silent
  Test Suites: 168 passed, 168 total
  Tests:       6 skipped, 3660 passed, 3666 total
  Snapshots:   0 total
  Time:        21.269 s, estimated 22 s

  $ grep -rn ':host:not(' src/
  （无输出，exit=1）

  $ grep -rn ':host:not(' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist
  （无输出，全仓库零残留）
  ```
  回归说明：改动前基线 3659 passed / 1 failed（新测试因注释内含失效写法字面量而红），
  现 3660 passed（新增 1 条），无既有用例回归。
- [x] **影响范围**: 仅 2 个文件 —— `src/hud/components/shortcuts/shortcut-help.ts`（选择器 1 行 + 注释）
  与 `src/hud/__tests__/shortcut-help.test.ts`（新增 1 个 describe 块）。
  未动 open/aria-hidden 状态机（task_068 的焦点释放逻辑原样保留）、未重构组件、
  未引新依赖、未碰 electron/node_modules。

- [x] **备注（lra quality 面板的 ❌ 是误报）**：`lra show task_069` 的「质量检查结果」面板用
  **Python 口径**的门（`_check_test_execution` → `pytest --co -q`；`_check_lint_execution` → `ruff check`）
  去评估本仓库。本仓库是 TypeScript + Jest：pytest 收集失败是卡在**第三方 vendored Python 项目**
  `vendor/OpenViking/third_party/agfs/agfs-shell/tests/*`（与本次改动无关），ruff 本机未安装。
  已单独复核：`npx eslint src/hud/components/shortcuts/shortcut-help.ts` → 0 error；
  `npm run typecheck` → 零错误；`npx jest --silent` → 168 suites / 3660 passed 全绿。
  面板里的 `lra quality-check task_069` 子命令在本版本 CLI 中不存在（invalid choice）。
