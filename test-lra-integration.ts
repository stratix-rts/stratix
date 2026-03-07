import { AgentOrchestratorClient } from './src/stratix-task-executor/AgentOrchestratorClient';
import axios from 'axios';

axios.defaults.baseURL = 'http://localhost:7524';

async function testLRAIntegration() {
  console.log('🧪 Testing LRA + Agent Orchestration via Gateway\n');
  
  const testDir = '/tmp/test-lra-integration';
  const orchestrator = AgentOrchestratorClient.getInstance();
  
  try {
    console.log('1. Testing Gateway Health');
    const health = await axios.get('/api/health');
    console.log(`   ✅ Gateway is ${health.data.status}\n`);
    
    console.log('2. Testing LRA Init via Gateway');
    await axios.post('/api/lra/init', { path: testDir, projectName: 'test-project' });
    console.log('   ✅ LRA initialized\n');
    
    console.log('3. Testing Create Task');
    const { data: task1 } = await axios.post('/api/lra/create', { 
      path: testDir, 
      description: 'First test task' 
    });
    const { data: task2 } = await axios.post('/api/lra/create', { 
      path: testDir, 
      description: 'Second test task' 
    });
    console.log(`   ✅ Created 2 tasks: ${task1.taskId}, ${task2.taskId}\n`);
    
    console.log('4. Testing List Tasks');
    const { data: listResult } = await axios.get('/api/lra/list', { params: { path: testDir } });
    console.log(`   ✅ Found ${listResult.tasks.length} tasks`);
    listResult.tasks.forEach((t: any) => {
      console.log(`      - ${t.id}: ${t.description} (${t.status})`);
    });
    console.log();
    
    console.log('5. Testing Get Active Agents');
    const agents = await orchestrator.getActiveAgents();
    console.log(`   ✅ Active agents: ${agents.length}\n`);
    
    console.log('✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testLRAIntegration().catch(console.error);