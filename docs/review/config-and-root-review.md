# Config, Styles, Services & Root Files Review

## 概览

| 模块 | 文件数 | 说明 |
|------|--------|------|
| `src/config/` | 2 | AI provider 配置模板 |
| `src/styles/` | 1 | Command palette 样式 |
| `src/services/` | 1 | Web Audio 声音服务 |
| Root configs | 13+ | Vite/TS/ESLint/Jest/Playwright/Electron 配置 |
| entry files | 2 | `src/main.ts`, `src/App.vue` |

**关键 Exports**:
- `SoundService`: `soundService` 单例，导出 `play()`, `playTaskComplete()`, `playAgentStatusChange()`, `playWarning()`, `playClick()`, `volume`, `enabled`, `loadSettings()`, `destroy()`
- Provider configs: 纯 JSON 数据文件

---

## 代码质量

### SoundService (`src/services/SoundService.ts`)

**优点**:
- 清晰的 JSDoc 注释，说明了所有声音类型
- ADSR 包络实现正确，音效听起来自然
- 单例模式实现正确，线程安全
- Settings 持久化到 localStorage
- 安全的 AudioContext 初始化（浏览器环境检测）

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `window` 类型断言 | L87 | `window.AudioContext || (window as any).webkitAudioContext` — 使用 `any` 绕过了类型检查，应使用 `window.webkitAudioContext` |
| 音量边界 | L232 | `Math.max(0, Math.min(1, value))` — 逻辑正确，但可以简化 |
| 空的 catch 块 | L259 | `} catch { // ignore }` — 应该至少 log warning |

```typescript
// L87: 应避免 any
this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

// L259: 空 catch 静默失败
} catch {
  // ignore
}
// 建议：
} catch (e) {
  console.warn('[SoundService] Failed to parse saved settings:', e);
}
```

### Provider Configs

**问题**:

| 问题 | 文件 | 说明 |
|------|------|------|
| 空模板 | `providers.config.json` | 仅有 `{}` 和 `[]`，注释说明缺失，用户不知道格式 |
| API Key 明文存储风险 | `custom-providers.config.json` | `envKey` 字段暴露了环境变量名称，但不明确是否支持 .env 注入 |

### Root Config Files

**问题**:

| 问题 | 文件 | 说明 |
|------|------|------|
| `build` 重复定义 | `vite.config.ts:58-74` 和 `vite.config.ts:81-87` | `build` 对象定义了两次，后者会覆盖前者 |
| `jest.config.js` 使用 CommonJS | L2 | 项目其他部分用 ESM，但 Jest 配置用 `module.exports` |
| `jest.config.js` 备份文件未清理 | `jest.config.ts.bak` | 应删除或移出项目根目录 |

```typescript
// vite.config.ts:58-87 - build 重复定义
build: {
  outDir: 'dist/frontend',
  sourcemap: true,
  rollupOptions: {
    output: {
      manualChunks: (id) => { ... }
    },
  },
},

// ... 被下面覆盖 ...

build: {   // <-- 重复！下面的会覆盖上面的
  outDir: 'dist/frontend',
  sourcemap: true,
  rollupOptions: {
    external: ['fs-extra', 'graceful-fs'],
  },
},
```

---

## 安全

### 潜在风险

| 风险 | 位置 | 说明 |
|------|------|------|
| API endpoints 硬编码 | `vite.config.ts:40-55` | `/api`, `/ws` proxy 硬编码指向 `127.0.0.1:7524`，生产环境需要动态配置 |
| CORS 配置缺失 | `vite.config.ts` | 开发 server 没有 CORS 配置，默认允许所有来源（可接受用于开发） |
| Playwright E2E credentials | `playwright.config.ts` | `baseURL: 'http://localhost:7523'` — 不适用于生产 |
| electron.config.json 暴露 app ID | L2 | `"appId": "com.stratix.app"` — 随包发布 |

### SoundService 安全

- **无 XSS 风险** — 纯 Web Audio API，无用户输入处理
- **无 injection 风险** — 音效频率/类型来自内部配置，非外部输入
- **localStorage 依赖** — 数据未加密，但 settings 仅包含 volume/enabled，无敏感信息

---

## 性能

### SoundService

| 指标 | 状态 | 说明 |
|------|------|------|
| 内存泄漏 | OK | `destroy()` 方法正确清理 AudioContext |
| 音频节点清理 | OK | `osc.stop(now + duration + 0.01)` 确保节点释放 |
| 并发限制 | OK | 每个 `play()` 调用创建新 oscillator，不累积 |

**潜在问题**: 连续快速调用 `play()` 会创建多个 oscillator，但 Web Audio 会自动垃圾回收。

### Vite Config

| 问题 | 说明 |
|------|------|
| `manualChunks` 无缓存 | 每次构建重新分析模块，可加 `chunkCache` |
| `optimizeDeps.exclude` | `['lowdb', 'fs-extra', 'graceful-fs']` — 这些是 Node.js 模块，正确排除 |

### Jest Config

| 问题 | 说明 |
|------|------|
| `maxWorkers: 2` (local) | 符合 CLAUDE.md 资源纪律，避免 CPU 满载 |
| `testTimeout: 15000` | 合理 |
| 覆盖率配置 | 只覆盖部分模块（`stratix-project` 等），未全覆盖 |

### Playwright Config

| 问题 | 说明 |
|------|------|
| `workers: Math.max(Math.ceil(os.cpus().length / 4), 2)` | 合理，最多使用 25% CPU 核心 |
| `timeout: 60000` | 60s 对于 E2E 测试略短，建议 120s |

---

## 架构

### 模块边界

```
SoundService (src/services/)
  └── 使用: Web Audio API, localStorage
  └── 被依赖: App.vue (zone event sounds)

Provider Configs (src/config/)
  └── 使用: AI provider 列表/配置
  └── 被依赖: 可能在 agent 配置 UI 中使用

Root Configs
  └── vite.config.ts: 定义模块别名 (@stratix-*)
  └── tsconfig.*.json: TypeScript 项目引用
```

### 依赖方向

- `App.vue` → `SoundService` → Web Audio API
- `App.vue` → `main.ts` → Pinia stores
- `vite.config.ts` → 定义的 alias 被所有 src/* 模块使用

### 问题

| 问题 | 说明 |
|------|------|
| `vite.config.ts` 中定义的 alias 重复 | `@stratix-core`, `@stratix-gateway`, `@stratix-designer` 等 alias 同时在 `tsconfig.paths.json` 和 `vite.config.ts` 中定义，应统一 |
| `tsconfig.electron.json` include 列表手动维护 | L23 的 include 列表很长，手动添加新模块容易遗漏 |

---

## 测试覆盖

### SoundService

| 测试类型 | 状态 |
|----------|------|
| 单元测试 | **缺失** — 没有 `SoundService.test.ts` |
| 集成测试 | N/A — 依赖 Web Audio API（浏览器环境） |

**建议**: 由于 Web Audio API 需要浏览器环境，建议创建基于 jsdom 或 playwright 的测试。

### Root Configs

| 配置 | 测试覆盖 |
|------|----------|
| `vite.config.ts` | 无测试（手动验证） |
| `jest.config.js` | 无测试（手动验证） |
| `playwright.config.ts` | 无测试（通过 E2E 测试验证） |

---

## 横向联动

### SoundService 依赖方

| 文件 | 用途 |
|------|------|
| `src/App.vue:21` | 导入 `soundService` |
| `src/App.vue:236-244` | zone event 触发声音（task complete, member joined/left） |

### Provider Configs 依赖方

需进一步搜索确认使用位置。

### Vite Aliases 使用方

| Alias | 指向 |
|-------|------|
| `@` | `src/` |
| `@stratix-core` | `src/stratix-core/` |
| `@stratix-gateway` | `src/stratix-gateway/` |
| `@stratix-designer` | `src/stratix-designer/` |
| `@stratix-data-store` | `src/stratix-data-store/` |
| `@stratix-openclaw-adapter` | `src/stratix-openclaw-adapter/` |
| `@stratix-command-panel` | `src/stratix-command-panel/` |
| `@stratix-rts` | `src/stratix-rts/` |

---

## 改进建议

### 高优先级

1. **修复 `vite.config.ts` 重复 `build` 对象** (`vite.config.ts:58-87`)
   - 删除第一个 `build` 对象或合并两者
   - 当前第二个 `build` 完全覆盖第一个，导致 `manualChunks` 配置无效

2. **添加 SoundService 单元测试**
   - 创建 `src/services/__tests__/SoundService.test.ts`
   - Mock AudioContext 和 localStorage

3. **统一 Alias 定义**
   - `vite.config.ts` 和 `tsconfig.paths.json` 重复定义 aliases
   - 建议只在 `tsconfig.json` 的 `paths` 中定义，`vite.config.ts` 通过 `tsconfigPaths()` 插件读取

### 中优先级

4. **删除 `jest.config.ts.bak`** — 备份文件不应留在项目根目录

5. **Playwright timeout 调整为 120s** (`playwright.config.ts:17`)
   - 60s 对于复杂 E2E 测试略短

6. **为 `providers.config.json` 添加文档注释**
   - 说明这是模板文件，以及如何使用

7. **移除 `window as any` 类型断言** (`SoundService.ts:87`)
   - 使用 `window.webkitAudioContext` 并加类型守卫

### 低优先级

8. **音量设置加边界日志** (`SoundService.ts:232`)
   - 当值被截断时 log 一下

9. **`jest.config.js` 改为 ESM** — 统一项目 module system

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | **B** | SoundService 实现良好；vite.config 有重复定义 |
| 安全 | **B+** | 无严重问题，生产部署需检查 proxy 配置 |
| 性能 | **A** | SoundService 资源管理正确，测试配置符合资源纪律 |
| 架构 | **B** | Alias 重复定义，Electron tsconfig include 手动维护 |
| 测试覆盖 | **C** | SoundService 和 root configs 均无测试 |
