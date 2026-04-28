# task_004

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_004.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物位置**: 请在 `src/`、`tests/` 或适当位置创建代码文件

**这是配置文件**，不是最终产出！

## 概述

GWV-1: GatewayEventBus添加zone:created事件

## 技术栈

TypeScript, GatewayEventBus, EventEmitter

## requirements

在 GatewayEventBus 的 ZoneEvent 类型中添加 `zone:created` 事件类型，并确保 publishZoneEvent 方法支持发布此事件。

## 输入输出

### 输入
```
zoneId: string
projectId: string
data?: { title: string; prompt: string; creator?: string }
```

### 输出
无返回值，事件发布到 EventEmitter

## 实现方案

1. 在 `src/stratix-gateway/GatewayEventBus.ts` 中：
   - 在 ZoneEvent 接口的 type 定义中添加 `'zone:created'`
   - 确保 publishZoneEvent 方法能正确处理新事件类型（已有泛型实现，应该无需修改）

## 测试用例
- 验证 ZoneEvent 类型包含 'zone:created'
- 验证可以发布和监听 zone:created 事件

## acceptance

- [x] ZoneEvent 接口 type 包含 'zone:created'
- [x] publishZoneEvent 方法支持发布 zone:created 事件
- [x] 类型检查通过

## deliverables

- src/stratix-gateway/GatewayEventBus.ts (修改)

## 验证证据（完成前必填）

- [x] **代码实现**: ZoneEvent 类型已包含 zone:created
- [x] **测试通过**: tsc --noEmit 通过
- [x] **无语法错误**: 类型检查无错误
- [x] **回归测试**: 其他事件类型未受影响

### 测试命令
```bash
npx tsc --noEmit
```

### 测试输出
```
# 类型检查通过，无错误
```

### 代码片段
```typescript
// src/stratix-gateway/GatewayEventBus.ts
export interface ZoneEvent {
  type: 'zone:created' | 'zone:updated' | 'zone:deleted' | ...;
  zoneId: string;
  projectId: string;
  data?: Record<string, unknown>;
}
```
