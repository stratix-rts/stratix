# stratix-openclaw-adapter 模块评审

## 概览

**模块用途**: OpenClaw Agent 连接适配器，提供多协议（HTTP/WebSocket）和多环境（本地/远程/网关）的统一接口

**文件统计**: 9 文件
- `index.ts` - 入口和工厂函数
- `types.ts` - 接口和类型定义
- `LocalOpenClawAdapter.ts` - 本地 HTTP + WebSocket
- `RemoteOpenClawAdapter.ts` - 远程 HTTP 适配器
- `WebSocketOpenClawAdapter.ts` - WebSocket 直连接入
- `GatewayOpenClawAdapter.ts` - 网关代理适配器（浏览器环境）
- `ConnectionPool.ts` - 连接池管理
- `test-connection.ts`, `demo-one-to-many.ts` - 测试/演示脚本

**关键 Exports**:
- `createOpenClawAdapter()` - 工厂函数（环境检测自动选择适配器）
- `createWebSocketAdapter()` - WebSocket 直连
- `createConnectionPool()` - 连接池
- 各 Adapter 类

---

## 代码质量

### 优点

- **接口设计清晰**: `OpenClawAdapterInterface` 统一定义所有适配器必须实现的方法
- **工厂模式合理**: `createOpenClawAdapter()` 根据环境自动选择合适的适配器
- **连接池完整**: `ConnectionPool` 提供了健康检查、重连、空闲清理等企业级功能
- **类型定义完善**: `types.ts` 覆盖了主要接口

### 问题

**问题 1: `RemoteOpenClawAdapter.isConnected()` 永远返回 false**
- `RemoteOpenClawAdapter.ts:128-130`
```typescript
public isConnected(): boolean {
  return false;
}
```
这是一个明显的 bug，该方法应该检查 HTTP 连接状态

**问题 2: `LocalOpenClawAdapter` 有未使用的 WebSocket 代码**
- `LocalOpenClawAdapter.ts:61` 声明了 `ws: WebSocket | null = null`
- 但整个类中从未初始化或使用 `ws`
- 代码冗余，容易误导

**问题 3: 缺少 `unsubscribe` 方法**
- 所有适配器的 `subscribe()` 将回调添加到数组，但无对应的 `unsubscribe()` 方法
- 长期使用会导致订阅者列表无限增长

**问题 4: `WebSocketOpenClawAdapter` 的 `~` 路径未展开**
- `WebSocketOpenClawAdapter.ts:76-77`
```typescript
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
return path.join(homeDir, DEVICE_KEY_FILE);
```
- `path.join()` 不展开 `~`，实际路径会是 `~/.stratix/device_key.json` 而不是 `/home/user/.stratix/device_key.json`

---

## 安全问题

### 中风险: 设备密钥文件权限

**位置**: `WebSocketOpenClawAdapter.ts:124`
```typescript
fs.writeFileSync(keyPath, JSON.stringify(this.deviceKey, null, 2));
```
- 私钥以纯文本写入文件系统
- 应设置 `mode: 0o600` 限制文件权限

---

### 低风险: API Key 内存中明文存储

- 所有适配器将 `apiKey` 存储在实例变量中
- 通过 `Authorization: Bearer ${config.apiKey}` 发送
- 建议: 使用完后从内存清除，或使用更安全的 token 管理方案

---

### 低风险: WebSocket URL 生成

**位置**: `GatewayOpenClawAdapter.ts:70-72`
```typescript
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
return `${wsProtocol}//${window.location.host}/api/stratix/openclaw/proxy/${this.proxyKey}/ws?clientId=${this.config.accountId}`;
```
- URL 拼接未做白名单验证，可能被利用构造恶意 URL

---

## 性能问题

### 中风险: 连接池健康检查风暴

**位置**: `ConnectionPool.ts:185-190`
```typescript
this.healthCheckTimer = setInterval(() => {
  this.performHealthCheck();
}, this.options.healthCheckInterval);
```
- 所有连接同时进行健康检查
- 在连接数多时可能造成服务器压力

**建议**: 错开各连接的检查时间

---

### 低风险: Stream 响应处理

**位置**: `LocalOpenClawAdapter.ts:222`
```typescript
response.data.on('data', (chunk: Buffer) => {
```
- 使用 `Buffer` 类型，在浏览器环境中可能不可用（应使用 `ArrayBuffer` 或 `string`）

---

## 架构问题

### 适配器职责重叠

| 适配器 | HTTP | WebSocket | 重连 | 适用环境 |
|--------|------|-----------|------|----------|
| LocalOpenClawAdapter | ✅ | ❌ (代码存在但未用) | ❌ | Node.js 本地 |
| RemoteOpenClawAdapter | ✅ | ❌ | ❌ | Node.js 远程 |
| WebSocketOpenClawAdapter | ❌ | ✅ | ✅ | Node.js |
| GatewayOpenClawAdapter | ✅ | ✅ | ✅ | Browser |

- `LocalOpenClawAdapter` 和 `RemoteOpenClawAdapter` 功能几乎相同，代码重复约 70%
- 建议: 合并为 `HTTPOpenClawAdapter`，通过配置区分本地/远程

---

### ConnectionPool 重连逻辑问题

**位置**: `ConnectionPool.ts:278-280`
```typescript
if (conn.info.errorCount >= this.options.reconnectAttempts) {
  conn.info.status = 'error';
}
```
- `errorCount` 在每次 `handleConnectionError` 时递增，但 `attemptReconnect` 成功后不会重置为 0（虽然 line 222 有 reset，但只在成功时）

---

## 横向联动

**被依赖**:
- `stratix-core` - `UnifiedOpenClawConnectionManager`
- `stratix-character-creator` - BackendSelector
- Electron 主/渲染进程

**依赖**:
- `stratix-core/stratix-protocol` - 类型定义
- `axios` - HTTP 客户端
- `ws` - WebSocket 客户端
- `crypto` - RSA 密钥生成/签名

---

## 改进建议 (按优先级)

### P0 - 必须修复

1. **修复 `isConnected()` 返回值**
   - `RemoteOpenClawAdapter.ts:128-130`
   - 应该检查实际的 HTTP 连接状态

2. **移除未使用的 WebSocket 代码或实现它**
   - `LocalOpenClawAdapter.ts:61` 的 `ws` 字段要么实现，要么删除

3. **添加 `unsubscribe()` 方法**
   - 所有适配器需要 `unsubscribe(callback)` 方法防止订阅者泄漏

### P1 - 强烈建议

4. **展开 `~` 路径**
   - `WebSocketOpenClawAdapter.ts:76-77`
   - 使用 `path.expandVars()` 或手动替换

5. **设置私钥文件权限**
   - `WebSocketOpenClawAdapter.ts:124`
   - 添加 `mode: 0o600`

6. **合并 Local/Remote 适配器**
   - 减少代码重复

7. **错开健康检查时间**
   - `ConnectionPool.ts` - 每个连接的检查时间错开 Jitter

### P2 - 可改进

8. **统一 Stream 处理**
   - 使用跨环境的流处理方式

9. **添加连接超时配置**
   - 目前硬编码为 30000ms/60000ms

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | A | 多协议多环境覆盖完整 |
| 代码质量 | B | 接口清晰，但有重复代码 |
| 安全性 | B | 基本安全，有小改进空间 |
| 性能 | B | 连接池设计良好，细节可优化 |
| 可维护性 | B | 架构清晰，适配器间有重复 |
| 测试覆盖 | D | 无测试 |
