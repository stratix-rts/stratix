# task_066 core: camera.moved 事件接地——消除未处理 warn 噪音

## 描述

src/core/runtime.ts 世界事件 switch 的 default 分支维护着一份显式接地清单：`unit.position` / `camera.center` / `exp.gained` / `level.up` / `task.*` / `pipeline.*` / `unit.speaking` 都显式 return（不进 reportUnhandled），**唯独漏了 `camera.moved`**。它由 world 场景在镜头移动/钳制后发出，消费者在 app 层（main-entry 的 minimap 视口同步订阅），core 状态机不消费——按同批惯例应显式接地。现状：每次镜头移动 console 刷一条 `[Stratix] 未处理 world: camera.moved`，淹真故障。

## 需求（requirements）

1. `src/core/runtime.ts` default 分支给 `camera.moved` 加接地 return，注释与 `camera.center` 的接地注释同风格（说明消费方在 app 层 minimap 视口同步，core 不消费）
2. 补单测：断言 camera.moved 事件不触发 onUnhandled——core 的 runtime 测试文件里已有其它接地事件（unit.position / camera.center / task.* 等）的同款用例，找到照抄口径加一条
3. 只动 `src/core/runtime.ts` + 对应测试文件

## 验收标准（acceptance）

- [ ] `camera.moved` 在 runtime.ts 显式接地，注释说明消费方在 app 层
- [ ] 新增/修改的单测覆盖「camera.moved 不进 onUnhandled」
- [ ] `npm run typecheck` 零错误
- [ ] `npx jest --silent` 全绿（3656 基线不回归）
- [ ] 最小改动：只动 runtime.ts 和对应测试文件

## 禁止事项

- 不动 WorldState 契约、不加相机字段
- 不重构 switch 结构、不改其他事件的行为
- 不 mock 数据、不引入新依赖

## 交付物

- `src/core/runtime.ts`：camera.moved 接地 return + 注释
- 对应 runtime 测试文件：新增 camera.moved 不进 onUnhandled 的用例

## 验证方式

```bash
npm run typecheck && npx jest --silent
```

## 验证证据（完成前必填）

- [ ] **实现证明**: 简要说明如何实现
- [ ] **测试验证**: 如何验证功能正常（测试步骤/命令输出）
- [ ] **影响范围**: 是否影响其他功能

### 测试步骤
1. npm run typecheck
2. npx jest --silent
3. grep 确认 default 分支含 camera.moved 接地行

### 验证结果
<!-- 粘贴命令输出或测试结果 -->
