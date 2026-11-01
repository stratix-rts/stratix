# DSH-INTEGRATION-PLAN — DeepSeek Harness 三桥集成（A/B/C）

> 状态：**已冻结**（2026-11-02 07:35，用户拍板「ABC」三档并行）
> 前置事实：v3.1 已发（service 常驻 + Electron 壳 + MCP/REST/WS 三外面）；dsh 生态实测 dsh-plugin topic ~25,959 仓库、活跃；dsh 自我声明 dev preview、必有破坏性变更
> 原则出处：docs/SERVICE-SPLIT-PLAN.md 七铁律继续生效（尤其铁律 1：WorldState 真相源在 Stratix core）

## 0. 决策记录

- **不整体搬家**：深采纳 = dsh session log 成为事实源，撞铁律 1；且 dev-preview 兼容风险不可控。主权（mission/task/WorldState 状态机）留在 Stratix core。
- **三桥并行**（用户 ABC）：
  - **桥 A（worker 化）**：dsh 作为第四种 CLI worker 接入 cli-transport，与 claude/kimi 平级
  - **桥 B（插件化 spike）**：Stratix 包成 dsh plugin，生态反向可达
  - **借逻辑（C）**：dsh 四条工程模式写进 MCP-SPEC v2，无依赖

## 1. 桥 A：dsh worker adapter（task_088）

- 新 adapter `src/app/services/cli-transport/adapters/dsh.ts`：拼参 + 解析行，实现既有 CliAdapter 端口
- 启动方式：`npx -y @deepseek-ai/dsh --profile headless`（one-shot runner 语义与 claude --print / kimi -p 同构）；先读 dsh headless 的实际 CLI 契约（参数、stdin/stdout 帧格式、退出码）再定解析器——**契约以实测为准，不猜**
- 降级：本机未安装/npx 拉不动 → spawn_failed 错误事件（对齐现有 cli-transport 错误语义），绝不假成功
- 注册进 CLI_ADAPTER_FACTORIES / custom-agent roster（照 kimi 先例）
- 验收：fake process factory 单测全路径 + （环境允许时）真 spawn 冒烟一段输出贴 md

## 2. 桥 B：Stratix-as-dsh-plugin spike（task_089）

- 新目录 `plugins/dsh-bridge/`（独立 Cordis 插件包，不进 core/gateway 依赖树）
- spike 范围（只证深浅，不做产品化）：
  1. 经 world-sync WS 连 Stratix service（协议 docs/WORLD-SYNC.md）
  2. 注册 **world_snapshot 单工具** 进 `ctx.tools`（读投影，不写）
  3. 在真实 dsh 实例里跑通：agent 问世界态 → 工具返回真 units
- 产出必须含：集成面实测记录（Cordis 插件最小形状、ctx.tools 注册契约、加载方式）+ gap 清单（离全 8 工具/写命令还差什么）+ 是否值得产品化的一句判断
- 验收：dsh 实例内工具调用成功输出贴 md；gap 清单非空且具体

## 3. 借逻辑：MCP-SPEC v2 章节（task_087）

docs/MCP-SPEC.md 增补 v2 设计章（只设计，不实现），四条模式逐一对照现有 8 工具给落地草案：
1. **waterfall 工具管线**：pre-execute（准入/审计/origin 校验）→ execute → post-execute（回读核对强化位）三段守卫语义；映射表：每工具哪段挂什么
2. **capability seam 三件套**：Definition/Provider/Consumer 约定（对照我们 store/dispatch/工具 的既有注入端口，规范化命名与职责）
3. **事件日志 + 投影**：WorldState 变更作为 append-only 事件流的投影语义（与 world-sync seq 的关系、重放=重投影）
4. **可逆注册**：插件式挂载/卸载不残留的注册原则（对齐 Cordis effect 卸载语义；我们 runtime/manager 的 stop() 链规范化）
- 验收：四节齐全，每节含「现状对照 + 目标语义 + 迁移草案」三段；不改任何运行时代码

## 4. 明确不做（本批）

- 不把 Stratix 状态机迁进 dsh / 不用 dsh session log 替代 WorldState
- 不引入 Cordis 运行时依赖进 gateway/core（桥 B 是外挂目录，零反向依赖）
- 不做 dsh 插件市场分发
- 深采纳评估推迟到 dsh 脱 dev-preview + 桥 B 验证生态质量后

## 5. 任务与依赖

| ID | 任务 | 依赖 |
|---|---|---|
| task_087 | 借逻辑：MCP-SPEC v2 四模式设计章 | 无 |
| task_088 | 桥 A：dsh worker adapter | 无 |
| task_089 | 桥 B：Stratix-as-dsh-plugin spike | 无 |

三单全并行（worker ≤3 正好一波）。087/089 纯增量文档+外挂目录，088 动 cli-transport（新增文件为主，adapters/index 出口小改）。
