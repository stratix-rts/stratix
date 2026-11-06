/**
 * 文件职责：M0 端到端验收的**服务侧进程**（@since v3.3，task_172 / DESIGN-workspace §8「M0-08」行）。
 *
 * ============ 这一单验什么 ============
 *   在**含 `.stratix` 的目录**里真派一单，断言三件事（§8「M0-08」行的验收标准）：
 *     ① prompt 含 `<stratix-project>` 项目块（含来源声明行）；
 *     ② 子进程 cwd == 项目根；
 *     ③ 数据库零变化（库结构与 M0 前逐字节一致，零 DDL）。
 *
 * ============ 走的是真链路（不是单点）============
 *   core 总线派单 → task-service 拼 prompt → cli-transport **真拉子进程** →
 *   子进程回报 → 事件流 → 任务收尾 → **真落库**（character_tasks / sessions）。
 *   组合根是**生产组合根** `createStratixService`（含 service 侧执行环 task-execution.ts），
 *   不是本文件自己拼一套 —— 「端到端」的意思就是不再自造一条近似的路。
 *
 * ============ 只有两处是「注入的」，且都是生产里本来就有的接缝 ============
 *   ① **CLI 二进制**：换成回报所见（prompt + cwd）的替身（fake-cli.ts）——
 *      真 claude 二进制不在本机、也不该在验收里真花钱；被替的**只有最后一跳**。
 *   ② **项目根 / cwdProvider / 项目契约 provider**：
 *      生产里这三个值来自「活跃实例注册表」（S6b，尚未落地）⇒ 本文件按注册表的形状给值
 *      （项目根 = 夹具目录；分支 = 当前 worktree 的实际分支）。
 *      这是 M0 阶段唯一诚实的注入点：**值从哪来不影响被验的东西** ——
 *      被验的是「值一旦给对，派发链会不会把它带到 prompt 与子进程 cwd 上」。
 *
 * 输入（环境变量）：
 *   `SX_M0_WORKDIR`     临时工作目录（库建在这里）；
 *   `SX_M0_PROJECT_ROOT`项目根（含 `.stratix` 的目录）；
 *   `SX_M0_BRANCH`      当前分支（运行态事实；空 = 不给）；
 *   `SX_M0_RESULT_FILE` 结果 JSON 落盘路径。
 * 输出：一个结果 JSON（落盘）+ stdout 一行 `SX_M0_RESULT_OK`。
 * 禁止事项：
 *   1. 断言 —— 断言在驱动脚本（m0-project-context.e2e.mjs）里，本文件只**如实回报所见**；
 *   2. 改生产行为 —— 本文件只接线，不改 core / service 的语义；
 *   3. 跳过真实落库 —— 「数据库零变化」验的是**结构**，前提是数据真的写进去了。
 *
 * @since v3.3，task_172。
 */

import * as fs from 'fs';
import * as path from 'path';

import { createProjectContextProvider, SOURCE_DECLARATION } from '../../src/app/services/project-context';
import { createProjectContextLoader } from '../../src/app/services/project-context-loader';
import { destroyDatabase, getDatabase } from '../../src/stratix-database';
import { createStratixService } from '../../src/stratix-gateway/service';
import { createServiceStorage } from '../../src/stratix-gateway/service/storage';

import { createReportTransportFactory } from './fake-cli';

/** 环境变量入口。 */
const WORKDIR = process.env.SX_M0_WORKDIR ?? '';
const PROJECT_ROOT = process.env.SX_M0_PROJECT_ROOT ?? '';
const BRANCH = process.env.SX_M0_BRANCH ?? '';
const RESULT_FILE = process.env.SX_M0_RESULT_FILE ?? '';

/** 任务跑完的等待上限（毫秒）—— 替身秒回，正常远快于此。 */
const TASK_TIMEOUT_MS = 60_000;

/** `sqlite_master` 全量行（库结构的权威快照；**字节比较**用）。 */
function dumpSchema(db: {
  prepare(sql: string): { all(): Record<string, unknown>[] };
}): Record<string, unknown>[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all();
}

async function main(): Promise<void> {
  if (!WORKDIR || !PROJECT_ROOT || !RESULT_FILE) {
    throw new Error('缺少环境变量：SX_M0_WORKDIR / SX_M0_PROJECT_ROOT / SX_M0_RESULT_FILE');
  }

  // ===== ① 开库（真库；建在临时目录，不碰用户的真实库）=====
  const storage = await createServiceStorage({ dataDir: path.join(WORKDIR, 'db') });
  const db = getDatabase().getDatabase();
  const schemaBefore = dumpSchema(db);
  const pragmaBefore = db.pragma('schema_version');

  // ===== ② 组合根：生产组合根 + 三个注入口 =====
  const projectContextProvider = createProjectContextProvider({
    load: createProjectContextLoader({
      root: () => PROJECT_ROOT,
      branch: () => (BRANCH.length > 0 ? BRANCH : null),
      logger: (line: string): void => console.log('[m0]', line),
    }),
  });
  const service = createStratixService({
    storage,
    taskExecution: {
      // ① CLI 替身（最后一跳）；② 项目根（M0-02 派发 cwd）；③ 项目契约块（M0-06 注入点）。
      createTransport: createReportTransportFactory(),
      cwdProvider: () => PROJECT_ROOT,
      provideProjectContext: projectContextProvider,
    },
  });

  // ===== ③ 真派一单 =====
  const created = service.character.createCharacter({
    name: '验收角色',
    agentKind: 'claude-code',
    skinId: 'skin-default',
    persona: '你是验收角色，负责在项目里跑一单并如实回报。',
  });
  if (!created.ok) throw new Error(`角色建档被拒：${created.code}`);
  // 出队守门读 detectedAgents（真相源 = store；生产由探测器写入，service 侧探测接线归 A4）。
  service.store.setDetectedAgents([
    { kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: null, path: null },
  ]);
  const task = service.task.assignTask({
    characterId: created.character.id,
    prompt: '汇报当前项目概况。',
  });
  if (!task) throw new Error('派单未落地（task.assign 返回空）');

  // ===== ④ 等任务跑完 =====
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  let taskStatus = '';
  while (Date.now() < deadline) {
    const item = (service.store.getState().tasks ?? []).find((entry) => entry.id === task.id);
    taskStatus = item?.status ?? '';
    if (taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // ===== ⑤ 从库里把这一轮的产物捞出来（完整往返：子进程输出 → 落库）=====
  const row = db.prepare('SELECT id, status, output FROM character_tasks WHERE id = ?').get(task.id) as
    | { id: string; status: string; output: string }
    | undefined;
  const taskRows = db.prepare('SELECT COUNT(*) AS n FROM character_tasks').get() as
    | { n: number }
    | undefined;
  const sessionRows = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as
    | { n: number }
    | undefined;

  // ===== ⑥ 库结构快照（派发之后）=====
  const schemaAfter = dumpSchema(db);
  const pragmaAfter = db.pragma('schema_version');

  service.stop();
  destroyDatabase();

  const result = {
    taskId: task.id,
    taskStatus,
    persistedStatus: row?.status ?? '',
    output: row?.output ?? '',
    taskRows: taskRows?.n ?? 0,
    sessionRows: sessionRows?.n ?? 0,
    schemaBefore,
    schemaAfter,
    pragmaBefore,
    pragmaAfter,
    projectRoot: PROJECT_ROOT,
    // 来源声明行的**唯一一份**（从实现里导出，脚本不自己抄文案 ⇒ 改文案不会漂移）。
    sourceDeclaration: SOURCE_DECLARATION,
  };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result));
  process.stdout.write('SX_M0_RESULT_OK\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[m0-service] 失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
