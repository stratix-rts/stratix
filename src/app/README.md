# src/app —— 应用组合根（v3 新 UI 的两个渲染入口）

**职责**：唯一允许同时认识 `hud/` 与 `world/` 的地方（组装、生命周期、dev 入口）。
- `main/index.html` + `main/main-entry.ts`：**正式渲染入口**（Phase 3 起是 Electron 主窗口默认加载页），
  同屏装配 core runtime + world 战场 + hud 主屏；
- `entry-paths.ts`：新旧入口路径与回退开关（`STRATIX_LEGACY=1` 走旧 Vue 入口）的唯一定义处，
  被 electron 主进程与 vite 配置共同消费；
- `dev/hello-loop.html` + `dev/hello-loop-entry.ts`：Phase 1 的 HelloLoop 联调页
  （HUD 主屏 + Phaser 战场同屏，验证 command → core → state → 场景这条闭环）。

`legacy/` 入口在 Phase 3 之后保留一个版本周期的回退能力（§6），退役清理是下一阶段的事。

**禁止事项**：
1. 在本目录写业务逻辑 —— 判断归 `core/`，渲染归 `hud/` / `world/`；
2. 让 `hud/` ↔ `world/` 直接调用 —— 组合根可以同时 import 两侧，但两侧之间只经 `core/bus` 通信；
3. 被 legacy 代码 import —— 依赖方向永远是 legacy → app；
4. 放 dev-only 的假数据来源 —— 页面上的每个状态都必须来自 `core/store` 的广播。