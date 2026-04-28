# 代码修复验收文档 - XSS 问题跳过记录

**生成日期**: 2026-04-26
**跳过原因**: UI 变更需人工确认，暂缓处理

---

## 跳过的问题清单

### 1. stratix-character-creator (安全评级 C+)

| 严重性 | 位置 | 问题描述 |
|--------|------|---------|
| 高 | `CharacterPreview.vue` / `CharacterViewer.vue` | `v-html` 插值未转义，用户生成内容（如 agent 描述）可能包含恶意 HTML/JS |
| 高 | `CharacterList.vue` | 同上，列表渲染 |
| 高 | 模板多处 | 复用上述组件的页面均受影响 |

**影响范围**: 所有使用 `v-html` 渲染动态内容的 Vue 组件
**建议修复**: 替换为 `v-text` 或对内容做 HTML 转义后用 `v-html`

---

### 2. stratix-gateway (安全评级 B-)

| 严重性 | 位置 | 问题描述 |
|--------|------|---------|
| 中 | `UrlFetchAdapter.ts` | URL 抓取无白名单限制，可能被利用做 SSRF 攻击 |

**建议修复**: 依赖 review 已设置 `allowedUrlPatterns`，需确认配置是否符合预期

---

### 3. stratix-nocodb

| 严重性 | 位置 | 问题描述 |
|--------|------|---------|
| 中 | `NocoDBViewer.vue` | iframe 未设置 `sandbox` 属性 |

**备注**: review 提到已修复，需人工验证

---

### 4. stratix-data

| 严重性 | 位置 | 问题描述 |
|--------|------|---------|
| 低 | `agency-agents.json` | 如果 agent content 被渲染为 HTML，可能 XSS |

**说明**: 数据文件本身无害，取决于消费端如何渲染

---

### 5. stores

| 严重性 | 位置 | 问题描述 |
|--------|------|---------|
| 低 | `systemzone.ts` | `apiFetch` 使用 `any` 类型，信息泄漏风险低但类型不安全 |

---

## 未跳过的 P0/P1/P2 修复汇总

详见各模块 commit，核心 P0 修复包括：

- **stratix-agent**: 动态 require → 顶层 import，Session 消息上限警告
- **stratix-orchestration**: Anthropic API 格式修复，权限检查补充
- **stratix-task-executor**: 路径 bug 修复，并发收集结果
- **stratix-openclaw-adapter**: unsubscribe 内存泄漏修复，isConnected 逻辑修复
- **stratix-gateway**: JSON body limit 50mb → 5mb，URL 抓取白名单
- **stratix-core**: ServiceLocator 懒加载，StratixEventBus MAX_BUFFER_SIZE=100
- **stratix-database**: Schema 版本控制，类型提升
- **stratix-nocodb**: JWT secret env var，shell command 修复，iframe sandbox
- **stratix-project**: Zone 创建重试 + 指数退避，LowDB 写队列
- **stratix-rts**: RTSEventBus null → undefined，事件常量类型化
- **stratix-blueprint**: LayoutEngine 循环检测修复
- **stratix-tailscale**: 类型重复消除，JSON.parse 异常处理
- **stratix-character-creator**: 图片缓存 LRU 上限
- **stratix-designer**: API Key 明文暴露修复

---

## 待处理项

1. **stratix-character-creator XSS**: 所有 `v-html` 渲染动态内容需转为安全写法
2. **stratix-nocodb iframe sandbox**: 验证是否已正确配置
3. **CircuitBreaker 状态持久化**: stratix-systemzone 设计决策，暂未实现
4. **Agent First 模块边界重构**: 部分大模块（agent 1100+ 行、rts 1500+ 行）仍需拆分
