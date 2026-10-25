# task_063 kimi adapter 适配 Kimi Code 2.x

## 需求来源
2026-10-26 用户升级 Kimi Code 2.3.2（`~/.kimi-code/bin/kimi`，旧 kimi-cli 1.52 停止维护）。真机实测破坏点：
1. `--yolo` 与 `-p/--prompt` 不能同用（`error: Cannot combine --prompt with --yolo.`）——现 buildArgs 必炸
2. `--work-dir` 旗标已废（新 CLI 为 `--add-dir`）
3. 会话 id 新格式带 `session_` 前缀（`session_<uuid>`）——stderr 收割正则 `[0-9a-fA-F-]{36}` 起始失配
4. 好消息：`--session <id>` resume 正常、内容记忆真机实证（暗号两轮命中）、`-p` prompt 模式自带工具执行（文件操作实测通过）、stderr 尾行 resume hint 仍在

## 需求
1. `src/app/services/cli-transport/adapters/kimi.ts`：
   - buildArgs：去掉 `--yolo`（prompt 模式无需它）；去掉 `--work-dir`（transport 已用 cwd 传工作目录则删；确认 spawnOptions.cwd 通路后注明）；保留 `--session <id>` + `--prompt`
   - parseKimiStderrLine 正则接受可选 `session_` 前缀（`(?:session_)?`），旧格式也兼容
   - 文件头调研注释更新为 2.3.2 实测结论（保留 1.52 考古段，标「1.52 时代」）
2. `docs/AGENT-MATRIX.md` T1 kimi 行：headless 命令更新 `kimi -p`（无 --yolo）、会话恢复 `--session <id>` 不变、id 格式注记
3. 测试：kimi adapter 既有测试更新（args 无 --yolo/--work-dir、session_ 前缀正则命中、旧格式兼容）；新增 buildArgs 两分支用例
4. yolo 参数若 config 仍在传入：adapter 内忽略并注释（不要求改 config 面）

## 验收标准
- [ ] buildArgs 产出命令在 Kimi Code 2.3.2 实机可跑（无 --yolo 冲突）
- [ ] stderr 收割对 `session_<uuid>` 与裸 `<uuid>` 双格式命中
- [ ] resume 透传链路不变
- [ ] typecheck 零错误；jest 全绿（3655 基线不回归）
- [ ] 不引入新依赖；最小改动

## 验证方式
npm run typecheck && npx jest --silent；adapter 单测覆盖双格式

## 验证结果（2026-10-26）
- cwd 通路：`runtime.ts` 将 `SpawnOptions.cwd` 传给 process factory，`node-process.ts` 再传给 `child_process.spawn`，故 `--work-dir` 冗余且已删除。
- Kimi Code 2.3.2 实机：在仓库工作目录执行 `~/.kimi-code/bin/kimi --prompt '只回复 pong，不调用工具。'`，退出码 0，输出 `pong`，stderr 尾行返回 `session_32d68aeb-8e8d-4932-a4ad-810c1cc53e62`。
- adapter 单测：`npx jest --silent src/app/__tests__/cli-transport-adapters.test.ts --runInBand`，1 suite、28 tests 全部通过；覆盖 buildArgs 新会话/resume 两分支、旧配置忽略及两种会话 id 格式。
- `npm run typecheck`：`tsc --noEmit` 退出码 0，零错误。
- `npx jest --silent`：168 suites 全部通过；3656 passed、6 skipped、3662 total；较 3655 基线新增 1 个 buildArgs 分支用例，无回归。
- 未引入新依赖。
