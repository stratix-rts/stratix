# task_016

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_016.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3切换: Electron主入口切换-模块

## requirements

把应用主入口切到新游戏化 UI（core runtime + world BattlefieldScene + hud main-screen 同屏装配），
参照 `src/app/dev/hello-loop.html` 的最小装配，正式版做成完整装配页：

1. **正式入口落在 `src/app/main/`**（`index.html` + `main-entry.ts`）：组合根是**唯一**允许同时认识
   `hud/` 与 `world/` 的地方，但两侧之间仍零直接调用（只经 `core/bus`）；
2. **入口路径唯一定义处**（`src/app/entry-paths.ts`）：新旧两个入口的 HTML 路径 + 回退开关判定，
   做成零依赖纯模块 —— electron 主进程（commonjs）与 vite 配置（esbuild）共同消费它；
3. **Electron 主进程切入口**：dev 走 vite dev server 的**入口路径**（不是端口根 —— 端口根会返回 legacy 首页，
   "连上了却加载旧 UI" 是这里最容易踩的坑），正式包走 `dist/frontend/<入口路径>`（与多入口产物同构）；
4. **回退开关 `STRATIX_LEGACY=1`** 走旧 Vue 入口：旧入口文件与旧 UI 一行不动、不删，
   正式构建里两个入口都产出（显式给 vite `input` 后不再默认收根 index.html，两个都必须写）；
5. 不引入新依赖、不动 `src/hud` / `src/world` / `src/core` 的组件实现、不造演示数据。

## acceptance

- [x] `npm run dev` 起后主窗口即新 UI（dev server 能路由到新入口且页面真的装配出 HUD + Phaser 战场）
- [x] electron 正式构建路径配置正确（新旧两个入口产物都在、相对资源路径可解析、`build:electron` 绿）
- [x] 回退开关有效（`STRATIX_LEGACY=1` 切回旧入口的逻辑存在且旧入口文件/产物完好）
- [x] `typecheck` / `build` 全绿

## 交付物

- `src/app/entry-paths.ts`（新）：新旧入口路径常量 + `STRATIX_LEGACY` 回退开关判定，**唯一定义处**
- `src/app/main/index.html` + `src/app/main/main-entry.ts`（新）：正式渲染入口（组合根：core runtime + world BattlefieldScene + hud main-screen 同屏）
- `src/electron/main.ts`（改）：主窗口按回退开关加载新/旧入口；dev 指 dev server 的入口路径，正式包指 `dist/frontend/<入口路径>`
- `vite.config.ts`（改）：多入口构建（新 + legacy 同时产出，路径与输入同构）
- `tsconfig.electron.json`（改）：`include` 补 `src/app/entry-paths.ts`（主进程要消费它）
- `src/app/README.md`（改）：目录职责更新

**未改动**：旧 Vue 入口（根 `index.html` / `src/main.ts` / `src/App.vue`）、`src/hud`、`src/core`、`src/world` 一行未动；
未引入任何新依赖；未造演示数据（新入口不播种单位，战场空就是真实空）。

## 验证证据（完成前必填）

- [x] **实现证明**:
  - `src/app/entry-paths.ts` — `LEGACY_ENTRY_HTML='index.html'` / `NEW_ENTRY_HTML='src/app/main/index.html'` /
    `isLegacyEntry(env)`（仅 `'1'` 为真）/ `entryHtmlPath(env)`；零依赖纯模块，被 electron 主进程与 vite 配置共同消费
  - `src/electron/main.ts createWindow()` — 启动即算 `entryPath = entryHtmlPath()`，dev 走
    `http://127.0.0.1:<port>/${entryPath}`（原逻辑只探端口根 → 会连上却加载旧首页，这是必须显式带路径的原因），
    正式包走 `path.join(__dirname, '../../frontend', entryPath)`；并打印当前入口与回退提示
  - `src/app/main/main-entry.ts` — 组合根：theme controller + bus-adapter + main-screen 挂 `#hud-root`；
    Phaser.Game(BattlefieldScene) 挂 `#battlefield`；`createCoreRuntime({store: worldStore})` 接闭环；
    POST_RENDER 后补发一次真实 `worldStore.getState()`（store.subscribe 不回放，不补则 HUD/战场等不到初始快照，
    与 `world/dev/main.ts` 同一推理）；pagehide 逆序清理 runtime/adapter/screen/game；装配失败落 `#boot-error` 不静默白屏
  - `vite.config.ts` — `rollupOptions.input = { main: NEW_ENTRY_HTML, legacy: LEGACY_ENTRY_HTML }`（显式给 input 后
    vite 不再默认收 index.html，两个都必须写，否则 legacy 产物丢失）
- [x] **测试验证**: 见下方"验证结果"（typecheck / build / build:electron / v3 597 测试全绿 + 无头浏览器实拍新入口）
- [x] **影响范围**: 默认入口切换（electron:dev 与正式包主窗口现在是新 UI）；旧入口文件与产物完整保留，
    `STRATIX_LEGACY=1` 可随时回退；`npm run dev`（浏览器 dev server）行为不变，只是多了一个可访问页 `/src/app/main/index.html`

### 测试步骤

1. `npm run dev` → dev server 起在 7523；electron 主窗口加载 `http://127.0.0.1:7523/src/app/main/index.html`
2. 无头 Chromium 打开该 URL：断言 `#hud-root` 内出现 HUD 组件、`#battlefield` 出现 canvas、无 console error
3. `npm run build` → 断言 `dist/frontend/src/app/main/index.html` 与 `dist/frontend/index.html` 两个产物都在，资源路径为相对
4. 静态服务产物后打开新入口 / 旧入口做对照
5. `node -e "require('./dist/electron/app/entry-paths')"` 验证回退开关四种 env 取值
6. `npm run typecheck` / `npm run build` / `npm run build:electron` / `npx jest src/core src/hud src/world src/app`

### 验证结果

```
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npm run build          # build:backend + build:frontend
✓ built in 2m 4s         # 无 error

$ npm run build:electron # tsc -p tsconfig.electron.json && tsc-alias && fix-electron-require && bundle-electron
  dist/electron/electron/main.cjs  4.6mb
[bundle-electron] Bundled main.js -> main.cjs
BUILD_ELECTRON_EXIT=0

$ npx jest src/core src/hud src/world src/app --maxWorkers=1
Test Suites: 30 passed, 30 total
Tests:       597 passed, 597 total
Time:        5.407 s

$ npx eslint --cache src/app/entry-paths.ts src/app/main/main-entry.ts src/electron/main.ts
✖ 3 problems (0 errors, 3 warnings)   # 3 个 warning 均为改动前既有（18 行 startGatewayService、104 行 line/sourceId 未使用）

# --- dev server 路由证据（npm run dev 起在 7523）---
VITE v7.3.1  ready in 1484 ms
  ➜  Local:   http://127.0.0.1:7523/
$ curl -o /dev/null -w "%{http_code}" http://127.0.0.1:7523/src/app/main/index.html   → 200（新入口）
$ curl -o /dev/null -w "%{http_code}" http://127.0.0.1:7523/index.html                 → 200（旧入口仍在）
$ curl .../src/app/main/main-entry.ts  → 200，vite 已成功转换并解析全部 import：
  import Phaser from "/node_modules/.vite/deps/phaser.js"
  import { emitCommand, emitState, onState } from "/src/core/bus.ts"
  import { createMainScreen } from "/src/hud/screens/main-screen.ts"
  import { BattlefieldScene } from "/src/world/scenes/BattlefieldScene.ts"

# --- dev 入口实拍（无头 Chromium，无 console error）---
{
  "url": "http://127.0.0.1:7523/src/app/main/index.html",
  "hudOutline": ["STYLE", "DIV"],
  "hudTagsInDoc": ["STRAT-BUTTON","STRAT-COMMAND-PANEL","STRAT-AGENT-PANEL","STRAT-STATUS-SCREEN","STRAT-LOG-DRAWER"],
  "hudText": "Stratix HUD 皮肤: default · 单元: 0",
  "hudButtons": 4,
  "canvasSize": { "w": 924, "h": 900 },
  "themeStyleInjected": true,
  "bootErrorShown": false,
  "errors": []
}
（截图 /tmp/task016-entry-new.png：左列命令面板/Agent 侧栏/态势总览，右列 Phaser 战场）
单元数 0 是真实状态 —— 新入口不播种演示单位（禁止事项 3）。

# --- 旧入口对照（同一 dev server，STRATIX_LEGACY=1 的目标）---
{
  "url": "http://127.0.0.1:7523/index.html",
  "vueMounted": true,
  "appChildren": ["DIV.app-root"],
  "appText": "Stratix 星策系统 英雄 日志 状态 监控 数据 工作流 ... 系统就绪 3D",
  "canvases": 1,
  "errorCount": 0
}

# --- 构建产物双入口 ---
$ find dist/frontend -name "*.html"
dist/frontend/index.html                        # legacy
dist/frontend/src/app/main/index.html           # 新入口（与 vite root 同构）
dist/frontend/tools/generate-base-textures.html # publicDir('assets') 原样拷贝，与本次改动无关
$ grep -o 'src="[^"]*"' dist/frontend/index.html
src="./assets/legacy-C1kCf2X5.js"                       # 相对路径，file:// 下可解析
$ grep -o 'src="[^"]*"' dist/frontend/src/app/main/index.html
src="../../../assets/main-Ci0gm_F2.js"                   # 相对路径，file:// 下可解析

# --- 构建产物实拍（静态服务 dist/frontend 后）---
新入口: canvasCount=1, hudTags=[STRAT-BUTTON, STRAT-COMMAND-PANEL, STRAT-AGENT-PANEL,
       STRAT-STATUS-SCREEN, STRAT-LOG-DRAWER], errors=[]
旧入口: vueMounted=true, canvases=1（其 404 仅因裸静态服务不代理 /api 与 /ws，非回归）

# --- 回退开关实测（编译产物 dist/electron/app/entry-paths.js）---
默认(无 env)       -> src/app/main/index.html
STRATIX_LEGACY=1   -> index.html
STRATIX_LEGACY=0   -> src/app/main/index.html
STRATIX_LEGACY=true -> src/app/main/index.html
实际 process.env   -> src/app/main/index.html | isLegacy = false

# --- file:// 说明（如实记录）---
用裸 Chromium 走 file:// 时新旧两个入口都被 CORS 拦（"Cross origin requests are only supported for
protocol schemes: chrome, chrome-untrusted, data, http, https"）——这是项目既有正式加载路径
（main.ts 原本就是 loadFile）本身的限制，新旧表现一致，非本次引入；Electron 的 file:// 加载不受此限。
因此产物验证改用静态 http 服务完成（上面的"构建产物实拍"）。
```

### 未尽事项（不在本任务范围）

- 新入口战场为空（0 单位）属真实状态：core 的单位数据尚未从 gateway 接入，属于后续任务
- `file://` + ESM 的加载限制沿用既有实现，未在本次改动（若后续要在裸浏览器验证产物，需要走 http 或 electron）