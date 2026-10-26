# task_067 dev: HMR 半更新防护——app 代码改动触发整页 reload

## 描述

用户 dev 实例跑 31 小时跨 3 个提交，vite HMR 把新模块热推进旧装配的活页面，产生半新半旧的混血状态（旧自定义元素实例 + 新事件常量/新装配闭包），出现不可复现的交互报错（快捷键弹窗关闭钮报错等，全新实例零错误——已用 Playwright 全量交互扫描对照验证）。本仓库是 Web Components + 组合根装配架构，HMR 对这类代码天然不安全：自定义元素已定义则实例不重建、main-entry 组合根闭包持有旧模块引用。

## 需求（requirements）

1. `vite.config.ts` 实现指定目录变更强制 full-reload：`src/app/**`、`src/hud/**`、`src/core/**`、`src/world/**` 模块更新时走整页刷新（vite 插件 `handleHotUpdate` 里 `server.ws.send({ type: 'full-reload' })` 或等价机制），**不**做局部 HMR
2. 配置处加注释说明动机（WC + 组合根装配对 HMR 不安全；长跑 dev 实例吃跨提交热更会产生混血状态）
3. 构建行为不受影响（`npm run build:frontend` 正常）；不引入新依赖；不动业务代码
4. 验证方法：临时往 `src/hud/` 某文件加一行注释保存，确认 vite 日志/行为是 full reload 而非 HMR patch（Electron 页面整页刷新）；验证后还原临时改动

## 验收标准（acceptance）

- [ ] vite.config.ts 对四大目录变更触发 full-reload，注释说明动机
- [ ] 临时改动验证 reload 生效后已还原（git status 干净或只剩 vite.config.ts 改动）
- [ ] `npm run typecheck` 零错误
- [ ] `npm run build:frontend` 成功
- [ ] 不引入新依赖

## 禁止事项

- 不引入新依赖
- 不动 src/ 业务代码
- 不改构建产物行为

## 交付物

- `vite.config.ts`：四大目录（src/app、src/hud、src/core、src/world）变更强制 full-reload 的配置/插件 + 动机注释

## 验证方式

```bash
npm run typecheck && npm run build:frontend
# 手动：touch src/hud 内文件 → 观察 vite full-reload
```

## 验证证据（完成前必填）

- [x] **实现证明**: `vite.config.ts` 新增 `hmrFullReloadGuard(root)` 插件（`apply: 'serve'`），
  在 `handleHotUpdate(ctx)` 里把 `ctx.file` 换算成相对项目根的 posix 路径，命中
  `src/app`、`src/hud`、`src/core`、`src/world` 四个目录前缀时：
  ① `ctx.server.ws.send({ type: 'full-reload', path: '*' })` 主动整页刷新；
  ② `return []` 阻止 vite 默认的模块级 HMR patch；
  ③ 打一行 `[stratix] <文件> 变更 → 强制整页 reload（禁用局部 HMR）` 日志便于追溯。
- [x] **测试验证**: 临时 vite 实例（端口 7533）+ HMR WebSocket 监听（见下方"验证结果"），
  改 `src/hud/**` 文件 → 收到 `{"type":"full-reload","path":"*"}` 且无 `update` 载荷；
  改四目录之外的文件（`src/stratix-core/stratix-protocol.ts`、`stratix-data/*.sqlite`）
  → 无 full-reload、无守卫日志（对照通过）。临时改动均已 `git checkout` 还原。
- [x] **影响范围**: 仅 dev server 行为（`apply: 'serve'`），构建产物不变；
  四目录之外的模块（含 node_modules 依赖）HMR 行为保持原样；不新增任何依赖。

### 测试步骤
1. npm run typecheck
2. npm run build:frontend
3. 临时改动 src/hud 文件 → 观察 full-reload → 还原

### 验证结果

**1) npm run typecheck —— 零错误**

```
> stratix@0.1.0 typecheck
> tsc --noEmit
（无输出 = 零错误）
```

**2) npm run build:frontend —— 成功**

```
> stratix@0.1.0 build:frontend
> vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 122 modules transformed.
rendering chunks...
computing gzip size...
dist/frontend/src/app/main/index.html        3.54 kB │ gzip:   1.69 kB
dist/frontend/assets/main-CTr-D3PD.js      420.04 kB │ gzip: 116.01 kB │ map: 2,087.91 kB
dist/frontend/assets/phaser-DaAX4wSk.js  1,208.13 kB │ gzip: 330.13 kB │ map: 10,129.22 kB
✓ built in 2m 38s
```
（"chunks are larger than 500 kB" 为既有告警，与本次改动无关）

**3) 临时 vite 实例的 full-reload 证据（端口 7533，DEBUG=vite:hmr）**

改动 `src/hud/components/shortcuts/shortcut-catalog.ts`（加一行注释）后：

```
# vite 日志
2026-10-26T15:47:04.727Z vite:hmr [file change] src/hud/components/shortcuts/shortcut-catalog.ts
11:47:04 PM [vite] [stratix] src/hud/components/shortcuts/shortcut-catalog.ts 变更 → 强制整页 reload（禁用局部 HMR）
2026-10-26T15:47:04.728Z vite:hmr (client) [no modules matched] src/hud/components/shortcuts/shortcut-catalog.ts
2026-10-26T15:47:04.728Z vite:hmr (ssr) [no modules matched] src/hud/components/shortcuts/shortcut-catalog.ts

# HMR WebSocket 客户端收到的载荷
[2026-10-26T15:47:04.728Z] WS RECV {"type":"custom","event":"file-changed","data":{"file":".../src/hud/components/shortcuts/shortcut-catalog.ts"}}
[2026-10-26T15:47:04.728Z] WS RECV {"type":"full-reload","path":"*"}
```
→ 客户端收到 `full-reload`（触发 `location.reload()`），全程**没有** `update` 载荷，
  即未发生任何局部 HMR patch；`[no modules matched]` 佐证默认 HMR 已被 `return []` 掐断。

**对照实验（非四目录不应触发 full-reload）**——改 `src/stratix-core/stratix-protocol.ts`：

```
2026-10-26T15:47:20.563Z vite:hmr [file change] src/stratix-core/stratix-protocol.ts
2026-10-26T15:47:20.564Z vite:hmr (client) [no modules matched] src/stratix-core/stratix-protocol.ts
（无 [stratix] 守卫日志；WS 端未收到 full-reload 载荷）
```
→ 守卫按目录精确生效，未误伤其它路径。

**还原确认**：临时改动已全部 `git checkout -- <file>` 还原，`git status --porcelain src/hud src/stratix-core` 为空；
临时 vite 实例（7533）与 WS 监听进程已 kill，端口已释放（用户自己的 7523 实例全程未动）。
