import { initializeDatabase, getDatabase } from './src/stratix-database/StratixDatabase';
import { AgentRepository } from './src/stratix-database/AgentRepository';

async function main() {
  await initializeDatabase({ dataDir: './stratix-data', filename: 'test-agent' });
  const repo = new AgentRepository();
  
  console.log('isHealthy:', repo.isHealthy());
  
  const agents = repo.getAllAgents();
  console.log('getAllAgents:', agents);
  
  repo.saveAgent({
    agentId: 'test-1',
    name: 'Test Agent',
    type: 'custom',
    backendType: 'stratix',
    configStatus: 'draft',
    profile: { characterId: 'test-1', name: 'Test Agent', bodyType: 'male', parts: {} }
  } as any);
  
  const agents2 = repo.getAllAgents();
  console.log('getAllAgents after save:', agents2.length, agents2);
  
  const agent = repo.getAgent('test-1');
  console.log('getAgent:', agent);
  
  getDatabase().close();
}

main().catch(console.error);
