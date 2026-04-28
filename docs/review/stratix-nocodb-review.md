# stratix-nocodb 模块评审报告

## 概览

**模块路径**: `src/stratix-nocodb/`
**文件数量**: 3 个文件（1 TS + 1 Vue + 1 入口）
**核心职责**: 将 NocoDB（开源 NoSQL 数据库前端）作为嵌入式数据可视化层集成到 Stratix 中。通过子进程管理 NocoDB 服务，并通过 Vue Modal + iframe 展示数据看板。

### 关键 Exports

| 导出 | 文件 | 说明 |
|------|------|------|
| `NocoDBService` | `NocoDBService.ts` | 子进程管理（启动/停止/构建） |
| `getNocoDBService()` / `createNocoDBService()` | `NocoDBService.ts` | 服务单例获取 |
| `NocoDBViewer` | `NocoDBViewer.vue` | 嵌入式 iframe Modal 组件 |

---

## 代码质量

### 优点

- 单一职责明确：进程管理和 UI 分离
- 方法命名清晰，生命周期管理完整（start/stop/isRunning/isBuilt）
- Vue 组件结构规范，使用 `<script setup>` + scoped CSS

### 问题

**问题 1: 重复的单例管理**
- `getNocoDBService()` 和 `createNocoDBService()` 都可以创建/覆盖单例
- `createNocoDBService()` 直接覆盖已有实例，不检查是否正在运行，会丢失原进程引用

**问题 2: `build()` Promise reject 后无 return**
- `src/stratix-nocodb/NocoDBService.ts:103` — `reject(err)` 后应 `return`，避免继续执行

**问题 3: `start()` 方法过长**
- 约 80 行，杂糅了进程启动、日志处理、就绪检测三重逻辑，建议拆分

**问题 4: 构造函数有 I/O 副作用**
- `NocoDBService.ts:39-40` 构造函数中调用 `getDatabase()` 并执行 `db.getPath()`，违反"构造函数应只做赋值"原则

**问题 5: `stop()` 的 zombie 进程处理**
- `proc.kill('SIGTERM')` 后设置 5 秒超时强制 SIGKILL，但若进程已自行退出，`proc` 引用可能处于 zombie 状态。Promise 已在 `setTimeout(5000)` 后 resolve，exit 事件无人处理。

---

## 安全

### 严重: 硬编码 JWT Secret

- `src/stratix-nocodb/NocoDBService.ts:19`
  ```typescript
  jwtSecret: 'stratix-nocodb-secret-2026',
  ```
  **这是致命安全漏洞**。默认 JWT Secret 若部署到生产环境，攻击者可凭此伪造任意用户 token。建议：
  1. 必须从环境变量读取，永不提供默认值
  2. 或至少要求显式传入，无值时拒绝启动

### 高危: iframe 缺少 sandbox 属性

- `src/stratix-nocodb/NocoDBViewer.vue:37-43`
  ```html
  <iframe
    v-if="isConnected"
    ref="iframeRef"
    :src="nocoDBUrl"
    class="nocodb-iframe"
    @load="handleIframeLoad"
  />
  ```
  iframe 无 `sandbox` 属性，NocoDB 页面可执行 JavaScript、提交表单、打开弹出窗口。建议加 `sandbox="allow-same-origin allow-scripts"` 并按需收紧。

### 中危: 子进程 shell 命令格式错误

- `src/stratix-nocodb/NocoDBService.ts:83`
  ```typescript
  const buildProcess = spawn('pnpm', ['install', '&&', 'build'], { shell: true, ... });
  ```
  `'&&'` 作为数组元素会导致被当作单个参数传递给 pnpm，而不是 shell 的命令连接符。应该是 `spawn('sh', ['-c', 'pnpm install && build'], { cwd: ..., shell: false })`。

### 中危: 环境变量白名单缺失

- `start()` 中 `const env: NodeJS.ProcessEnv = { ...process.env, ... }` 直接继承全部 `process.env`，可能泄漏非必要的敏感环境变量给子进程。建议只传递 `NC_*` 相关变量。

### 低危: 默认端口 8080

- 8080 是常见扫描目标，且可能与其他服务冲突。

---

## 性能

### 子进程阻塞 build

- `build()` 使用同步等待的 Promise，build 期间 Node.js 事件循环完全阻塞。对于可能耗时数分钟的首次构建，应支持后台执行或 fork 模式。

### 无 build 缓存验证

- `isBuilt()` 只检查 `bundle.js` 是否存在，不验证内容完整性或版本匹配。若 NocoDB 版本更新但残留旧版 bundle，可能导致运行时错误。

### 无 iframe 卸载清理

- `NocoDBViewer` 无 `onUnmounted` hook，组件销毁时 iframe 不会被移除。

### 无 maxBuffer 限制

- 子进程 `spawn` 时未设置 `maxBuffer`，大输出可能撑满 pipe buffer 导致阻塞。

---

## 架构

### 单例滥用

- `NocoDBService` 使用模块级单例 `nocoDBServiceInstance`（`NocoDBService.ts:260-272`），`NocoDBViewer` 每次都调用 `getNocoDBService()` 获取同一实例。问题：
  1. 无法在测试中替换 mock 实例
  2. 若要同时管理多个 NocoDB 实例完全无法支持
  3. 组件可测试性为零

### 依赖方向

```
NocoDBViewer.vue ──> NocoDBService (singleton)
NocoDBService ──> stratix-database (getDatabase())
NocoDBService ──> child_process (spawn)
NocoDBService ──> fs-extra
```

---

## 测试

- **完全没有测试文件**。无任何 `.spec.ts` 测试。
- `start()` 的就绪检测逻辑（监听 stdout 中的 `'ready'` / `'listening'` 等关键字）在不同环境下可能不同，缺乏边界测试。

---

## 横向联动

| 依赖模块 | 调用位置 | 说明 |
|----------|----------|------|
| `stratix-database` | `NocoDBService` 构造函数 | 获取 SQLite 数据库路径 |
| `@/components/ui/StratixModal` | `NocoDBViewer.vue` | Modal 包装组件 |
| `@/components/ui/StratixButton` | `NocoDBViewer.vue` | 工具栏按钮 |
| `child_process` (Node.js) | `NocoDBService` | 管理子进程 |

---

## 改进建议（按优先级）

### P0 — 必须修复

1. **移除硬编码 JWT Secret，拒绝无 secret 启动**
   - `NocoDBService.ts:19`
   - 改为：`jwtSecret: options.jwtSecret || process.env.NC_AUTH_JWT_SECRET`，若为空则抛出错误拒绝启动

2. **修复 shell 命令格式**
   - `NocoDBService.ts:83`
   - 改为：`spawn('sh', ['-c', 'pnpm install && build'], { cwd: this.nocoDBPackagePath, shell: false, ... })`

3. **为 iframe 添加 sandbox 属性**
   - `NocoDBViewer.vue:37-43`
   - 至少：`sandbox="allow-same-origin allow-scripts"`

### P1 — 强烈建议

4. **拆分 `start()` 方法**
   - 提取 `_spawnProcess()` / `_waitForReady()` / `_validateBuild()` 等私有方法

5. **提供环境变量配置**
   - `port`, `jwtSecret`, `disableTelemetry` 均应优先从 `process.env` 读取

6. **为 `NocoDBViewer` 添加 `onUnmounted` 清理**
   ```typescript
   onUnmounted(() => {
     if (iframeRef.value) {
       iframeRef.value.src = 'about:blank';
     }
   });
   ```

7. **添加 `maxBuffer` 限制子进程输出**
   ```typescript
   { ... , stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 }
   ```

8. **修复 `stop()` 的 zombie 处理**
   - 不要同时依赖 timeout 和 exit 事件，会导致竞态

### P2 — 建议改进

9. **支持后台 build 模式**，区分"首次冷构建"和"已缓存"场景

10. **实现 `isHealthy()` 方法**，主动检测子进程是否真的存活（而不仅是检查引用）

11. **明确环境变量白名单**，只传递必要的 `NC_*` 变量给子进程
