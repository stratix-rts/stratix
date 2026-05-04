import { Database } from './src/stratix-database/sqlite-adapter';

async function main() {
  const db = new Database('./stratix-data/test-stratix2.db');
  await db.initialize();
  db.exec('CREATE TABLE IF NOT EXISTS agents (agent_id TEXT PRIMARY KEY, name TEXT)');
  db.prepare("INSERT INTO agents (agent_id, name) VALUES ('a1', 'Agent 1')").run();
  db.prepare("INSERT INTO agents (agent_id, name) VALUES ('a2', 'Agent 2')").run();
  
  const allStmt = db.prepare('SELECT * FROM agents ORDER BY agent_id');
  console.log('Before delete:', allStmt.all());
  
  const delStmt = db.prepare("DELETE FROM agents WHERE agent_id = 'a1'");
  const result = delStmt.run();
  console.log('Delete result:', result);
  
  console.log('After delete:', allStmt.all());
  
  // Test upsert
  const upsertSql = `INSERT INTO agents (agent_id, name) VALUES (?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET name = excluded.name`;
  const upsertStmt = db.prepare(upsertSql);
  const upsertResult = upsertStmt.run('a2', 'Agent 2 Updated');
  console.log('Upsert result:', upsertResult);
  console.log('After upsert:', allStmt.all());
  
  db.close();
}

main().catch(console.error);
