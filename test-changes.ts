import { Database } from './src/stratix-database/sqlite-adapter';

async function main() {
  const db = new Database('./stratix-data/test-changes.db');
  await db.initialize();
  db.exec('CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY, name TEXT)');
  
  const insert = db.prepare("INSERT INTO test (id, name) VALUES (?, ?)");
  console.log('Insert 1:', insert.run('a1', 'A1'));
  console.log('Insert 2:', insert.run('a2', 'A2'));
  
  const update = db.prepare("UPDATE test SET name = ? WHERE id = ?");
  console.log('Update:', update.run('A1-updated', 'a1'));
  
  const del = db.prepare("DELETE FROM test WHERE id = ?");
  console.log('Delete:', del.run('a2'));
  
  const noop = db.prepare("UPDATE test SET name = ? WHERE id = ?");
  console.log('No-op update:', noop.run('same', 'nonexistent'));
  
  db.close();
}

main().catch(console.error);
