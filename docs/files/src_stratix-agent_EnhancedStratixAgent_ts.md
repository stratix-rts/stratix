# src/stratix-agent/EnhancedStratixAgent.ts

> 语言：typescript | 代码行数：761

## 概述

/**
 * 增强的 StratixAgent
 * 支持工作流执行、反思机制、多步骤规划
 *
 * 架构：EnhancedStratixAgent 作为协调/入口，核心逻辑委托给：
 * - WorkflowExecutor      工作流执行逻辑
 * - ReflectionManager     反思和自校正
 * - EvolutionManager      Agent 进化（soul/template 迭代）
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `EnhancedStratixAgent` | 0 | - |

## 依赖

- ../stratix-orchestration/task-queue/TaskQueueService
- ./StratixAgent
- ./core/EnhancedPromptBuilder
- ./core/WorkflowExecutor
- ./core/ReflectionManager
- ./core/EvolutionManager
- ./mixins/MixinComposer
- ./runtime/SessionRuntime
- ./runtime/types
- ./types
- ./types/soul
- ./types/template
