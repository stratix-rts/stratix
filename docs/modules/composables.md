# composables 模块

> 分析时间：2026-04-28 21:12
> 文件数：12 | 代码行数：2459 | 文档覆盖：25%

## 概述

（待补充模块概述）

## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `useToast` | `` | - |
| `show` | `options: ToastOptions` | - |
| `success` | `title: string, message?: string` | - |
| `error` | `title: string, message?: string` | - |
| `warning` | `title: string, message?: string` | - |
| `info` | `title: string, message?: string` | - |
| `dismiss` | `id: string` | - |
| `dismissAll` | `` | - |
| `useChat` | `options: UseChatOptions` | - |
| `updateMessageStatus` | `` | - |

## 依赖关系

### 本模块依赖

- ../useCelebration
- ../usePerformanceMonitor
- vue
- @/services/SoundService
- @/stratix-rts/events/core/RTSEventBus
- @/components/ui/ToastService
- @/stratix-core/utils/MarkdownRenderer
- @jest/globals
- @/stratix-character-creator/config/providerConfig

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释