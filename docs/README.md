# Stratix 文档索引

> ⚠️ **本文档目录已瘦身归档。过时文档在 `archive/` 中，核心规范保留在根目录。**
> 
> 原则：**代码即文档**。模块的具体实现细节以代码注释和类型定义为准，本文档仅保留「跨模块共识」和「设计规范」。

---

## 📋 有效文档（根目录）

| 文档 | 类型 | 状态 | 说明 |
|------|------|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构 | ⚠️ 需核对 | 系统整体架构，模块间关系 |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | 规范 | ✅ 有效 | UI 设计系统、Token、语义化命名 |
| [AESTHETIC_CONSTRAINTS.md](./AESTHETIC_CONSTRAINTS.md) | 规范 | ✅ 有效 | 美学约束、视觉风格指南 |
| [PERFORMANCE_GUIDELINES.md](./PERFORMANCE_GUIDELINES.md) | 规范 | ✅ 有效 | 性能预算和优化指南 |
| [COMPONENT_GUIDE.md](./COMPONENT_GUIDE.md) | 规范 | ⚠️ 需核对 | 组件开发规范 |
| [THEME_SWITCHING.md](./THEME_SWITCHING.md) | 功能 | ✅ 有效 | 主题切换机制说明 |
| [STRATIX_AGENT_DESIGN.md](./STRATIX_AGENT_DESIGN.md) | 设计 | ⚠️ 需核对 | Agent 核心设计（部分过时） |
| [CHARACTER_CREATOR_V3_TECH_DOC.md](./CHARACTER_CREATOR_V3_TECH_DOC.md) | 技术 | ✅ 有效 | 英雄设计器 V3 技术文档 |
| ~~ZONE_DESIGN.md~~ | 设计 | ❌ 已退役 | Zone 系统设计 —— **文件已删除**（Zone 整体砍掉，见 REFACTOR_PLAN_V3 §4 D5） |
| ~~RTS_ZONE_API.md~~ | API | ❌ 已退役 | RTS Zone 对外 API 定义 —— **文件已删除**（同上） |
| ~~RTS_ZONE_ARCHITECTURE.md~~ | 架构 | ❌ 已退役 | RTS Zone 子系统架构 —— **文件已删除**（同上） |
| [测试标准.md](./测试标准.md) | 规范 | ⚠️ 需核对 | 测试覆盖率和标准 |

### v3.3 当前有效文档（QA-04 / task_224 补录）

上表是**历史索引**（部分条目已随 Zone 退役而失效）。下面这张是 **v3.3 现在的真相源** ——
新文档一律先看这里。

| 文档 | 类型 | 说明 |
|------|------|------|
| [DESIGN-project-map.md](./DESIGN-project-map.md) | 设计（冻结） | **项目 = 副本** 的总设计：M1/M2 多副本落库维度、容量上限、迁移与回滚矩阵 |
| [DESIGN-canvas-interactions.md](./DESIGN-canvas-interactions.md) | 设计 | **画布交互**总设计：事件矩阵、键击归属优先级链、冲突对裁决 |
| [DESIGN-asset-pipelines.md](./DESIGN-asset-pipelines.md) | 设计 | **资产管线**总纲：特效（pixelfx）/ 角色（CharacterComposer）两条管线各自闭环 |
| [DESIGN-dsh-bridge.md](./DESIGN-dsh-bridge.md) | 设计 | dsh 桥接中间件设计（M3-00 起步） |
| [REFACTOR_PLAN_V3.md](./REFACTOR_PLAN_V3.md) | 计划 | **v3 重构的冻结决策**（D5/D6 等；与 CLAUDE.md 冲突时以它为准） |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构 | 系统整体架构与模块间关系 |
| [WORLD-SYNC.md](./WORLD-SYNC.md) | 协议 | 视图侧 WS 协议（world-sync v3：快照 + 下行事件通道） |
| [MCP_SERVER_DESIGN.md](./MCP_SERVER_DESIGN.md) | 协议 | MCP 工具面（给 agent 派单与探查） |
| [DEMO-PLAN.md](./DEMO-PLAN.md) | 计划 | v3.3 演示链（视觉与交互简化） |
| [ARCH-LAWS-STATIC-SCAN.md](./ARCH-LAWS-STATIC-SCAN.md) | 规范 | **架构铁律静态扫描**（5 条铁律 + 豁免账本 + CI 接线） |
| [CODE-REVIEW-TRIAGE-QA03.md](./CODE-REVIEW-TRIAGE-QA03.md) | 记账 | QA-03 lint 分诊与死代码整治的账 |
| [../e2e-tests/README.md](../e2e-tests/README.md) | 用法 | 走查探针 / 验收剧本的清单与端口纪律 |
| [../reports/README.md](../reports/README.md) | 规范 | 截图留痕的**命名规范** |

### 如何判断一份文档是否过时？

运行检测脚本：

```bash
node scripts/check-doc-freshness.js
```

如果文档引用的模块代码在文档之后有大幅修改，该文档标记为 `STALE`（可能过时）。

---

## 🔍 代码审查报告

`docs/review/` 目录下是 **2026-04-26** 生成的模块级代码审查报告，目前**最新且有效**：

```
review/
├── agent-platform-review.md
├── components-review.md
├── composables-review.md
├── config-and-root-review.md
├── electron-review.md
├── scripts-review.md
├── stores-review.md
├── stratix-agent-review.md
├── stratix-ai-service-review.md
├── stratix-blueprint-review.md
├── stratix-character-creator-review.md
├── stratix-command-panel-review.md
├── stratix-core-review.md
├── stratix-data-review.md
├── stratix-data-store-review.md
├── stratix-database-review.md
├── stratix-designer-review.md
├── stratix-gateway-review.md
├── stratix-lra-bridge-review.md
├── stratix-nocodb-review.md
├── stratix-openclaw-adapter-review.md
├── stratix-orchestration-review.md
├── stratix-project-review.md
├── stratix-rts-review.md
├── stratix-systemzone-review.md
├── stratix-tailscale-review.md
├── stratix-task-executor-review.md
└── tests-review.md
```

这些报告记录了各模块的 **P0/P1/P2 级别问题**，是质量改进的路线图。

---

## 📦 归档文档

已归档的历史文档按时间分类：

```
archive/
├── 2026-02-completed-reports/     # 2 月完成报告、迁移总结
├── 2026-03-process-reports/       # 3 月 RTS/Texture 优化过程文档
└── 2026-04-process-status/        # 4 月 SZ/Character 过程状态文档
├── 2026-outdated-designs/         # 已确认过时的设计/集成文档
```

> 归档文档**不再维护**，仅作历史参考。如需查阅，进入对应目录即可。

---

## 🛠️ 代码即文档规范

### 1. 新功能必须内嵌文档

不要在 `docs/` 里写独立的设计文档。**把文档写在代码旁边**：

```typescript
/**
 * Zone 状态管理器
 * 
 * 职责：
 * - 维护 Zone 的生命周期（create → active → pause → destroy）
 * - 同步 Zone 状态到 WebSocket
 * 
 * @see docs/ZONE_DESIGN.md  // 仅链接跨模块共识文档
 */
export class ZoneStateManager {
  // ...
}
```

### 2. 模块入口文件必须包含 README 注释

每个模块的 `index.ts` 顶部应有模块级 JSDoc：

```typescript
/**
 * @module stratix-rts
 * @description RTS 游戏引擎核心 —— 基于 Phaser 3 的 Zone 渲染与交互系统
 * 
 * 核心子系统：
 * - ZoneManager: Zone 生命周期
 * - SpriteRegistry: 精灵池管理
 * - InputHandler: 框选/编队输入处理
 * 
 * @see docs/RTS_ZONE_ARCHITECTURE.md
 */
```

### 3. 公共 API 必须带 JSDoc

所有 `export` 的函数/类/接口必须有 JSDoc 注释，说明：
- 用途
- 参数（含类型）
- 返回值
- 可能的异常
- 相关代码链接

### 4. 复杂算法必须附 inline 注释

不要写单独的「算法文档」，直接在代码里解释：

```typescript
// 使用空间哈希加速碰撞检测
// 将屏幕划分为 64x64 的网格，每个 sprite 只检测同网格邻居
// 时间复杂度从 O(n²) 降到 O(n)（假设均匀分布）
const gridSize = 64;
```

### 5. 配置和魔法数字必须说明来源

```typescript
// 50ms 是 WebSocket 往返延迟的 P99 上限
// 见 docs/PERFORMANCE_GUIDELINES.md 第 3.2 节
const COMMAND_LATENCY_BUDGET = 50;
```

---

## 🔄 文档维护流程

1. **新增功能**：不写独立文档，直接写代码注释 + JSDoc
2. **修改功能**：同步更新代码注释，如果影响跨模块契约，更新根目录对应规范文档
3. **废弃功能**：代码注释标记 `@deprecated`，不删除旧文档（留给 git history）
4. **定期清理**：每季度运行 `node scripts/check-doc-freshness.js`，把 `STALE` 文档移入 `archive/`

---

## 🚀 快速导航

| 你想了解 | 去哪里 |
|---------|--------|
| 某个函数怎么用 | 看代码 JSDoc + 类型定义 |
| 某个模块的职责 | 看该模块 `index.ts` 顶部注释 |
| 系统设计思路 | `ARCHITECTURE.md` / `ZONE_DESIGN.md` |
| UI 规范 | `DESIGN_SYSTEM.md` / `AESTHETIC_CONSTRAINTS.md` |
| 性能要求 | `PERFORMANCE_GUIDELINES.md` |
| API 契约 | `RTS_ZONE_API.md` |
| 代码质量问题 | `docs/review/*-review.md` |
| 历史决策 | `docs/archive/` |
