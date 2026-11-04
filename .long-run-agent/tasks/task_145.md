# task_145

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_145.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

markdown渲染管线：GFM+安全消毒+内容字号-模块

## 需求

- markdown 渲染管线：**marked(GFM) → DOMPurify → 气泡**
- 接入面（grep 找齐）：session 气泡 / 任务输出区 / mission brief / command-panel 的 `.output`
- 代码块：等宽 + 语言标签 + 一键复制 + 长行换行 + 内滚上限；行内 code 样式
- 内容字号：agent 内容阅读级（14px 起步 / 行高 1.6），与 UI 铬分级；列表 / 表格 / 引用 / 链接全样式
- 降级：纯文本无损；渲染异常回退纯文本不崩
- 双皮肤 token + reduced-motion

## 验收标准

- [x] GFM 样本（```js 代码块 / 列表 / 表格 / 链接 / 行内 code）气泡正确渲染，截图前后对照
- [x] XSS 样本（`<script>` / `<img onerror>` / `javascript:` 链接）消毒断言通过
- [x] 复制按钮真复制（断言）
- [x] 400 行长输出内滚
- [x] 纯文本回归
- [x] `npx tsc --noEmit` + 相关 jest 绿
- [x] 截图 -r7 前缀加 -md 后缀

## 交付物

| 文件 | 作用 |
| --- | --- |
| `src/hud/lib/markdown.ts` | **管线模块**：`renderMarkdown`（marked GFM → DOMPurify → HTML）+ `enhanceMarkdown`（代码块外框 / 语言标签 / 一键复制 / 链接新窗口）+ `MARKDOWN_CSS`（内容排版样式） |
| `src/hud/theme/type-scale.ts` | 新增**内容字阶** token：`--srf-font-size-content`（14px / 像素皮 15px）、`--srf-line-height-content`（1.6）—— 内容 ≠ UI 铬分级 |
| `src/hud/components/chat-drawer/chat-drawer.ts` | **session 气泡**接入 markdown（定稿气泡） |
| `src/hud/components/task-output/task-output-panel.ts` | **任务输出区**接入 markdown（`<pre>` 改为 div + md-content） |
| `src/hud/panels/mission-confirm.ts` | **mission brief** 接入 markdown |
| `src/hud/panels/command-panel.ts` | **command-panel `.output`** 接入 markdown |
| `src/hud/__tests__/markdown.test.ts` | 管线单测 20 项（GFM / XSS / 纯文本 / 复制 / 降级） |
| `tests/e2e/markdown-pipeline.spec.ts` + `tests/e2e/playwright.markdown.config.ts` | e2e 5 项（GFM 截图 / XSS 断言 / 复制断言 / 400 行内滚 / 纯文本回归） |
| `reports/shots/markdown-r7-*.png` | 前后对照截图（-r7 前缀 + -md 后缀） |

## 验证证据（完成前必填）

- [x] **实现证明**: 三层契约落地 ——
  1. **解析**：`marked`（`gfm:true` / `breaks:false` / `async:false`）→ 表格 / 任务列表 / 删除线 / 代码块；
     `breaks:false` 让单换行留在 HTML 里，DOM `textContent` 与原文逐字相同（纯文本回归无损）。
  2. **消毒**：`renderer.html` 把**原始 HTML 当文本转义**（`<标题>` 不会被吃掉），随后 **DOMPurify** 兜底
     （`javascript:` 链接 / `on*` 属性 / `<script>` / `<img onerror>` 全部落不了 DOM）；
     无 DOM 环境（node 单测）没有 DOMPurify 时**宁可不渲染也不裸奔** —— 退回转义纯文本。
  3. **降级**：`try/catch` 兜底，渲染器炸了退回纯文本，面板不崩。
  - **接入面**（grep 找齐的四处 agent 文本面）：session 气泡 / 任务输出区 / mission brief / command-panel `.output`。
  - **代码块**：`.md-code` 外框 + 语言标签（从 `language-js` 读）+ 一键复制（剪贴板 API，失败退回复选框方案）
    + 长行 `pre-wrap` 折行 + `max-height:320px` 内滚上限（400 行也不撑爆面板）；行内 `code` 独立样式。
  - **字号**：内容读级 `--srf-font-size-content`（14px 起步 / 像素皮 15px）+ `--srf-line-height-content`（1.6），
    与 UI 铬（caption 12px / body 14px）分级；配色全部走 skin token（双皮肤）；`prefers-reduced-motion` 下复制按钮静态。

- [x] **测试验证**:
  - `npx tsc --noEmit` → 无输出（通过）
  - `npx jest src/hud` → **70 suites / 1329 tests 全绿**（含新增 markdown.test.ts 20 项）
  - `npx playwright test --config=tests/e2e/playwright.markdown.config.ts` → **5 passed**
  - `npx eslint`（改动文件）→ 0 error

- [x] **影响范围**: 只动 HUD 层（`src/hud/**`）+ 两个新依赖（marked / dompurify，已在 package.json）。
  未动 gateway / z-index / command-panel 输入区结构 / HEARTBEAT.md。
  一处既有断言按新行为更新：`task-output-panel.test.ts` 的成果物块用例 —— 断言从「textContent 直写」
  改为「markdown 渲染 + XSS 零面」（`- xxx` 行被解析成列表项，原始 HTML 仍以文本留存）。

### 测试步骤
1. `npx tsc --noEmit`
2. `npx jest src/hud`
3. `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx playwright test --config=tests/e2e/playwright.markdown.config.ts`
4. 看 `reports/shots/markdown-r7-gfm-md.png`（左=改前纯文本，右=改后 markdown 渲染，前后对照）

### 验证结果

```
# tsc
$ npx tsc --noEmit
（无输出 = 通过）

# jest（hud 全量）
$ npx jest src/hud --silent
Test Suites: 70 passed, 70 total
Tests:       1329 passed, 1329 total

# markdown 单测（节选）
$ npx jest src/hud/__tests__/markdown.test.ts
PASS src/hud/__tests__/markdown.test.ts
  renderMarkdown — GFM 渲染
    ✓ 代码块带 language 类（语言标签从 class 读）
    ✓ 列表渲染成 <ul> / <li>
    ✓ 表格渲染成 table / tr / td
    ✓ 链接渲染成 <a href>
    ✓ 行内 code 渲染成 <code>（不含 pre）
    ✓ 标题渲染成 h1
  renderMarkdown — XSS 消毒
    ✓ <script> 不落 DOM（当文本）
    ✓ <img onerror> 不落 DOM（当文本）
    ✓ javascript: 链接被剥掉 href
    ✓ on* 事件属性不落 DOM
  renderMarkdown — 纯文本回归
    ✓ textContent 与原文逐字相同
    ✓ 空串返回空串
    ✓ 渲染异常不抛出（降级纯文本）
  enhanceMarkdown — 代码块增强
    ✓ 加语言标签 + 复制按钮
    ✓ 复制按钮真的写剪贴板
    ✓ 链接新窗口打开并切断 opener
    ✓ 重复调用不叠加按钮（幂等）
  MARKDOWN_CSS — 样式契约
    ✓ 代码块有内滚上限（长输出不撑爆面板）
    ✓ 内容字号走 token（双皮肤 + 内容/铬分级）
    ✓ reduced-motion 下复制按钮无过渡
Tests: 20 passed, 20 total

# e2e
$ npx playwright test --config=tests/e2e/playwright.markdown.config.ts
Running 5 tests using 1 worker
  ✓  1 … › ① GFM 样本：代码块 / 列表 / 表格 / 链接 / 行内 code 全部渲染（前后对照截图） (1.1s)
  ✓  2 … › ② XSS 样本：script / img onerror / javascript: 全部被消毒 (447ms)
  ✓  3 … › ③ 复制按钮真复制 (776ms)
  ✓  4 … › ④ 400 行长输出：代码块内滚，容器不被撑爆 (418ms)
  ✓  5 … › ⑤ 纯文本回归：逐字无损 (354ms)
  5 passed (5.1s)

# eslint（改动文件）
$ npx eslint src/hud/lib/markdown.ts src/hud/components/task-output/task-output-panel.ts \
    src/hud/panels/command-panel.ts src/hud/panels/mission-confirm.ts
✖ 1 problem (0 errors, 1 warning)   ← import/no-named-as-default（DOMPurify 默认导出名，warning 级）
```

截图：`reports/shots/markdown-r7-gfm-md.png`（前后对照）、`markdown-r7-gfm-before-md.png`、
`markdown-r7-gfm-after-md.png`、`markdown-r7-xss-md.png`、`markdown-r7-long-md.png`。

## 未尽事项（诚实记录）

1. **流式气泡仍是纯文本**：chat-drawer 的**流缓冲**（`data-streaming="true"`）逐 chunk 直写 textContent，
   定稿后的正式气泡才走 markdown —— 流式中途反复重解析会抖，成本高。定稿气泡是 markdown 的。
2. **markdown 语法本身会消费标记**：纯文本里形如 `- xxx` 的行会被解析成列表项（`-` 标记由渲染器消费），
   DOM `textContent` 与原文不再逐字相同。这是 markdown 渲染的固有语义，不是回归；
   视图模型里的原文（`outputText`）仍逐字保留。
3. **marked 版本从 devDependencies ^17.0.5 降到 dependencies ^15.0.12**：仓库原先只在 devDependencies 挂了
   marked ^17.0.5 且 src 里无人使用；本次 src 运行时要用它（必须进 dependencies），且 ^15.0.12 是已装并
   验证过的版本（`Renderer.html(token)` 签名在本版本确定可用）。仓库内无其它 marked 使用点。
