# task_072 hud: 拆除旧 agent-link 聊天抽屉死代码——聊天入口统一到角色抽屉

## 描述

背景：聊天抽屉有两代。第一代 `strat-chat-drawer`（task_012，src/hud/panels/chat-drawer.ts + panels/chat-catalog.ts）基于 agent-link 外部会话模型（外部 agent 建链后选会话聊）；第二代 `strat-character-chat-drawer`（task_034/035，src/hud/components/chat-drawer/）按角色组织、点单位自动开、已接通 CLI transport + 落库（071 修复后全链验证通过）。第一代从未通过（link.open 全 UI 无派发点、连接表 0 行、永远显示「暂无外部 agent 会话」+发送禁用），但没拆：main-screen.ts:365 还在往聊天槽挂它，顶栏「打开聊天」按钮开合的就是这个空壳（还会误导排查——10/29 排查聊天问题时被它带偏过一次）。

## 需求（requirements）

1. **拆除第一代抽屉**：
   - 删 `src/hud/panels/chat-drawer.ts`、`src/hud/panels/chat-catalog.ts`、`src/hud/__tests__/chat-drawer.test.ts`
   - main-screen.ts：删 import（:35）+ mountChatDrawer 调用（:365）+ 对应 unmount；删模板里 chatSlot 容器（:292 `[data-role="chat-drawer"]` div）及所有 chatSlot.hidden 开合逻辑（onChatClick 本地态 + subscribe 里的）
2. **「打开聊天」按钮改接角色抽屉**：
   - core 对 `ui.navigate screen:'chat'` 无任何可挂钩信号（runtime.ts:445 直接归位主屏），需要新桥：main-screen 的 onChatClick 改为 dispatch 一个冒泡 CustomEvent（如 `stratix:chat-open`，detail 可带当前选中单位的 characterId）——保持原有 `ui.navigate('chat')` dispatch 不动（core 记账归位语义不变）
   - main-entry.ts：hudRoot 上 addEventListener('stratix:chat-open') → `characterDrawer.open(detail?.characterId)`（open 无参会开抽屉不切上下文，组件已有该语义）
3. **不动 core**：agent-link 管理器、state.links/messages、link.open 命令面全部保留（未来外部 agent 接入的地基）；linkCounter 顶栏计数保留
4. 清理指向已删文件的陈旧注释（chat-history.ts / chat-service.ts 文件头提到 chat-catalog 的注释，指向的若是被删的 panels/chat-catalog.ts 则改为指向 components/chat-drawer/chat-catalog.ts）
5. 最小改动；typecheck + jest 全绿（删除旧测试后基线相应减少）

## 验收标准（acceptance）

- [ ] panels/chat-drawer.ts、panels/chat-catalog.ts、chat-drawer.test.ts 已删；全仓库无残留 import
- [ ] 顶栏「打开聊天」点击 → 角色抽屉打开（有单选角色则切到该角色上下文，无则空开）
- [ ] 点单位自动开抽屉行为不回归（handleState 选中逻辑不动）
- [ ] `npm run typecheck` 零错误；`npx jest --silent` 全绿
- [ ] core 零改动（git diff src/core 为空）

## 交付物

- 删除三个文件 + main-screen/main-entry 接线调整
- 新事件桥 + main-entry 监听

## 禁止事项

- 不动 src/core（agent-link 是未来地基，明确保留）
- 不动 components/chat-drawer/（新抽屉已验收）
- 不动 chat-service / 落库链路（071 刚修好）
- 不 mock 数据、不引入新依赖

## 验证方式

```bash
npm run typecheck && npx jest --silent && git diff --stat src/core | wc -l
```

## 验证证据（完成前必填）

- [x] **实现证明**: 删除第一代抽屉与旧测试；顶栏保留 `ui.navigate('chat')` 并冒泡 `stratix:chat-open`，组合根打开角色抽屉并传递单选角色上下文。
- [x] **测试验证**: `npm run typecheck && npx jest --silent` 通过；167 个套件全绿，3629 个测试通过、6 个跳过。
- [x] **影响范围**: 仅主屏聊天入口、组合根事件接线与对应测试；现役角色抽屉、聊天服务及 `src/core` 均未改动。

### 测试步骤
1. npm run typecheck && npx jest --silent
2. git diff --stat src/core 应为空
3. grep -rn "panels/chat-drawer" src/ 无结果

### 验证结果
```text
> stratix@0.1.0 typecheck
> tsc --noEmit

Test Suites: 167 passed, 167 total
Tests:       6 skipped, 3629 passed, 3635 total
Snapshots:   0 total
Time:        22.022 s
```

`git diff --stat src/core` 无输出；全仓库无指向已删文件的 import。字面路径仍存在于禁止改动的 core 历史注释及现役抽屉对比注释中，无运行时代码引用。
