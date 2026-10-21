# src/app —— 应用组合根（v3 新 UI 的两个渲染入口）

**职责**：唯一允许同时认识 `hud/` 与 `world/` 的地方（组装、生命周期、dev 入口）。
当前只有 `dev/hello-loop.html` + `dev/hello-loop-entry.ts`：Phase 1 的 HelloLoop 联调页
（HUD 主屏 + Phaser 战场同屏，验证 command → core → state → 场景这条闭环）。
Phase 3 会在这里落 Electron 的 new 渲染入口，`legacy/` 入口随之退役。

**禁止事项**：
1. 在本目录写业务逻辑 —— 判断归 `core/`，渲染归 `hud/` / `world/`；
2. 让 `hud/` ↔ `world/` 直接调用 —— 组合根可以同时 import 两侧，但两侧之间只经 `core/bus` 通信；
3. 被 legacy 代码 import —— 依赖方向永远是 legacy → app；
4. 放 dev-only 的假数据来源 —— 页面上的每个状态都必须来自 `core/store` 的广播。