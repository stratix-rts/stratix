# 纹理管理系统重构与跨平台持久化方案

## 📋 概述

**迁移日期**: 2026-03-02  
**迁移类型**: 一次性全量迁移  
**影响范围**: CharacterCreator、RTS、Core Services  
**目标**: 实现纹理统一管理、跨平台兼容、防重复上传、自动缓存

---

## 🎯 设计目标

### 1. 业务分层
```
应用层（场景） → 业务层（TextureManager） → 抽象层（ServiceProvider） → 实现层（Web/Electron）
```

### 2. 跨平台兼容
- **Web 模式**: 自动使用 HTTP API
- **Electron 模式**: 自动使用 IPC + 本地文件系统
- **零配置切换**: 前端代码无需区分环境

### 3. 性能优化
- ✅ LRU 缓存策略（限制 20 个 Canvas）
- ✅ 服务器缓存优先
- ✅ 并发上传去重
- ✅ 头像实时更新

### 4. 容错机制
- ✅ 上传失败允许保存
- ✅ RTS 加载时自动重试
- ✅ 降级显示占位图

---

## 🗂️ 路由拦截配置（Electron）

### 资源路径分类

#### ✅ 需要拦截（本地数据资源）

| 路径前缀 | 本地目录 | 说明 |
|---------|---------|------|
| `/textures/` | `userData/stratix-data/textures/` | 角色纹理图片（832×3456 PNG） |
| `/thumbnails/` | `userData/stratix-data/thumbnails/` | 角色头像缩略图（128×128 PNG，未来扩展） |

#### ❌ 不拦截（透传资源）

| 路径前缀 | 处理方式 | 说明 |
|---------|---------|------|
| `/assets/` | Vite 静态资源 | 前端静态资源（图片、字体等） |
| `/api/` | Gateway HTTP 服务 | 所有 API 接口 |
| `/health` | Gateway HTTP 服务 | 健康检查 |
| `/@vite/` | Vite Dev Server | HMR 热更新 |
| `/node_modules/` | Vite Dev Server | Node 模块访问 |

### 拦截规则配置

```typescript
// electron-main/protocol/protocolConfig.ts

export const PROTOCOL_ROUTES = {
  // ==================== 拦截规则 ====================
  
  /**
   * 角色纹理图片
   * - 来源：CharacterCreator 生成、RTS 加载
   * - 格式：PNG (832×3456)
   * - 存储：stratix-data/textures/{characterId}.png
   */
  '/textures/': {
    handler: 'file',
    baseDir: 'textures',
    securityCheck: true,
    description: '角色完整雪碧图'
  },

  /**
   * 角色头像缩略图（未来扩展）
   * - 来源：CharacterCreator 生成
   * - 格式：PNG (128×128)
   * - 存储：stratix-data/thumbnails/{characterId}.png
   */
  '/thumbnails/': {
    handler: 'file',
    baseDir: 'thumbnails',
    securityCheck: true,
    description: '角色头像缩略图'
  },

  // ==================== 透传规则 ====================
  
  /**
   * 前端静态资源
   * - 由 Vite 处理（开发）或文件服务器提供（生产）
   */
  '/assets/': {
    handler: 'pass',
    description: '前端静态资源'
  },

  /**
   * API 接口
   * - 由内嵌 Gateway 服务处理
   */
  '/api/': {
    handler: 'pass',
    description: 'HTTP API 接口'
  },

  /**
   * 健康检查
   * - 由内嵌 Gateway 服务处理
   */
  '/health': {
    handler: 'pass',
    description: '服务健康检查'
  },

  /**
   * Vite HMR
   * - 仅开发环境使用
   */
  '/@vite/': {
    handler: 'pass',
    description: 'Vite 热更新'
  },

  /**
   * Node 模块
   * - 仅开发环境使用
   */
  '/node_modules/': {
    handler: 'pass',
    description: 'Node 模块访问'
  }
};
```

### 拦截器实现要点

#### 1. 精准匹配
```typescript
// ✅ 正确：精准匹配路径前缀
if (url.includes('/textures/') && config.handler === 'file') {
  // 拦截处理
}

// ❌ 错误：模糊匹配可能误拦截
if (url.includes('textures')) {
  // 可能误拦截 /assets/textures/xxx
}
```

#### 2. 路径安全检查
```typescript
// 防止路径穿越攻击
private isPathSafe(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(filePath);
  const base = path.join(this.dataDir, baseDir);
  return resolved.startsWith(base);
}

// 示例：
// ✅ 安全：/textures/char_123.png → stratix-data/textures/char_123.png
// ❌ 危险：/textures/../../../etc/passwd → 拒绝访问
```

#### 3. 协议选择
- **推荐方案**: 使用标准路径 `/textures/` + `file://` 协议拦截
  - 优点：前端代码无需区分环境
  - 缺点：需要精准拦截，避免误伤

- **备选方案**: 使用自定义协议 `stratix-local://textures/`
  - 优点：不会误伤其他资源
  - 缺点：前端需要根据环境切换 URL

**最终决策**: 推荐方案（标准路径 + 精准拦截）

---

## 📐 架构设计

### 核心服务层

#### 1. ServiceProvider 接口扩展

```typescript
// src/stratix-core/services/ServiceProvider.ts

export interface ServiceProvider {
  // ... 现有方法 ...

  // ==================== 纹理管理服务 ====================

  /**
   * 上传纹理图片
   */
  uploadTexture(
    characterId: string,
    imageData: string,
    filename?: string
  ): Promise<CharacterTexture>;

  /**
   * 检查纹理是否存在
   */
  checkTexture(filePath: string): Promise<{
    exists: boolean;
    url: string | null;
    size?: number;
    generatedAt?: number;
  }>;

  /**
   * 删除纹理文件
   */
  deleteTexture(filePath: string): Promise<void>;

  /**
   * 获取纹理访问URL
   */
  getTextureUrl(filePath: string): string;
}
```

#### 2. TextureManager 业务层

```typescript
// src/stratix-core/services/TextureManager.ts

export class TextureManager {
  // LRU 缓存（限制 20 个）
  private canvasCache: Map<string, {
    canvas: HTMLCanvasElement;
    lastAccess: number;
    accessCount: number;
  }> = new Map();
  
  // 上传任务去重队列
  private uploadPromises: Map<string, Promise<CharacterTexture | null>> = new Map();
  
  /**
   * 生成并上传纹理（自动防重复）
   */
  async generateAndUploadTexture(
    characterData: CharacterData,
    options?: { force?: boolean }
  ): Promise<CharacterTexture | null>;
  
  /**
   * 确保纹理可用（优先使用缓存）
   */
  async ensureTexture(characterData: CharacterData): Promise<string | null>;
  
  /**
   * 生成头像
   */
  generateThumbnail(canvas: HTMLCanvasElement, size?: number): string;
  
  /**
   * 删除纹理
   */
  async deleteTexture(characterData: CharacterData): Promise<void>;
}
```

### 数据流设计

#### 创建流程
```
用户操作 → 部件选择
    ↓
updatePreview()
    ├─ 生成雪碧图（内存）
    ├─ 生成头像（每次重新生成）✅
    └─ 更新预览
    ↓
点击"完成创建"
    ↓
saveCharacter()
    ├─ 上传雪碧图到服务器 ✅
    │   └─ POST /api/stratix/texture/upload
    │       → stratix-data/textures/{characterId}.png
    ├─ 保存到 IndexedDB（含 texture 元数据）✅
    └─ 发送 character:created 事件
    ↓
App.handleCharacterCreated()
    └─ agentStore.createCustomAgent()
        └─ POST /api/stratix/config/agent/create
```

#### 并发场景（防重复）
```
T0: 用户点击"保存"
    └─ generateAndUploadTexture()
       └─ 创建 Promise，加入队列
       └─ 开始上传...（pending）

T1: 用户立即添加到 RTS（200ms 后）
    └─ ensureTexture()
       └─ generateAndUploadTexture()
          └─ ✅ 检测到队列中已有任务
          └─ ✅ 返回同一个 Promise
          
T2: 上传完成（2s 后）
    └─ Promise resolve
    └─ ✅ 两个调用者都收到相同结果
    └─ ✅ 只上传了一次！
```

---

## 📦 文件结构

### 新增文件

```
src/stratix-core/services/
├── TextureManager.ts              ✅ 统一业务层
└── ServiceProvider.ts             ✅ 扩展接口（+纹理管理）

electron-main/
├── services/
│   └── textureService.ts          ✅ 主进程纹理服务
└── protocol/
    ├── protocolConfig.ts          ✅ 路由拦截配置
    └── ProtocolHandler.ts         ✅ 协议处理器
```

### 修改文件

```
src/stratix-core/services/
├── WebServiceProvider.ts          ✅ 实现纹理接口
├── ElectronServiceProvider.ts     ✅ 实现纹理接口
└── index.ts                       ✅ 导出 TextureManager

src/stratix-character-creator/
├── CharacterCreatorScene.ts       ✅ 集成 TextureManager
└── types/index.ts                 ✅ 扩展 SavedCharacter

src/stratix-rts/services/
├── RTSCharacterRenderer.ts        ✅ 简化，复用 TextureManager
└── TextureService.ts              ❌ 废弃（保留兼容性导出）

src/stores/
└── agentStore.ts                  ✅ 同步 character.texture
```

### 废弃文件

```
src/stratix-rts/services/TextureService.ts  ❌ 迁移到 TextureManager
```

---

## 🔄 迁移步骤

### Phase 1: 核心服务层（0 破坏性）

- [ ] 1.1 扩展 ServiceProvider 接口
- [ ] 1.2 实现 WebServiceProvider
- [ ] 1.3 实现 ElectronServiceProvider
- [ ] 1.4 创建 TextureManager
- [ ] 1.5 扩展 SavedCharacter 类型

### Phase 2: Electron 主进程

- [ ] 2.1 创建 protocolConfig.ts（路由拦截配置）
- [ ] 2.2 创建 ProtocolHandler.ts（协议处理器）
- [ ] 2.3 创建 textureService.ts（纹理服务）
- [ ] 2.4 注册到主进程入口

### Phase 3: CharacterCreator 迁移

- [ ] 3.1 修改 updatePreview()（头像实时更新）
- [ ] 3.2 修改 saveCharacter()（上传纹理）
- [ ] 3.3 修改 onCharacterDeleted()（清理纹理）
- [ ] 3.4 测试创建/编辑/删除流程

### Phase 4: RTS 系统迁移

- [ ] 4.1 简化 RTSCharacterRenderer
- [ ] 4.2 废弃 TextureService（保留兼容性）
- [ ] 4.3 测试 RTS 加载流程

### Phase 5: AgentStore 同步

- [ ] 5.1 修改 createCustomAgent()（同步 texture）
- [ ] 5.2 修改 updateCustomAgent()（同步 texture）
- [ ] 5.3 测试 Agent 创建/更新

### Phase 6: 测试与验证

- [ ] 6.1 单元测试（TextureManager）
- [ ] 6.2 集成测试（CharacterCreator + RTS）
- [ ] 6.3 并发测试（防重复上传）
- [ ] 6.4 性能测试（缓存命中率）
- [ ] 6.5 Electron 打包测试

---

## ✅ 验收标准

### 功能验收

- [ ] 创建角色时生成纹理并上传
- [ ] 修改角色时头像实时更新
- [ ] 保存角色时纹理持久化
- [ ] 加载角色时优先使用服务器缓存
- [ ] 删除角色时清理纹理文件
- [ ] 并发场景防重复上传（Promise 去重）
- [ ] LRU 缓存自动淘汰
- [ ] 上传失败不影响角色保存
- [ ] Electron 打包版本正常运行
- [ ] Web 版本正常运行

### 性能指标

- [ ] 缓存命中率 > 90%
- [ ] 并发上传去重成功率 100%
- [ ] 内存占用 < 150MB（含缓存）
- [ ] 纹理上传时间 < 3s

### 代码质量

- [ ] 无 TypeScript 编译错误
- [ ] 无 ESLint 警告
- [ ] 单元测试覆盖率 > 80%
- [ ] 文档完整（API 文档、迁移指南）

---

## 🚨 注意事项

### 向后兼容

1. **旧角色数据迁移**
   - 旧的 SavedCharacter 没有 texture 字段
   - 首次加载时自动生成并上传

2. **API 兼容性**
   - 保留 `/api/stratix/texture/*` 路由
   - Web 和 Electron 共用相同的 API

### 错误处理

1. **上传失败**
   - 允许角色保存（降级处理）
   - 记录日志，下次加载时重试

2. **文件读取失败**
   - 使用占位图（placeholder）
   - 尝试重新生成

3. **缓存淘汰**
   - 记录被淘汰的角色 ID
   - 下次访问时重新生成

### 安全考虑

1. **路径穿越防护**
   - 验证所有文件路径
   - 禁止访问 dataDir 之外的文件

2. **文件类型验证**
   - 只允许 PNG/JPEG/WebP 格式
   - 检查 base64 数据格式

3. **文件大小限制**
   - 单个纹理文件 < 10MB
   - 总存储空间监控

---

## 📊 性能影响分析

### 内存占用

| 组件 | 占用 | 说明 |
|------|------|------|
| Canvas 缓存（20个） | ~100MB | 每个 Canvas 约 5MB |
| IndexedDB | 不限 | 角色元数据 |
| 纹理文件 | 2-5MB/角色 | PNG 压缩后 |

### 加载速度

| 场景 | 耗时 | 说明 |
|------|------|------|
| 首次生成 | 2-3s | 生成 + 上传 |
| 缓存命中（服务器） | < 100ms | HTTP 下载 |
| 缓存命中（内存） | < 10ms | 直接使用 |
| Electron 本地加载 | < 50ms | 文件读取 |

### 网络开销

| 操作 | 流量 | 说明 |
|------|------|------|
| 上传纹理 | 2-5MB | 一次 |
| 下载纹理 | 2-5MB | 每次加载（可缓存） |
| API 调用 | < 10KB | 元数据同步 |

---

## 🔗 相关文档

- [Electron Protocol API](https://www.electronjs.org/docs/latest/api/protocol)
- [ServiceProvider 设计文档](../src/stratix-core/services/README.md)
- [CharacterCreator 使用指南](../src/stratix-character-creator/README.md)
- [RTS 系统架构](../src/stratix-rts/README.md)

---

## 📝 更新日志

### v1.0.0 (2026-03-02)
- ✅ 完成核心服务层设计
- ✅ 完成路由拦截配置
- ✅ 完成迁移文档
- 🚧 开始执行迁移...
