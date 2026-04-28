# Composables Review

## 概览

| Composable | 文件 | 职责 |
|------------|------|------|
| `useToast` | `useToast.ts` | 封装 ToastService，提供 toast 通知 API |
| `useChat` | `useChat.ts` | Chat 会话管理（历史加载、发送、重试） |
| `useKeyboardNav` | `useKeyboardNav.ts` | 键盘导航（方向键、Vim 模式、快捷键注册） |
| `usePerformanceMonitor` | `usePerformanceMonitor.ts` | 性能监控（render timing、event timing、memory） |
| `useCelebration` | `useCelebration.ts` | 庆祝动画（particle burst 效果） |
| `useSizeContext` | `useSizeContext.ts` | 代理 re-export `@/design-system/composables/useSizeContext` |
| `useSound` | `useSound.ts` | 封装 SoundService，提供响应式声音 API |
| `useModalState` | `useModalState.ts` | Modal 状态管理（全局 open count） |
| `useCommandPalette` | `useCommandPalette.ts` | 命令面板状态管理 |

**测试文件**:
- `__tests__/usePerformanceMonitor.test.ts` — 完整覆盖
- `__tests__/useKeyboardNav.test.ts` — 完整覆盖（纯函数 + 集成）
- `__tests__/useCelebration.test.ts` — 覆盖（但质量较低，详见下）

---

## 代码质量

### useToast

**优点**: 简洁，依赖外部 ToastService，职责清晰。

**问题**:
- 无明显问题，轻量封装。

### useChat

**优点**:
- 支持重试机制（`MAX_RETRIES = 2`）
- 支持消息历史分页加载
- `onMessageRender` callback 支持自定义渲染
- IME composition 支持（`handleCompositionStart/End`）

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `SkillExecution.result` 类型 `any` | L13 | `result?: any` — 应使用具体类型 |
| `config: any` 传入 | L36 | `config: any` — 应使用具体类型 |
| `loadApiKey` 调用无错误处理 | L181-185 | `loadApiKey` 失败时静默继续，没有 apiKey 的请求可能失败 |
| Temp message ID 碰撞风险 | L161 | `temp-${Date.now()}-${Math.random()...}` — Date.now() 毫秒级，快速连续发送可能碰撞 |
| 错误信息直接显示 | L295 | `error instanceof Error ? error.message : '发送失败'` — 用户可见，但 error.message 可能包含内部信息 |

```typescript
// L181-185: loadApiKey 失败后没有 apiKey，请求仍会发送
const apiKeyResult = await loadApiKey(chatConfig.provider);
if (apiKeyResult.success && apiKeyResult.data) {
  chatConfig.apiKey = apiKeyResult.data;
}
// 如果 success=false，chatConfig.apiKey 仍是 undefined，但代码继续执行
```

### useKeyboardNav

**优点**:
- 纯函数（`parseShortcut`、`matchesShortcut`、`getNextIndex`、`getSpatialNextIndex`）与框架无关，可独立测试
- 详细的 JSDoc
- 全局快捷键注册表（module-level `globalShortcuts` Map）
- Vim 模式支持（j/k 导航）
- 正确的清理机制（`onUnmounted` 时 unregister shortcuts）

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `matchesShortcut` 对 `cmd` 的处理不完整 | L95-97 | `mod === 'cmd' && !isMac` 时检查 `eventModifiers.has('meta')`，但 Mac 上 `cmd` 应该对应 `metaKey`，逻辑略显混乱 |
| `handleGlobalKeydown` 中直接操作 `event` | L302-368 | 全局 keydown handler 在 `isModalMode.value` 时的 Tab 处理不完整（只有 `return`，没有实际 trap） |
| `focusElement` 直接操作 DOM class | L402-413 | 直接 `element.classList.add/remove`，可能与 Vue 的 scope id 冲突 |
| `getSpatialNextIndex` 边界 case | L206-207 | `right` 方向如果 `currentRowItems - 1` 为 0，会从 0 开始下一行 |

### usePerformanceMonitor

**优点**:
- `metrics` 数组有 100 条上限，防止内存泄漏
- `slowHandlers` 有 10 条上限
- `trackAsync` 正确处理 Promise
- `onUnmounted` 正确清理 `memoryInterval`

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `getMemory` 类型断言 | L100-106 | `performance as unknown as {...}` — 使用 `unknown` 而非直接 `as any`，相对安全 |
| `memoryData` 没有上限 | `startMemoryTracking` 持续更新 | 如果不调用 `stopMemoryTracking`，会持续更新但 ref 本身不会无限增长 |

### useCelebration

**优点**:
- Particle 物理模拟完整（gravity、wind、friction）
- 多种 particle 形状支持
- 正确的 `cancelAnimationFrame` 清理

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `celebrationCanvas` ref 暴露但未绑定 | L269 | `celebrationCanvas` 需要使用者自己绑定到 canvas 元素，不是自动的 |
| `resizeCanvas` 监听 window resize 事件缺失 | L212-217 | 只在 `celebrate()` 时调用一次，之后 window resize 不会更新 canvas 尺寸 |
| `particles` 是闭包变量，不是 ref | L81 | `let particles: Particle[] = []` — 直接操作数组，不是响应式的 |
| setInterval + setTimeout 混用 | L242-249, L256-258 | burst timer 和 auto-cleanup timer 两个 timer，需要都清理 |

### useSound

**优点**:
- 简洁，响应式包装 `soundService`

**问题**:
- 无明显问题。

### useModalState

**优点**:
- 极其简洁

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `rtsEventBus.emit` 使用 `as any` | L12, L20 | `rtsEventBus.emit('vue:modal:state_changed' as any, ...)` — 事件名字符串需要 cast |
| `openModalCount` 是 module-level 全局状态 | L5 | 多个组件实例共享同一个计数器，但如果组件销毁时没有 `closeModal` 调用，计数会不准确 |

### useCommandPalette

**优点**:
- Fuzzy matching 实现简洁有效
- 快捷键 `Ctrl/Cmd+K` 触发

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| Module-level 全局状态 | L11-14 | `isOpen`, `query`, `selectedIndex` 是 module-level ref，所有组件实例共享 |
| `COMMANDS_REGISTRY` 是 module-level 常量 | L16-29 | 13 个固定命令，但 `action: () => {}` 是空函数，真实 action 需要后续注册 |
| 快捷键 `G Z`（goto zones）等未实现 | L17-20 | `action: () => {}` 是空实现 |
| `filteredCommands` 依赖 module-level `query` | L42-45 | `query` 是 module-level ref，多个组件实例会互相干扰 |

---

## 安全

### 潜在风险

| 风险 | 文件 | 说明 |
|------|------|------|
| useChat 消息内容未消毒 | `useChat.ts` | `renderMarkdown` 处理内容，但后续 `replace(/<[^>]*>/g, '')` 直接 strip HTML |
| useChat API Key 获取 | `useChat.ts:181-185` | `loadApiKey` 可能返回空，但请求仍发送，可能导致敏感信息泄露到错误日志 |
| useCommandPalette module-level 状态 | `useCommandPalette.ts` | 全局共享状态可能导致不同组件间状态污染 |

### XSS 风险分析

**useChat**: L125 `renderMarkdown(msg.content)` — 如果使用 `marked` 库，默认不 sanitize HTML。需确认 `MarkdownRenderer` 是否做了 XSS 防护。

**useCelebration**: 无用户输入，不存在 XSS 风险。

---

## 性能

### useChat

| 问题 | 说明 |
|------|------|
| 消息历史每次 `loadHistory` 都创建新 Set | L117-119 — 可以复用已有的 `loadedMessageIds` |
| `messages.value.map(...)` 创建新数组再 `filter` | L213-218 — 可以合并为一个 pass |
| `renderMarkdown` 每次都调用 | L125, L279 — 如果内容未变化，不需要重复渲染 |

### useCelebration

| 问题 | 说明 |
|------|------|
| `requestAnimationFrame` 没有暂停机制 | 页面 background 时仍会运行动画，浪费 CPU |
| 150 个 particle 每帧绘制 | `PARTICLE_COUNT = 150`，复杂场景可能掉帧 |

### useCommandPalette

| 问题 | 说明 |
|------|------|
| 每个 keydown 遍历所有 `globalShortcuts` | L304-310 — 快捷键数量少时不是问题，但随着注册增多会变慢 |
| Fuzzy match 无缓存 | L31-38 — 每次 query 改变都重新计算 |

### usePerformanceMonitor

| 问题 | 说明 |
|------|------|
| `metrics` 数组 shift 操作 | L94 — `metrics.value.shift()` 是 O(n) 操作，频繁 shift 不是好选择 |
| Memory tracking 无上限 | L115-119 — `memoryData` 是单个值，不是数组，但持续更新可能不需要 |

---

## 架构

### 模块边界

```
composables/
├── useToast.ts        → 依赖 @/components/ui/ToastService
├── useChat.ts         → 依赖 @/stratix-character-creator/config/providerConfig, @/stratix-core/utils/MarkdownRenderer
├── useKeyboardNav.ts  → 无外部依赖（纯键盘逻辑）
├── usePerformanceMonitor.ts → 无外部依赖
├── useCelebration.ts  → 无外部依赖
├── useSizeContext.ts  → 代理 @/design-system/composables/useSizeContext
├── useSound.ts        → 依赖 @/services/SoundService
├── useModalState.ts   → 依赖 @/stratix-rts/events/core/RTSEventBus
└── useCommandPalette.ts → 无外部依赖
```

### 主要架构问题

| 问题 | 说明 |
|------|------|
| `useCommandPalette` 和 `useModalState` 的 module-level 全局状态 | 违反 React/Vue hooks 最佳实践，多实例会互相干扰 |
| `useSizeContext` 是纯代理，无实际实现 | 职责分离良好，但需要确认设计意图 |

### Module-level 全局状态反模式

```typescript
// useCommandPalette.ts
const isOpen = ref(false)      // module-level，全局共享
const query = ref('')           // module-level，全局共享
const selectedIndex = ref(0)    // module-level，全局共享

// useModalState.ts
const openModalCount = ref(0)   // module-level，全局共享
```

这意味着如果两个组件同时使用这些 composable，它们的状态会相互覆盖。应改为：

```typescript
export function useCommandPalette() {
  const isOpen = ref(false)   // 每个组件实例独立
  const query = ref('')
  // ...
}
```

---

## 测试覆盖

### 覆盖情况

| Composable | 测试文件 | 覆盖 |
|------------|---------|------|
| `usePerformanceMonitor` | `__tests__/usePerformanceMonitor.test.ts` | **完整** |
| `useKeyboardNav` | `__tests__/useKeyboardNav.test.ts` | **完整**（纯函数 + 集成） |
| `useCelebration` | `__tests__/useCelebration.test.ts` | **低质量**（见下） |
| `useToast` | 无 | 缺失 |
| `useChat` | 无 | 缺失 |
| `useSound` | 无 | 缺失 |
| `useModalState` | 无 | 缺失 |
| `useCommandPalette` | 无 | 缺失 |

### useCelebration.test.ts 质量问题

该测试文件**不是真正的单元测试**，存在以下问题：

| 问题 | 位置 | 说明 |
|------|------|------|
| 测试的是常量而非实际行为 | L85-96 | `shapes.forEach(shape => { expect(['circle', 'rectangle', 'triangle']).toContain(shape) })` — 永远通过 |
| 测试物理常量的值而非粒子行为 | L130-180 | 测试 `GRAVITY === 0.15`，`WIND === 0.02` 等，而不是测试 `createParticle` 返回的粒子属性 |
| `expect().toBe()` 硬编码预期值 | L169-179 | 测试 `x + vx === 105`，这不是测试"代码做了什么"而是"数学计算正确" |
| 没有测试 `celebrate()` 的实际效果 | L186-196 | `jest.advanceTimersByTime(3000)` 后没有断言 `stopAnimation` 是否被调用 |
| Mock 太复杂 | L41-46 | 创建了 mockCtx 但几乎没用 |

---

## 横向联动

### 依赖关系

| Composable | 导入 | 被使用 |
|------------|------|--------|
| `useToast` | `ToastService` | 多个 Vue 组件 |
| `useChat` | `loadApiKey`, `renderMarkdown` | `AgentChatModal.vue` |
| `useKeyboardNav` | 无 | 多个需要键盘导航的组件 |
| `usePerformanceMonitor` | 无 | 开发/调试用途 |
| `useCelebration` | 无 | Task complete 庆祝效果 |
| `useSound` | `SoundService` | 需要声音的组件 |
| `useModalState` | `RTSEventBus` | Modal 组件 |
| `useCommandPalette` | 无 | Command palette UI |

---

## 改进建议

### 高优先级

1. **修复 useCommandPalette module-level 全局状态** (`useCommandPalette.ts:11-14`, `useCommandPalette.ts:42`)
   - 将 `isOpen`, `query`, `selectedIndex` 移入函数内部
   - `filteredCommands` 需要一个 factory 函数接受 `queryRef`

2. **修复 useModalState module-level 全局状态** (`useModalState.ts:5`)
   - `openModalCount` 是全局的，多组件实例会有问题
   - 如果需要全局 modal 计数，应该用 Pinia store

3. **useChat 添加 loadApiKey 错误处理** (`useChat.ts:181-185`)
   - 如果 `loadApiKey` 失败，应该 `throw` 或 `return`，不应该静默继续

4. **useCelebration 添加 window resize 监听** (`useCelebration.ts:212-217`)
   - 在 `onMounted` 中监听 `window.resize`，更新 canvas 尺寸

5. **useCelebration 测试重写**
   - 测试应验证实际行为（particle 数量、canvas 内容），而非测试常量值

### 中优先级

6. **useChat 的 temp message ID 改进** (`useChat.ts:161`)
   - 使用 `crypto.randomUUID()` 代替 `Date.now() + Math.random()`

7. **useKeyboardNav focusElement 使用 Vue refs** (`useKeyboardNav.ts:402-413`)
   - 避免直接操作 DOM class，改用 Vue 的 `ref` 和 `:class` binding

8. **useChat 合并 messages.map + filter** (`useChat.ts:213-218`)
   - 一次 pass 完成，而非先 map 再 filter

9. **usePerformanceMonitor metrics 用环形缓冲区** (`usePerformanceMonitor.ts:94`)
   - `shift()` 是 O(n)，改用索引循环或 `slice(-100)` 复制

### 低优先级

10. **useChat `SkillExecution.result` 类型具体化** (`useChat.ts:13`)
    - `result?: any` → 具体 interface

11. **useKeyboardNav `cmd` modifier 处理清理** (`useKeyboardNav.ts:95-97`)
    - Mac/Windows modifier 逻辑注释说明

12. **useCommandPalette 快捷键 action 实现** (`useCommandPalette.ts:17-28`)
    - 当前 `action: () => {}` 是空实现，需要真实 action 或从外部注入
