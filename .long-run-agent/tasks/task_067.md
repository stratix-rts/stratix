# task_067 dev: HMR 半更新防护——app 代码改动触发整页 reload

## 描述

用户 dev 实例跑 31 小时跨 3 个提交，vite HMR 把新模块热推进旧装配的活页面，产生半新半旧的混血状态（旧自定义元素实例 + 新事件常量/新装配闭包），出现不可复现的交互报错（快捷键弹窗关闭钮报错等，全新实例零错误——已用 Playwright 全量交互扫描对照验证）。本仓库是 Web Components + 组合根装配架构，HMR 对这类代码天然不安全：自定义元素已定义则实例不重建、main-entry 组合根闭包持有旧模块引用。

## 需求（requirements）

1. `vite.config.ts` 实现指定目录变更强制 full-reload：`src/app/**`、`src/hud/**`、`src/core/**`、`src/world/**` 模块更新时走整页刷新（vite 插件 `handleHotUpdate` 里 `server.ws.send({ type: 'full-reload' })` 或等价机制），**不**做局部 HMR
2. 配置处加注释说明动机（WC + 组合根装配对 HMR 不安全；长跑 dev 实例吃跨提交热更会产生混血状态）
3. 构建行为不受影响（`npm run build:frontend` 正常）；不引入新依赖；不动业务代码
4. 验证方法：临时往 `src/hud/` 某文件加一行注释保存，确认 vite 日志/行为是 full reload 而非 HMR patch（Electron 页面整页刷新）；验证后还原临时改动

## 验收标准（acceptance）

- [ ] vite.config.ts 对四大目录变更触发 full-reload，注释说明动机
- [ ] 临时改动验证 reload 生效后已还原（git status 干净或只剩 vite.config.ts 改动）
- [ ] `npm run typecheck` 零错误
- [ ] `npm run build:frontend` 成功
- [ ] 不引入新依赖

## 禁止事项

- 不引入新依赖
- 不动 src/ 业务代码
- 不改构建产物行为

## 交付物

- `vite.config.ts`：四大目录（src/app、src/hud、src/core、src/world）变更强制 full-reload 的配置/插件 + 动机注释

## 验证方式

```bash
npm run typecheck && npm run build:frontend
# 手动：touch src/hud 内文件 → 观察 vite full-reload
```

## 验证证据（完成前必填）

- [ ] **实现证明**: 简要说明如何实现
- [ ] **测试验证**: 如何验证功能正常（测试步骤/命令输出）
- [ ] **影响范围**: 是否影响其他功能

### 测试步骤
1. npm run typecheck
2. npm run build:frontend
3. 临时改动 src/hud 文件 → 观察 full-reload → 还原

### 验证结果
<!-- 粘贴命令输出或测试结果 -->
