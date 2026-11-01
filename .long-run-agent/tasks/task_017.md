# task_017

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_017.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3退役: legacy删除与死代码清理-模块

## requirements

对已锁定的 legacy Vue 层删除面（约 737 文件）做机械收尾：

1. `npm run typecheck` 绿 —— 逐个修掉报错，只修报错处，最小改动；报错指向保留模块时，
   清掉它对已删文件的引用 / 死代码。
2. typecheck 绿后跑 `npm run build` 与 `npx jest --silent`，同理修复。
3. 全绿后记账并提交（`git add -A` + commit，含完整删除面）。

边界：不删任何新文件/新目录；不做依赖图分析；不评估回退开关；需要业务决策才能修的报错原样列出留 task_018，不绕过不 mock。

## acceptance

- [ ] `npm run typecheck` 退出码 0
- [ ] `npm run build` 成功
- [ ] `npx jest --silent` 全绿（或列明不可修项并说明原因）
- [ ] commit 完成且包含完整删除面

## 交付物

- 干净的 typecheck / build / test 三绿
- `v3(task_017): legacy 删除与死代码清理` 提交

## 验证证据（完成前必填）

- [x] **实现证明**: 第三次尝试接手时删除面已落地且三项验证本已全绿（tsc/tsc:app/tsc:tests 均 EXIT=0，
      vite build ✓ built in 1m 58s，jest 90 suites / 2141 passed / 6 skipped / 0 failed），故无报错可修，
      本轮只做记账与提交。
- [x] **测试验证**: 见下方「验证结果」，三条命令原始尾行。
- [x] **影响范围**: 旧入口链（Zone / stratix-project / Vue 战场场景）退役；`STRATIX_LEGACY` 回退开关
      已下线（仅保留常量用于提示用户残留环境变量，回退手段 = git 历史）。

### 测试步骤

1. `source ~/.nvm/nvm.sh && nvm use 23 && npm run typecheck`
2. `npm run build`
3. `npx jest --silent`

### 验证结果

```
> stratix@0.1.0 typecheck
> tsc --noEmit
EXIT=0

> stratix@0.1.0 build:frontend
> vite v7.3.1 building client environment for production...
✓ built in 1m 58s

Test Suites: 90 passed, 90 total
Tests:       6 skipped, 2141 passed, 2147 total
Snapshots:   0 total
Time:        22.283 s
```

附加：`npm run typecheck:app` EXIT=0、`npm run typecheck:tests` EXIT=0。