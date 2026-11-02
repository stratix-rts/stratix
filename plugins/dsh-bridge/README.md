# @stratix/dsh-bridge — Stratix-as-dsh-plugin（spike）

把 Stratix 的**世界态读面**挂进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）
的工具注册表：dsh 的 agent 能通过一个模型可见工具读到 Stratix 战场上的真 units / missions / characters。

> 状态：**spike**（task_089）。只证集成面深浅，不做产品化。范围 = 1 个只读工具。

## 目录

- [它做什么](#它做什么)
- [插件形状](#插件形状实测)
- [构建](#构建)
- [装载（三种方式）](#装载)
- [自测](#自测)
- [边界](#边界)

---

## 它做什么

1. 经 **world-sync WebSocket**（[docs/WORLD-SYNC.md](../../docs/WORLD-SYNC.md)）连上跑着的 Stratix service：
   `hello` → 收一份全量 `snapshot` → 之后每次状态变更再收一份广播。全量覆盖，不做增量合并。
2. 把 `stratix_world_snapshot` **注册进 `ctx.tools`**（dsh 的模型可见工具注册表）。
3. 工具返回 service 推来的**真数据**：单位名、状态、所属任务、角色名册、状态版本号 seq。

**只读**：不发 `command.forward`，不改任何世界状态。写命令面不在本期。

## 插件形状（实测）

照 dsh 官方两篇文档的最小形状（`docs/cordis-tutorial/01-first-plugin.md`、`docs/cookbook/adding-a-tool.md`）：

```ts
export const name = 'stratix-dsh-bridge'   // 诊断标签
export const inject = ['tools']             // 依赖的服务；cordis 等它就位再装载本插件
export const Config = z.object({ ... })     // 部署侧配置（profile patch 的 config: 段）
export function apply(ctx: Context, config: BridgeConfig): void {
  ctx.tools.register(defineTool({ name: 'stratix_world_snapshot', ... }))
}
```

要点（都是实测踩出来的）：

- `ctx.tools` **不是** `ctx.get('tools')`：它是 Cordis 服务属性投影，由 `inject: ['tools']` 声明依赖后自动出现。
- 工具必须声明 `output: { schema, render }` —— 缺 `render` 会在注册时被 `TypeError` 拒掉。
- **模型看到的是 `output.render()` 的产物，不是规范值本身**。只 render 一句汇总结论的话，模型会以为
  这些数据是编的（spike 实测：模型回复「这可能是 harness 自己维护的 mock」）。要铺真数据就得
  `JSON.stringify(value)` 出去。
- 注册是 effect 式的：插件 fiber 卸载时工具自动注销。本插件自己持有的 WS 连接用 `ctx.effect()`
  挂 disposer，卸载时关 socket 与重连定时器。

## 构建

```sh
cd plugins/dsh-bridge
npm install          # 只装插件自己的依赖（不碰主仓 package.json）
npm run build        # tsc -p tsconfig.json → dist/
```

`dist/` 与 `node_modules/` 都在主仓 `.gitignore` 里，不入库。

## 装载

### 方式 A：`--patch` 覆盖层（推荐，spike 用的就是这条）

`bridge.patch.yml` 里的一行 `insert`，相对路径会按 **patch 文件所在目录** 锚定成绝对 file URL
（dsh 的 `anchorInsertedPluginNames`），所以这份 patch 可以原地跟着仓库走，不必发布到 npm：

```sh
dsh --profile headless \
    --patch ./plugins/dsh-bridge/bridge.patch.yml \
    "用 stratix_world_snapshot 读一次战场状态"
```

### 方式 B：装进 profile（正规第三方插件路径）

```sh
dsh plugin --profile headless add @stratix/dsh-bridge   # 需要 pnpm
```
装完后在 profile 的 `cordis.patch.yml` 里加一行 `name: '@stratix/dsh-bridge'`。

### 方式 C：自己写一行 `insert`

```yaml
- insert:
    - id: stratix-dsh-bridge
      name: './plugins/dsh-bridge/dist/index.js'
      config:
        url: 'ws://127.0.0.1:7797/ws/world-sync'
        clientId: 'dsh-stratix-bridge'
```

配置项：

| 字段 | 默认 | 说明 |
|---|---|---|
| `url` | `ws://127.0.0.1:7797/ws/world-sync`（或 `$STRATIX_WORLD_SYNC_URL`） | service 的 world-sync 端点 |
| `clientId` | `dsh-stratix-bridge` | clientId（service 侧连接日志用） |
| `reconnectDelayMs` | `500` | 重连退避基数（封顶 5s） |

## 自测

```sh
# 1) 起一个备用端口的 service（别碰 7524/7523 上的用户 dev 实例）
PORT=7797 WS_PORT=7798 DATA_DIR=/tmp/stratix-spike npm run start:dev

# 2) 起 dsh（凭据走环境变量名，不落盘）
export LLM_API_KEY=...
dsh --profile stratix-spike \
    --patch ./plugins/dsh-bridge/bridge.patch.yml \
    --patch ./plugins/dsh-bridge/llm-example.patch.yml \
    "用 stratix_world_snapshot 读一次战场状态"
```

`llm-example.patch.yml` 是「把 LLM 路由指到任意 OpenAI 兼容网关」的示例
（dsh 出厂默认钉在官方 DeepSeek 路由，没有 DeepSeek 凭据会 `MISSING_CREDENTIAL` 退出）。

## 边界

- **零反向依赖**：主仓 `src/` 里没有一行 import 本目录（`grep -r "dsh-bridge" src/` 为空）；
  本目录也不 import 主仓任何文件 —— world-sync 线格式自带一份最小切片。
- **dev preview**：dsh 是 dev preview，API 会变。本目录用的 API 面：`ctx.tools.register` /
  `defineTool` / `inject` / `ctx.effect` / profile patch 的 `insert` + `config:`。
- **不要在插件里依赖主仓构建产物**：插件是可独立分发的包，主仓改了 core 契约，插件这边要自己跟。
