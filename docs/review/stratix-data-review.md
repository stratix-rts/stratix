# stratix-data 模块评审报告

## 概览

**模块路径**: `src/stratix-data/`
**文件数量**: 1 个文件
**核心职责**: 静态数据文件，存储 140 个 Agent 模板定义（来自 agency-agents 仓库的导入数据）。

### 文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `agency-agents.json` | JSON 数据文件 | 140 个 Agent 的定义，包含 domain/name/description/soul/sections 等 |

---

## 代码质量

### 数据文件，非代码模块

- 本模块仅含一个 JSON 数据文件，无 TypeScript 代码。
- 数据在应用启动时由其他模块（如 `stratix-agent`）读取并解析使用。
- **无类型约束**：JSON Schema 未定义，消费者需自行断言类型。

### JSON 内容观察

- `generatedAt: "2026-04-19T06:56:06.407Z"` — 生成时间戳，理论上应随数据更新而更新，需确认导入脚本是否更新此字段。
- `\n` 转义符在 JSON 中大量存在（agent soul 内容中），这是合法的 JSON 转义，但部分位置（如 line 33-44 可见的 `\n`）格式混乱，内容中出现 `\\n` 和多余空行，可能影响 prompt 解析。
- `id` 字段使用 kebab-case（如 `"academic-anthropologist"`），但无正则校验。

### 无测试

- 无测试文件。

---

## 安全

### 静态数据注入风险

- JSON 中包含大量 `<script>` 风格的 Markdown 内容（`## 🚀 Advanced Capabilities` 等），若被直接渲染到 HTML 但未做 XSS 过滤，可能有存储型 XSS 风险。需确保消费方使用 `v-html` 或类似机制时做 HTML 转义。

### 无 Schema 验证

- 消费者读取后未验证 `agents[].soul`、`agents[].sections` 等字段结构，若字段缺失会导致运行时错误。

---

## 架构

### 依赖方向

```
stratix-data/agency-agents.json (静态数据)
  └── 被 stratix-agent 或 TemplateLibrary 模块消费
```

### 数据一致性

- `totalAgents: 140` 与 `agents` 数组长度需要人工保持一致，建议在导入脚本中自动计算。

---

## 改进建议（按优先级）

### P0 — 建议

1. **验证 JSON 完整性**
   - `totalAgents` 应由导入脚本自动计算，而非手动维护

2. **清理 agent soul 内容中的格式问题**
   - 多处 `\n` 和多余空行影响可读性，建议在导入时规范化

### P1 — 建议

3. **添加 JSON Schema**
   - 定义 `AgencyAgentsSchema`，在导入时或消费前验证数据结构

4. **检查 XSS 风险**
   - 若 agent content 会被渲染到 HTML，确认消费方做了 HTML 转义
