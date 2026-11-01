# task_084 e2e: 服务常驻剧本——全程不开 Electron，agent 照常干活，壳后恢复

## 描述

前后端分离总验收（C1）。剧本即产品主张：service 常驻持有大脑，Electron 是可关可换的壳。模式参考 e2e-tests/ 既有脚本沉淀（node 直跑、断言明确、exit code 语义）。方案：docs/SERVICE-SPLIT-PLAN.md 第 6 节。

## Requirements

新剧本 `e2e-tests/service-resident.e2e.mjs`（node 脚本，可重复执行）：

1. 起 service（gateway 单进程，boot 含执行环+存储）
2. MCP world_snapshot 断言真实 units 非空
3. task_assign（**fake CLI adapter 保证确定性**；`--real` flag 可选切真 claude）→ 断言 task completed → mission done
4. 全程断言无 Electron 进程（pgrep electron 为空）
5. 拉起 Electron 远程模式（装配开关开）→ 断言视图恢复：world-sync 客户端收到 snapshot、units/tasks 可见（可经 CDP 或 remote store 日志断言，不必截图）
6. kill Electron → 再拉起 → 状态无损（seq 续推、无重复 mission）

清理语义：剧本退出前杀掉自己拉起的所有子进程（service/Electron），不留孤儿。

## Acceptance

- [x] `node e2e-tests/service-resident.e2e.mjs` 跑通 exit 0，可重复跑（连跑两遍均 exit 0 / 20 断言全过）
- [x] 断言覆盖：无 Electron 时 mission done / Electron 拉起后视图恢复 / kill 再拉状态无损
- [x] 输出贴最后 30 行进任务 md（见下「实跑输出」）
- [x] 剧本退出后无残留 service/electron 孤儿进程（按 pid 精确核对，见下方「与原验收口径的一处偏差」）

## deliverables

- e2e-tests/service-resident.e2e.mjs（+ 需要的 helper）
- 实跑输出记录

---

## 实现说明（落地后回填）

### 产物

| 文件 | 职责 |
|------|------|
| `e2e-tests/service-resident.e2e.mjs` | 验收剧本主体（node 直跑）：起 service / 观察客户端 / MCP 断言 / 拉起 Electron / 重启断言 / 精确收尾 |
| `e2e-tests/service-resident/fake-cli.ts` | fake CLI adapter（echo 型替身）：只替**最末端那一跳**（真 claude → node 回显 prompt） |
| `e2e-tests/service-resident/service-process.ts` | service 进程启动器（tsx 直跑）：拉起 gateway + 注入执行器替身，打印 `SX_SERVICE_READY` |
| `e2e-tests/README.md` | 补该剧本的用法 / 端口 / 纪律说明 |

### 生产侧的三处最小改动（没有它们，剧本跑不起来）

1. `src/stratix-gateway/service/stratix-service.ts` —— 组合根兜底接线 `onMissionSettled`：
   任务 completed → mission done、failed → mission cancelled（与渲染侧 `main-entry.ts` 同一口径）。
   ★ 没有它：任务在 service 里跑完了，mission 却永远停在 running —— 那正是「壳关了 agent 照常干活」
   要消解的场景，验收点直接不成立。
2. `src/stratix-gateway/service/boot.ts` + `src/stratix-gateway/index.ts` —— 执行器注入口
   （`createTransport` / `serviceTransport`）：e2e 据此注入 fake adapter（确定性执行，不调真 CLI、不花 token）。
   缺省 = 生产口径（直接 spawn 真 CLI），生产路径与测试路径在代码里一眼分得开。
3. `src/electron/main.ts` —— `STRATIX_DEV_SERVER_URL` 显式指址开关：壳连**剧本自己的** vite（7601），
   而不是「谁占着 7523 就连谁」（用户的 dev 实例正占着 7523，连过去就等于跑到别人的服务上去了）。
4. `tsconfig.electron.json` —— 补 `strict`（+ `strictPropertyInitialization: false`，与主 tsconfig 对齐）：
   此前该配置**没开 strict** → strictNullChecks 缺省 false → 判别联合无法按 `ok` 收窄 →
   `npm run build:electron` 直接编译失败（Electron 壳根本构建不出来）。
   ★ 这是本单之前就存在的构建配置问题（与本单改动无关），不修则「拉起 Electron」这一步无从谈起。

### 与原验收口径的一处偏差（按用户硬约束改写）

- 原文写「pgrep electron 为空」「pgrep 无残留」—— **不按进程名扫杀**：用户的 dev 实例正跑着
  Electron（9222 在监听），按名扫杀会误杀它。改为：**只按剧本自己记下的 pid 精确回收**
  （连同其后代树），并用「service 进程树里没有 Electron 子进程」+「匹配本剧本调试端口的进程数为 0」
  两条断言替代（见输出摘要第 9 / 10 条）。
- 端口：用户的 7523 / 7524 / 9222 一个不碰；service 7797、状态 WS 7798、CDP 7799、vite 7601 全部备用。

### 实跑输出（第二次连跑的最后 30 行；两遍均 exit 0）

```
[e2e] ✓ seq 续推（service 侧版本号单调递增，重启未重置） — 重启前 seq=7 → 重启后 seq=9
[e2e] 已回收 electron（第二次）（pid 49902，连同 5 个后代）
[e2e] 已回收 vite（pid 49633，连同 1 个后代）
[e2e] 已回收 service（pid 49599，连同 1 个后代）
[e2e] ✓ 剧本拉起的进程全部收干净（无孤儿） — 无残留
[e2e] 收尾完成：只回收了本剧本拉起的 pid，用户实例未受影响
──────────────── 验收摘要 ────────────────
✅ service 进程起来了（gateway 单进程） —— pid=49600 port=7797
✅ world-sync 端点可连（观察客户端收到全量快照） —— seq=2
✅ MCP world_snapshot 断言真实 units 非空 —— units=1（unit=unit_character_1793553919188_1）
✅ 角色已建档并绑定 agent —— character=character_1793553919188_1 agent=claude-code
✅ mission 已创建并进入 running —— mission=mission_1793553919193_1 phase=running
✅ 任务 completed（无 Electron，agent 在 service 进程里干活） —— task=task_1793553919195_1 status=completed
✅ 任务输出来自 fake CLI adapter（真链路 + 末端替身） —— e2e-fake-cli:你将扮演「E2E常驻19187」这个角色执行任务，请全程保持角色设定一致。 【角色设定】 你
✅ mission done（任务 completed → mission 收尾） —— mission=mission_1793553919193_1 phase=done
✅ service 进程树里没有 Electron 子进程（干活的是常驻 service） —— service 树 3 个后代，Electron 0 个
✅ 本剧本尚未拉起任何 Electron 实例（无 Electron 阶段成立） —— 匹配 --remote-debugging-port=7799 的进程 0 个
✅ Electron 远程模式收到快照：units 可见 —— units=1
✅ Electron 远程模式收到快照：tasks 可见且已完成 —— tasks=1
✅ Electron 远程模式收到快照：missions 可见且已收尾 —— missions=1
✅ 第一次 Electron 已收掉 —— pid=49708
✅ 重启后单位仍在（状态无损） —— units=1
✅ 重启后任务仍在且仍是 completed —— tasks=1
✅ 重启后无重复 mission（数量与重启前一致） —— 重启前 1 条 / 重启后 1 条
✅ 重启后无重复任务（数量与重启前一致） —— 重启前 1 条 / 重启后 1 条
✅ seq 续推（service 侧版本号单调递增，重启未重置） —— 重启前 seq=7 → 重启后 seq=9
✅ 剧本拉起的进程全部收干净（无孤儿） —— 无残留
断言：20/20 通过
结论：PASS（服务常驻、Electron 可选）
────────────────────────────────────────────
```

### 未尽事项

- `--real`（切真 claude）开关已接（`SX_REAL_CLI=1` → 不注入替身，走生产口径 spawn 真 claude），
  默认**不跑**（慢、耗 token、结果不确定）；本单验收以确定性模式为准。
- Electron 壳首次拉起前会检查 `dist/electron/electron/*` 是否比 `src/electron/*` 旧 —— 旧则自动
  `npm run build:electron`（约 4s）。本单因此改了 `tsconfig.electron.json`（见上）。

