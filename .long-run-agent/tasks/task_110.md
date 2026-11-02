# task_074 app: 聊天历史分页加载（getEvents 切片语义）——抽屉滚动到顶加载更早历史

## 描述

对齐 Anthropic Engineering《Scaling Managed Agents》（2026-04）的 getEvents 位置切片理念：session log 可按位置翻阅（rewind / reread）。现状 chat-drawer.ts 文件头注释明说「更早历史的触发器留给后续任务（DAO 的 LIMIT 窗口语义已就位）」——本任务补这个触发器。

⚠️ 依赖 task_072（旧抽屉拆除）先完成，避免同区域合并冲突。

## Requirements

1. DAO 层：`chat-history-dao.ts` 新增 beforeId 游标查询——按 id 自增序（写入序）取「id < beforeId 的最近 limit 条」，返回时间正序；与现有 loadMessages 共用 SQL 骨架。
2. preload/gameSave 层：暴露 `loadEarlierMessages(characterId, beforeId, limit)`（命名与 preload.ts 现有 chatHistory 面方法风格一致，先看 preload 再定名）。
3. chat-service/drawer 桥：抽屉滚动到顶（scrollTop === 0 且已有历史满页时）触发加载更早一页；新页 prepend 到消息列表，滚动位置不跳（锚定加载前首条消息元素，加载后 scrollTo 其 offsetTop）。
4. 到底判定：返回条数 < limit 时标记「没有更早了」，顶部显示轻量提示行（复用现有 CSS token，不新增依赖），不再重复请求。
5. 加载失败静默（与现有历史加载失败口径一致），下次到顶可重试。
6. 触发防抖：滚动到顶连续触发只发一次 in-flight 请求；与发送/流式不互斥（纯只读查询）。

## Acceptance

- [ ] 单测：DAO beforeId 游标窗口正确性（边界：不足一页 / 恰好一页 / 跨页）；service 层分页桥接；到底判定置位
- [ ] `npx tsc --noEmit` 零错误，受影响包 jest 全绿
- [ ] 现有「打开抽屉加载最近 50 条」行为零回归
- [ ] 不引入新依赖，不动 src/core

## deliverables

- src/app/services/persistence/chat-history-dao.ts（beforeId 窗口）
- src/electron/preload.ts（方法暴露）
- src/app/services/persistence/chat-history.ts（端口类型）
- src/hud/components/chat-drawer/chat-drawer.ts（滚动触发 + prepend + 位置锚定）
- 对应单测文件

## 设计参考

Anthropic《Scaling Managed Agents》getEvents 章节（positional slices of the event stream）。
