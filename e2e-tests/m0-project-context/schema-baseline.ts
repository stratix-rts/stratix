/**
 * 文件职责：**M0 前的库结构基线**快照程序（@since v3.3，task_172 / DESIGN-workspace §8「M0-08」行）。
 *
 * ============ 这个文件为什么要能被「搬到另一棵代码树里跑」============
 *   验收标准③要求「库结构与 M0 前**逐字节**一致」。要拿到「M0 前」的库结构，就得用
 *   **M0 前的代码**建一次库 —— 验收脚本把 M0 前那个提交（`git archive`）展开成临时代码树，
 *   再把本文件复制进去跑一次，拿到基线快照。
 *   ⇒ 本文件**不能**用「相对本文件位置」的静态 import（复制过去就指错地方了），
 *   改用**动态 import + 根目录由环境变量给**（`SX_M0_BASELINE_ROOT`）——
 *   于是同一个文件既能跑在仓库里（根 = 仓库），也能跑在展开出来的 M0 前代码树里。
 *
 * ============ 基线怎么建（与生产开库口径同序）============
 *   ① `StratixDatabase.initialize()` —— 全量 DDL + 迁移（schema_version → 13）；
 *   ② storage 的五张表兜底 `ensure*`（character_tasks / character_chat_messages /
 *      exp_events / sessions / session_events）—— 与 `createServiceStorage` 的开库序列**同序同件**，
 *      否则两边建出来的库结构不可比（实测：少跑 ensure 会少一个 `idx_tasks_character` 索引）。
 *   跑完把 `sqlite_master` 全量行落盘（JSON）⇒ 供脚本与 HEAD 的库结构逐字节比较。
 *
 * 输入：环境变量 `SX_M0_BASELINE_ROOT`（代码树根，默认当前目录）、
 *      `SX_M0_BASELINE_DATA_DIR`（临时库目录）、`SX_M0_BASELINE_OUT`（快照落盘路径）。
 * 输出：一个 JSON 文件（`sqlite_master` 全量行）。
 * 禁止事项：
 *   1. 写任何业务判断 —— 本程序只负责「建库 + 抄结构」，断言在验收脚本里；
 *   2. 依赖仓库里的 node_modules 之外的路径 —— 只 import 代码树内的模块。
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

/** 代码树根（M0 前那棵树 / 仓库，取决于环境变量）。 */
const ROOT = path.resolve(process.env.SX_M0_BASELINE_ROOT ?? '.');
/** 临时库目录。 */
const DATA_DIR = process.env.SX_M0_BASELINE_DATA_DIR ?? path.join(ROOT, '.m0-baseline-db');
/** 快照落盘路径。 */
const OUT = process.env.SX_M0_BASELINE_OUT ?? path.join(ROOT, '.m0-baseline-schema.json');

/** 按「代码树根 + 相对路径」动态加载一个 TS 模块（tsx 会接管 .ts 的加载）。 */
async function loadModule(relativePath: string): Promise<Record<string, unknown>> {
  const href = pathToFileURL(path.join(ROOT, relativePath)).href;
  return (await import(href)) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const { StratixDatabase } = await loadModule('src/stratix-database/StratixDatabase.ts');
  const { ensureCharacterTasksTable } = await loadModule(
    'src/app/services/persistence/task-record-dao.ts'
  );
  const { ensureCharacterChatMessagesTable } = await loadModule(
    'src/app/services/persistence/chat-history-dao.ts'
  );
  const { ensureExpEventsTable } = await loadModule(
    'src/app/services/persistence/exp-event-dao.ts'
  );
  const { ensureSessionsTable } = await loadModule('src/app/services/persistence/session-dao.ts');
  const { ensureSessionEventsTable } = await loadModule(
    'src/app/services/persistence/session-event-dao.ts'
  );

  const DatabaseCtor = StratixDatabase as unknown as new (config: {
    dataDir: string;
  }) => {
    init(): Promise<void>;
    initialize(): void;
    getDatabase(): {
      prepare(sql: string): { all(): Record<string, unknown>[] };
      pragma(sql: string): Record<string, unknown>[];
    };
  };

  const db = new DatabaseCtor({ dataDir: DATA_DIR });
  await db.init();
  db.initialize();
  const handle = db.getDatabase();

  // 与 createServiceStorage 的开库序列同序同件（否则两边不可比）。
  const ensure = ensureCharacterTasksTable as unknown as (h: unknown) => void;
  const ensureChat = ensureCharacterChatMessagesTable as unknown as (h: unknown) => void;
  const ensureExp = ensureExpEventsTable as unknown as (h: unknown) => void;
  const ensureSessions = ensureSessionsTable as unknown as (h: unknown) => void;
  const ensureSessionEvents = ensureSessionEventsTable as unknown as (h: unknown) => void;
  ensure(handle);
  ensureChat(handle);
  ensureExp(handle);
  ensureSessions(handle);
  ensureSessionEvents(handle);

  const rows = handle
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
    .all();
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  // stdout 只留一行标记（库初始化日志会混在 stdout 上，脚本按文件读结果，不解析 stdout）。
  process.stdout.write(`SX_M0_BASELINE_OK ${rows.length}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`[m0-baseline] 失败：${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
