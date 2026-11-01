<div align="center">

# ⬡ Stratix 星策

### 一人成军，万智听命

**基于 RTS 游戏化界面的多 Agent 可视化指挥平台**

[![GitHub Stars](https://img.shields.io/github/stars/stratix-rts/stratix?style=social)](https://github.com/stratix-rts/stratix)
[![Discord](https://img.shields.io/badge/Discord-加入社区-5865F2?logo=discord)](https://discord.gg/3NysCNbe)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[在线演示](https://stratix-rts.github.io/homepage/) · [文档](#) · [反馈建议](https://github.com/stratix-rts/stratix/issues)

</div>

---

## 🎯 这是什么？

Stratix 星策是一个**游戏化**的多 Agent 管理平台。

如果你用过 OpenClaw 或类似的 Agent 框架，你一定经历过这样的场景：

> 开了 10 个 Agent，却不知道谁在干活、谁在摸鱼。切换窗口找消息，比写代码还累。

> AI 一分钟出结果，你却花十分钟在配置、调度、整理。本该释放生产力，反而成了打杂工。

> 每次新建 Agent 都要手动配置 Skills、记忆、模型参数。复制粘贴？那是在浪费生命。

**我们用 RTS（即时战略）游戏的方式，重新定义了 Agent 管理。**

想象一下：你是指挥官，Agent 是你的军团。框选、编队、下发指令——就像玩即时战略游戏一样简单直观。

---

## ✨ 核心特性

### 🎮 RTS 游戏化界面

不再面对枯燥的命令行和分散的窗口。

```
传统方式：                         Stratix 方式：
┌─────────────────┐               ┌─────────────────────────────┐
│ Terminal 1      │               │    ⬡ 星策指挥中心           │
│ Terminal 2      │    ────►      │  ┌───┐ ┌───┐ ┌───┐        │
│ Terminal 3      │               │  │⚡ │ │✦ │ │◈ │        │
│ VSCode          │               │  └───┘ └───┘ └───┘        │
│ Browser Tab 1   │               │  [框选] [编队] [下达指令]   │
│ Browser Tab 2   │               └─────────────────────────────┘
└─────────────────┘               
```

- **可视化地图**：所有 Agent 一览无余，状态实时同步
- **框选编队**：单击、框选、Ctrl+数字编队，批量操作
- **实时状态**：谁在执行、谁在待命、执行进度，一目了然

### 🦸 英雄设计器

告别手写 JSON 配置文件。

通过可视化界面配置 Agent 的：
- **Soul**：角色定位、系统提示词
- **记忆系统**：短期/长期记忆配置
- **技能树**：可调用的工具和 API
- **模型参数**：Temperature、Max Tokens 等

一键导出配置，或从模板库快速导入专业 Agent（开发战士、文案刺客、数据法师...）。

### 🌐 星策网关

统一的中间件层，连接一切。

```
┌─────────────────────────────────────────────────┐
│                  前端层                          │
│   ┌─────────────┐    ┌─────────────┐           │
│   │  RTS 界面   │    │ 英雄设计器  │           │
│   │  (Phaser 3) │    │  (Vue 3)    │           │
│   └─────────────┘    └─────────────┘           │
└─────────────────────────────────────────────────┘
                      ↓ WebSocket
┌─────────────────────────────────────────────────┐
│              星策网关 (中间件层)                 │
│   · 指令转换与路由                               │
│   · 状态同步与广播                               │
│   · 多实例管理                                   │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│                  Agent 层                        │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│   │OpenClaw │  │OpenClaw │  │OpenClaw │        │
│   │ (本地)  │  │ (远程)  │  │ (云端)  │        │
│   └─────────┘  └─────────┘  └─────────┘        │
└─────────────────────────────────────────────────┘
```

**特性：**
- 支持本地 / 远程 OpenClaw 实例混合部署
- WebSocket 实时双向通信
- 指令队列管理，支持优先级

### ⚡ 50ms 指令响应

基于 WebSocket 的实时通信，从点击到 Agent 执行，延迟控制在 50ms 以内。

---

## 🏗️ 架构拓扑（前后端分离 · OpenClaw 式）

> **真相源**：[docs/SERVICE-SPLIT-PLAN.md](docs/SERVICE-SPLIT-PLAN.md)（目标拓扑 + 迁移期双模式）
> ｜[docs/WORLD-SYNC.md](docs/WORLD-SYNC.md)（视图侧 WS 协议）
> ｜[docs/MCP-SPEC.md](docs/MCP-SPEC.md)（工具面规范）

一句话：**service 常驻持有大脑，Electron 退化为可关可换的视图壳。**
关掉 Electron，agent 照常干活；关掉 service，什么都停。

### 新拓扑（现行）

```
                    ┌────────────────────────────────────────┐
                    │  Service（gateway 进程，常驻 daemon）    │
                    │  core runtime ── mission/task 状态机    │
                    │  task-service（执行环，直接 spawn CLI）   │
                    │       │                                 │
                    │       ▼                                 │
                    │  cli-transport ──► claude / kimi 子进程 │
                    │  SQLite（独占写）                        │
                    │  ┌──────────┬──────────┬──────────┐     │
                    │  │ MCP      │ REST API │ WS       │     │
                    └──┴────▲─────┴────▲─────┴────▲─────┴─────┘
                           │stdio      │HTTP      │WS (world-sync)
        ┌──────────────────┘           │          └───────────────┐
        ▼                              ▼                          ▼
  外部 MCP client               浏览器/API client          Electron 壳（可选）
  （Claude Code 等）                                        hud/world 纯视图
```

- **三外面**：MCP（stdio + HTTP）给 agent 派单与探查；REST API 给脚本 / 外部 client 读写；WS（world-sync）给视图壳订阅状态、发命令。
- **Electron 是可选的**：它只订阅全量快照 + 发 `HudCommand`，不含真相、不 spawn CLI、不写库。
- **真相唯一**：WorldState 的唯一真相源是 service 进程的 core store（`src/stratix-gateway/service/`）。

### 旧拓扑（改造前 · 已退役）

```
┌──────────────────────── Electron 进程 ────────────────────────┐
│  ┌──────────────────────────────┐                             │
│  │  渲染进程 = 组合根            │                             │
│  │  core runtime（世界态住在渲染里）│                             │
│  │  task-service                 │                             │
│  └───────────┬──────────────────┘                             │
│              │ IPC（chat:run / chat:abort）                   │
│  ┌───────────▼──────────────────┐                             │
│  │  Electron main               │                             │
│  │  CLI spawn（唯一 spawn 点）    │                             │
│  │  SQLite 写（多进程开同一文件） │                             │
│  └──────────────────────────────┘                             │
└───────────────────────────────────────────────────────────────┘
        ▲ 关掉窗口 = 大脑停机（agent 一起死）
        │
   gateway /mcp（挂在空 store 上 → units 恒为 0，看不见战场）
```

旧路径的四处要害：大脑住在渲染进程、spawn 点在 Electron main、SQLite 多进程共写、MCP 与战场不同进程。

### 前后对比

| 维度 | 旧拓扑 | 新拓扑 |
|------|--------|--------|
| 大脑（core runtime） | 渲染进程 | **service 常驻进程** |
| 关掉 Electron | agent 一起停机 | **只丢视图，agent 照跑** |
| CLI spawn 点 | Electron main（经 IPC 中转） | **service 直接 spawn** |
| 存储 | 多进程开同一个 SQLite | **service 独占写，其余经 API 读** |
| MCP 能否见战场 | 看不见（units 恒为 0） | **同进程真态** |
| 视图数据源 | 进程内直连 core store | **WS world-sync 全量快照** |
| 客户端数量 | 一个 Electron | **多客户端（MCP / REST / WS / 多个壳）** |

迁移期开关（远程模式 `STRATIX_REMOTE=1` / 本地回退不设）与「何时禁」见
[docs/SERVICE-SPLIT-PLAN.md §8](docs/SERVICE-SPLIT-PLAN.md#8-收尾节迁移期双模式)。

---

## 🚀 快速开始

### 方式一：Docker（推荐）

```bash
# 拉取镜像
docker pull stratix/stratix:latest

# 一键启动
docker run -d -p 3000:3000 -p 8080:8080 stratix/stratix:latest
```

访问 `http://localhost:3000` 即可开始使用。

### 方式二：源码构建

```bash
# 克隆仓库
git clone https://github.com/stratix-rts/stratix.git
cd stratix

# 安装依赖
pnpm install

# 启动开发模式
pnpm dev
```

### 方式三：连接现有 OpenClaw

如果你已经有运行中的 OpenClaw 实例：

```bash
# 编辑配置文件
vim stratix.config.json
```

```json
{
  "gateway": {
    "port": 8080
  },
  "openclaw": {
    "instances": [
      {
        "name": "local",
        "type": "local",
        "path": "/path/to/openclaw"
      },
      {
        "name": "remote",
        "type": "remote",
        "url": "https://your-openclaw-instance.com"
      }
    ]
  }
}
```

```bash
# 启动网关
pnpm gateway:start

# 启动前端
pnpm frontend:start
```

---

## 🎬 使用场景

### 场景一：个人开发者「一人成军」

你是独立开发者，需要：
- 🤖 开发 Agent：帮你写代码、Review PR
- ✍️ 文案 Agent：写文档、回复邮件
- 📊 数据 Agent：分析日志、生成报告

**传统方式**：开 3 个终端，来回切换，手动分配任务。

**Stratix 方式**：打开指挥中心，框选 3 个 Agent，一键下发「开发新功能」指令。坐等结果。

### 场景二：小团队协作

团队 5 人，需要管理 20+ 个 Agent：

**传统方式**：每个人各自管理自己的 Agent，信息孤岛，难以协调。

**Stratix 方式**：统一的指挥中心，团队共享视野。谁在忙、谁空闲、任务队列如何，全员可见。

### 场景三：企业级 Agent 集群

需要管理 100+ 个 Agent，分布在不同服务器：

**传统方式**：写脚本批量管理，排查问题靠日志搜索。

**Stratix 方式**：星策网关统一接入，实时状态监控，异常自动告警。

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端 - RTS 界面** | Phaser 3, TypeScript |
| **前端 - 英雄设计器** | Vue 3, Vite, TailwindCSS |
| **中间件 - 网关** | Node.js, WebSocket, Express |
| **Agent 框架** | OpenClaw (兼容) |
| **数据库** | SQLite (本地) / PostgreSQL (集群) |

---

## 📊 性能指标

| 指标 | 数值 |
|------|------|
| 指令响应延迟 | < 50ms |
| 单网关支持 Agent 数 | 100+ |
| WebSocket 并发连接 | 1000+ |
| 前端首屏加载 | < 1.5s |

---

## 🗺️ 路线图

### MVP（当前）
- [x] 基础 RTS 界面
- [x] OpenClaw 对接
- [x] 英雄设计器（基础版）
- [x] 星策网关

### v1.0
- [ ] Agent 模板市场
- [ ] 任务编排（DAG 工作流）
- [ ] 多人协作（实时同步）
- [ ] 移动端适配

### v2.0
- [ ] AI 自动编排（AI 指挥 AI）
- [ ] 插件系统
- [ ] 企业版（SSO、RBAC）

---

## 🤝 参与贡献

我们欢迎所有形式的贡献！

**适合新手的 Issue：**
- [ ] 完善文档、修正错别字
- [ ] 添加单元测试
- [ ] 优化 UI 细节

**进阶贡献：**
- [ ] 新增 Agent 模板
- [ ] 实现新的 RTS 操作（如巡逻、守护）
- [ ] 性能优化

**如何开始：**
1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

---

## 💬 社区

- **Discord**: [https://discord.gg/3NysCNbe](https://discord.gg/3NysCNbe) - 即时讨论、问题解答
- **GitHub Issues**: 功能建议、Bug 报告
- **Twitter**: [@stratix_ai](https://twitter.com/stratix_ai) - 最新动态

---

## 📄 许可证

[MIT License](LICENSE) - 自由使用、修改、分发。

---

## 🙏 致谢

- [OpenClaw](https://github.com/openclaw) - 强大的 Agent 框架
- [Phaser](https://phaser.io/) - 优秀的游戏引擎
- 所有贡献者和早期用户

---

<div align="center">

**如果你觉得这个项目有用，请给一个 ⭐ Star！**

Made with ⚡ for AI Commanders

</div>
