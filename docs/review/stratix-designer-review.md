# stratix-designer Review

## 概览

| 文件 | 职责 |
|------|------|
| `StratixHeroDesigner.ts` | 核心设计器类 |
| `templates/` | 3 个预设模板（Writer/Dev/Analyst） |
| `utils/ConfigValidator.ts` | 配置校验 |
| `utils/ConfigConverter.ts` | 格式转换（Stratix ↔ OpenClaw） |
| `components/` | Vue 组件（HeroForm, ModelConfig, SoulEditor, MemoryEditor, SkillEditor） |
| `styles/design-tokens.ts` | 设计 token |

**测试**: 无测试文件。

---

## 代码质量

### StratixHeroDesigner

**优点**:
- 清晰的职责分离（template/create/save/load/delete/export）
- Callback-based 依赖注入（`onSaveConfig`, `onLoadConfig`, `onDeleteConfig`）
- 配置变更事件发布到 EventBus

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `emitConfigDeleted` 事件类型错误 | L226 | `eventType: 'stratix:config_updated'` — 应该是 `stratix:config_deleted` |
| `downloadHeroConfig` `globalThis as any` | L168 | 绕过类型检查，访问 `document` 前没有正确类型检查 |
| `loadHeroConfig` 返回 `null` 但调用方未处理 | L105 | `return null` — 但调用方通常假设返回 `StratixAgentConfig` |
| `requestId` 生成无序 | L62, L82, L129, L219, L232 | 每次用 `Date.now()` 生成 requestId，但没有确保唯一性 |
| `createNewHero` switch 无 default 时默认 writer | L47-49 | `default: template = new WriterHeroTemplate().getTemplate()` — 未知类型默认 writer，可能掩盖错误 |

### Templates

**优点**:
- 完整的静态模板定义
- 使用 `generateAgentId()` 和 `generateSkillId()` 生成唯一 ID
- `skills` 包含 `prompt` 字段作为 template literal

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `generateAgentId` ID 碰撞风险 | `templates/types.ts:12-14` | `stratix-${Date.now()}-${Math.random()...}` — Date.now() 毫秒级，快速连续调用可能碰撞 |
| 三个模板的 `stratixConfig.model` 相同 | L38 (Writer/Dev/Analyst) | 都用 `'gpt-4'`，但 analyst 实际可能需要不同模型 |
| Template hardcoded `'gpt-4'` | Writer:38, Dev:38, Analyst:38 | 模板使用 `gpt-4` 但 `stratixConfig.provider` 是 `openai`，版本不明确 |
| `profile.bodyType` 硬编码 `'male'` | L32 | 不支持非二元性别选择 |

### ConfigValidator

**优点**:
- 结构化的错误收集（`ValidationError[]`）
- Backend-type-specific 验证逻辑

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `validateAgentId` 只检查前缀 | L89-94 | 只检查 `startsWith('stratix-')`，不验证后续字符是否合法 |
| 错误时仍返回 `valid: true` | L116-119, L145-149 | `if (errors.length > 0) return { valid: false ... }` 但之前已经有 early return 检查 |
| Skills 验证不检查 `prompt` 字段 | L122-150 | `validateSkills` 只验证 `skillId` 和 `name`，不验证 `prompt` 格式 |
| 没有单元测试 | — | ConfigValidator 应该有测试 |

### ConfigConverter

**优点**:
- 双向转换（`toOpenClawFormat` / `fromOpenClawFormat`）
- JSON 序列化/反序列化
- Config merge 支持

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `fromJson` JSON.parse 无 try-catch | L90 | `JSON.parse(json)` — 如果 json 无效会 throw |
| `toOpenClawFormat` 硬编码 model | L44 | `model: 'gpt-4'` — 忽略 `config.stratixConfig.model`，总是返回 `'gpt-4'` |
| `mergeConfigs` 的 `skills` 覆盖而非合并 | L147 | `result.skills = override.skills !== undefined ? override.skills : base.skills` — 不支持追加 |
| `applyDefaults` 嵌套对象浅拷贝 | L212-235 | `profile: raw.profile || {...}` — 如果只有部分更新可能丢失嵌套属性 |
| `fromOpenClawFormat` 不转换 skills | L51-83 | `skills: baseConfig.skills || []` — 不从 OpenClaw tools 转换回 skills |

### Utils (design-tokens.ts, index.ts)

| 问题 | 说明 |
|------|------|
| `index.ts` 导出 `ConfigValidator` 和 `ConfigConverter` | 但这两个类实际上在 `utils/` 子目录 |
| `styles/design-tokens.ts` | 需要确认是否有实际内容（未读取到） |

---

## 安全

### 潜在风险

| 风险 | 位置 | 说明 |
|------|------|------|
| JSON import 无验证 | `ConfigConverter.fromJson` | 导入的 JSON 直接作为 `StratixAgentConfig`，没有 schema 验证 |
| `ConfigConverter.toOpenClawFormat` 暴露 API key | L43 | `api_key: config.openClawConfig.apiKey` — 如果 config 被导出，API key 会泄露 |
| `downloadHeroConfig` 创建 DOM 元素直接操作 | L184-192 | 动态创建 `<a>` 标签下载文件，不涉及 XSS，但可能被滥用 |
| `StratixHeroDesigner` 接受外部 callback | L12-16 | `onSaveConfig` 等 callback 是外部传入的，不信任来源 |

### API Key 泄露风险

```typescript
// ConfigConverter.ts:43
api_key: config.openClawConfig.apiKey,
```

如果用户通过 UI 导出配置，API key 会以明文形式出现在 JSON 中。这是设计问题：如果 API key 存在配置中，导出时应该脱敏或拒绝导出。

---

## 性能

### StratixHeroDesigner

| 问题 | 说明 |
|------|------|
| `presetTemplates` 每次 constructor 重新创建 | L27-31 — 每个 `new StratixHeroDesigner()` 都创建 3 个新 template 实例 |
| `getPresetTemplates` 每次都 spread 复制 | L195-196 — `return [...this.presetTemplates]` — 每次返回新数组 |

### Templates

| 问题 | 说明 |
|------|------|
| `getTemplate()` 每次创建新对象 | L23-81 — 每次调用都创建新对象，无缓存 |
| `generateSkillId` 每次都创建新 ID | 没有复用已有 skill ID |

---

## 架构

### 模块边界

```
stratix-designer/
├── StratixHeroDesigner.ts    → 依赖 stratix-core, templates, utils
├── templates/               → 依赖 stratix-core (StratixAgentConfig)
├── utils/                   → 依赖 stratix-core
└── components/             → Vue 组件

被依赖方：
├── stores/agent.ts         → 导入 WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate
└── App.vue                 → 导入 useAgentStore
```

### 问题

| 问题 | 说明 |
|------|------|
| `StratixHeroDesigner` 是 class 而非 functional composable | 设计上更接近 Angular service而非 Vue 生态 |
| Templates 硬编码在代码中 | 如果要添加新模板需要修改代码，无法运行时扩展 |

### 事件发布问题

```typescript
// StratixHeroDesigner.ts:226 — emitConfigDeleted
eventType: 'stratix:config_updated',  // 应该是 'stratix:config_deleted'
```

这个 bug 会导致监听 `config_deleted` 事件的消费者收不到通知。

---

## 测试覆盖

**无任何测试文件** — `stratix-designer/` 下没有任何 `__tests__` 目录或 `.test.ts` 文件。

`ConfigValidator` 和 `ConfigConverter` 应该有单元测试，`StratixHeroDesigner` 应该有集成测试。

---

## 横向联动

### 依赖关系

| 模块 | 依赖 | 被依赖 |
|------|------|--------|
| `StratixHeroDesigner` | `stratix-core` (EventBus, StratixAgentConfig) | `stores/agent.ts` |
| Templates | `stratix-core` (StratixAgentConfig) | `stores/agent.ts`, `StratixHeroDesigner` |
| ConfigValidator/Converter | `stratix-core` (StratixAgentConfig) | `StratixHeroDesigner` |

### 模板导出点

```typescript
// stores/agent.ts:12
import { WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate, generateAgentId } from '@/stratix-designer';
```

`stratix-designer` 被 `stratix-core` 间接依赖（通过 stores），需要注意循环依赖风险。

---

## 改进建议

### 高优先级

1. **修复 `emitConfigDeleted` 事件类型** (`StratixHeroDesigner.ts:226`)
   ```typescript
   // 当前
   eventType: 'stratix:config_updated',
   // 应改为
   eventType: 'stratix:config_deleted',
   ```

2. **ConfigConverter.fromJson 添加 try-catch** (`ConfigConverter.ts:90`)
   ```typescript
   static fromJson(json: string): StratixAgentConfig {
     try {
       const parsed = JSON.parse(json);
       return this.applyDefaults(parsed);
     } catch (error) {
       throw new Error(`配置解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
     }
   }
   ```

3. **移除 `toOpenClawFormat` 的 API key** (`ConfigConverter.ts:43`)
   - API key 不应出现在导出/转换中
   - 或者添加脱敏选项

4. **添加单元测试**
   - `ConfigValidator` — 验证各种 validation case
   - `ConfigConverter` — 验证 to/from JSON、OpenClaw 转换
   - `StratixHeroDesigner` — 验证 create/save/load 流程

### 中优先级

5. **使用 `crypto.randomUUID()` 替代 `Date.now()`** (`templates/types.ts:12-14`)
   - 避免毫秒级碰撞风险

6. **模板 `getTemplate()` 结果缓存** (`templates/*.ts`)
   - 避免每次调用都创建新对象

7. **分离 `getPresetTemplates()` 为单例或缓存** (`StratixHeroDesigner.ts:27-31`)
   - 避免每个实例都重新创建

8. **添加 `skills` merge 策略选项** (`ConfigConverter.ts:147`)
   - 当前是覆盖而非追加，不支持渐进式 skill 添加

### 低优先级

9. **移除 `globalThis as any`** (`StratixHeroDesigner.ts:168`)
   - 定义类型接口替代 `document` 访问

10. **Template `stratixConfig.model` 差异化** (各模板)
    - Dev 模板用 `gpt-4o` 或 `claude-3.5-sonnet`
    - Analyst 模板可能需要支持 `gpt-4o` 等

11. **`profile.bodyType` 枚举扩展** (各模板)
    - 支持 `female`, `neutral` 等选项
