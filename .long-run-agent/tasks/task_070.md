# task_070 electron: customAgent:create 判别联合在宽松 tsconfig 下收窄失败——修复构建断裂

## 描述

**P0**。`npm run build:electron` 当前断裂：

```
src/electron/main.ts(850,64): error TS2339: Property 'code' does not exist on type 'CustomAgentValidation'.
  Property 'code' does not exist on type '{ readonly ok: true; readonly draft: ValidCustomAgentDraft; }'.
```

根因（已最小复现验证）：`tsconfig.electron.json` 无 `strict`，宽松模式下 `if (!validation.ok)` 对判别联合（`{ok:true,draft} | {ok:false,code}`，src/core/custom-agent.ts:107）**不收窄**（严格模式下正常）。task_061 作者按严格模式直觉写了 `validation.code`，而 electron 构建用宽松配置 → 只有 electron 构建炸。

连锁影响：tsc 失败 → `&&` 短路 → tsc-alias/fix-require/bundle 没跑，且 `noEmitOnError:false` 已把未经后处理的产物写进 dist/electron → **dist 当前是坏的**。另外 dist 的旧版本（10/25 16:20）缺 task_050/051/054/056/061 的全部 main/preload 面（528 行），用户一直跑在缺这些 IPC 的老构建上（成长看板「未接上」、活跃度聚合失败 warn 都源于此）。

## 需求（requirements）

1. 修 `src/electron/main.ts` 第 850 行：改成宽松模式可靠写法——
   ```ts
   if (!validation.ok) {
     const code = (validation as { readonly ok: false; readonly code: CustomAgentValidationCode }).code;
     return { ok: false, code };
   }
   ```
   （或等价的 `Extract<CustomAgentValidation, { ok: false }>` 类型断言；保持语义不变，注释一句为什么：宽松 tsconfig 下判别联合不收窄）
2. grep electron 编译范围内的源码（src/electron、src/app/services/persistence 等被 tsconfig.electron.json include 的目录），找同款「`!x.ok` 后直接访问另一分支字段」的写法，有则同法修复（构建错误清单目前只有这一处，tsc 通过即证明没有别的）
3. 不开 strict（会引爆整个 electron/gateway 编译面，超范围）
4. 跑完整 `npm run build:electron`（tsc && tsc-alias && fix-require && bundle 全链），确认成功
5. 验证产物：`grep -c growthOverview dist/electron/electron/preload.js dist/electron/electron/main.js` 均大于 0

## 验收标准（acceptance）

- [ ] main.ts:850 宽松模式安全写法 + 注释
- [ ] `npm run build:electron` 全链成功（exit 0）
- [ ] dist 产物含 growthOverview（preload + main 各 ≥1 处）
- [ ] `npm run typecheck` 零错误（app 侧不回归）
- [ ] 最小改动原则

## 交付物

- `src/electron/main.ts` 修复 + 注释
- （如有）其他同款写法修复
- 可用的 dist/electron 全新构建

## 禁止事项

- 不给 tsconfig.electron.json 开 strict
- 不动判别联合类型定义（core 契约）
- 不动 task_061 的业务逻辑（只修类型访问方式）
- 不 mock 数据、不引入新依赖

## 验证方式

```bash
npm run build:electron && grep -c growthOverview dist/electron/electron/preload.js dist/electron/electron/main.js && npm run typecheck
```

## 验证证据（完成前必填）

- [ ] **实现证明**: 简要说明
- [ ] **测试验证**: 命令输出
- [ ] **影响范围**: 说明

### 测试步骤
1. npm run build:electron
2. grep -c growthOverview dist 产物
3. npm run typecheck

### 验证结果
<!-- 粘贴输出 -->
