import { Database } from './src/stratix-database/sqlite-adapter';

async function main() {
  const db = new Database('./stratix-data/test-stratix.db');
  await db.initialize();
  db.exec('CREATE TABLE IF NOT EXISTS agents (agent_id TEXT PRIMARY KEY, name TEXT)');
  const stmt = db.prepare('INSERT INTO agents (agent_id, name) VALUES (?, ?)');
  stmt.run('a1', 'Agent 1');
  stmt.run('a2', 'Agent 2');
  const allStmt = db.prepare('SELECT * FROM agents ORDER BY agent_id');
  const rows = allStmt.all();
  console.log('Rows:', rows);
  const getStmt = db.prepare('SELECT * FROM agents WHERE agent_id = ?');
  const row = getStmt.get('a1');
  console.log('Row:', row);
  db.close();
}

main().catch(console.error);
