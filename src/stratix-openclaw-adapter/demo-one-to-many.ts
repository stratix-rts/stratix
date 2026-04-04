import { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

import { ConnectionPool, LocalOpenClawAdapter, RemoteOpenClawAdapter } from './index';


async function demoOneToMany() {
  console.log('\n=== One-to-Many OpenClaw Demo ===\n');

  const pool = new ConnectionPool({
    maxConnections: 100,
    healthCheckInterval: 30000,
    connectionBatchDelay: 100,
  });

  const gateways: StratixOpenClawConfig[] = [
    {
      accountId: 'local-1',
      endpoint: 'http://127.0.0.1:18789',
      apiKey: process.env.OPENCLAW_API_KEY,
    },
  ];

  if (process.env.OPENCLAW_REMOTE_ENDPOINT) {
    gateways.push({
      accountId: 'remote-1',
      endpoint: process.env.OPENCLAW_REMOTE_ENDPOINT,
      apiKey: process.env.OPENCLAW_REMOTE_API_KEY,
    });
  }

  console.log('1. Initializing connections (batch mode)...');
  const initResults = await pool.initializeAll(gateways);
  for (const [key, success] of initResults) {
    console.log(`   ${key}: ${success ? '✓' : '✗'}`);
  }

  console.log('\n2. Pool stats:');
  const stats = pool.getPoolStats();
  console.log(`   Total: ${stats.totalConnections}, Active: ${stats.activeConnections}, Errors: ${stats.errorConnections}`);

  console.log('\n3. Connected keys:');
  console.log('  ', pool.getConnectedKeys());

  console.log('\n4. Invoke on all servers (sessions_list):');
  const results = await pool.invokeAll('sessions_list');
  for (const r of results) {
    if (r.success) {
      console.log(`   ${r.key}: ${(r.result as { count?: number })?.count || 0} sessions`);
    } else {
      console.log(`   ${r.key}: Error - ${r.error}`);
    }
  }

  console.log('\n5. Invoke first available (agents_list):');
  try {
    const first = await pool.invokeFirst('agents_list');
    console.log(`   From ${first.key}:`, JSON.stringify(first.result).slice(0, 100) + '...');
  } catch (error) {
    console.log('   Error:', (error as Error).message);
  }

  console.log('\n6. Round-robin invoke (health):');
  for (let i = 0; i < 3; i++) {
    try {
      const rr = await pool.invokeRoundRobin('health');
      console.log(`   Request ${i + 1}: ${rr.key}`);
    } catch (error) {
      console.log(`   Request ${i + 1}: No connections`);
    }
  }

  console.log('\n7. Cleanup...');
  await pool.disconnectAll();
  console.log('   ✓ Disconnected');

  console.log('\n=== Demo Complete ===\n');
}

demoOneToMany().catch(console.error);
