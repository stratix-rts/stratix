import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const RUN_ID_FILE = '/tmp/stratix-test-run-id';

/**
 * 生成 runId，格式：test_{timestamp}_{pid}
 */
export function generateRunId(): string {
  return `test_${Date.now()}_${process.pid}`;
}

/**
 * 保存 runId 到文件
 */
export function saveRunId(runId: string): void {
  fs.writeFileSync(RUN_ID_FILE, runId, 'utf-8');
}

/**
 * 从文件加载上次运行的 runId
 */
export function loadRunId(): string | null {
  try {
    if (fs.existsSync(RUN_ID_FILE)) {
      return fs.readFileSync(RUN_ID_FILE, 'utf-8').trim();
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 清理测试数据
 *
 * 清理对象：
 * - projects 表：name LIKE '%测试%' 或 name LIKE '%' || runId || '%'
 * - zones 表：project_id 关联到上述测试 project
 * - zone_contexts 表：title LIKE '搜索测试%' OR title LIKE 'API 创建测试 Zone%' 或 title LIKE '%' || runId || '%'
 * - zone_tasks / zone_messages / zone_files 等关联表（CASCADE 自动清理）
 *
 * 使用 CASCADE FK，删除 zone_contexts 会自动清理子表。
 * 删除 projects 会通过 FK 触发 zones 清理。
 *
 * @param dbPath 数据库路径
 * @param runId 可选，按 runId 精确清理
 */
export function cleanTestData(dbPath?: string, runId?: string): number {
  const resolvedPath = dbPath || path.resolve(__dirname, '../../../stratix-data/stratix.db.sqlite');

  let db: Database.Database;
  try {
    db = new Database(resolvedPath, { readonly: false });
  } catch {
    console.log('[clean-test-data] 数据库不存在，跳过清理');
    return 0;
  }

  let totalDeleted = 0;

  try {
    // 开启事务
    const deleteProject = db.transaction((projectId: string) => {
      // zone_contexts 通过 CASCADE 清理
      const ctx = db.prepare('DELETE FROM zone_contexts WHERE project_id = ?').run(projectId);
      const zone = db.prepare('DELETE FROM zones WHERE project_id = ?').run(projectId);
      const proj = db.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
      return (ctx.changes + zone.changes + proj.changes);
    });

    // 查找并删除 projects（runId 精确匹配 或 兜底模糊匹配）
    const projectSql = runId
      ? "SELECT project_id FROM projects WHERE name LIKE '%' || ? || '%'"
      : "SELECT project_id FROM projects WHERE name LIKE '%测试%'";
    const testProjects = (runId
      ? db.prepare(projectSql).all(runId) as { project_id: string }[]
      : db.prepare(projectSql).all() as { project_id: string }[]
    );

    for (const { project_id } of testProjects) {
      const deleted = deleteProject(project_id);
      totalDeleted += deleted;
      console.log(`[clean-test-data] 已删除测试项目 ${project_id}，影响 ${deleted} 行`);
    }

    // 直接清理 zone_contexts 中剩余的孤立测试数据
    // （runId 精确匹配 或 兜底模糊匹配）
    let testZoneCtx;
    if (runId) {
      testZoneCtx = db.prepare(
        "DELETE FROM zone_contexts WHERE title LIKE '%' || ? || '%'"
      ).run(runId);
    } else {
      testZoneCtx = db.prepare(
        "DELETE FROM zone_contexts WHERE title LIKE '搜索测试%' OR title LIKE 'API 创建测试 Zone%'"
      ).run();
    }
    if (testZoneCtx.changes > 0) {
      console.log(`[clean-test-data] 已删除 ${testZoneCtx.changes} 条孤立测试 zone_contexts`);
      totalDeleted += testZoneCtx.changes;
    }

    console.log(`[clean-test-data] 共清理 ${totalDeleted} 行测试数据`);
  } finally {
    db.close();
  }

  return totalDeleted;
}

// 支持直接运行：npx ts-node tests/e2e/scripts/clean-test-data.ts
if (require.main === module) {
  cleanTestData();
}
