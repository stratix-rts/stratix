import { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

import { LocalOpenClawAdapter } from './LocalOpenClawAdapter';
import { RemoteOpenClawAdapter } from './RemoteOpenClawAdapter';


const CONFIG_HELP = `
===========================================
OpenClaw Configuration Required
===========================================

1. Set auth token in ~/.openclaw/openclaw.json:

{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "your-secure-token-here"
    },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}

2. Restart OpenClaw: openclaw gateway restart

3. Run test with token:
   OPENCLAW_API_KEY=your-token npx tsx src/stratix-openclaw-adapter/test-connection.ts
`;

async function testLocalConnection() {
  console.log('\n=== Testing Local OpenClaw Connection ===\n');

  const endpoint = process.env.OPENCLAW_ENDPOINT || 'http://127.0.0.1:18789';
  const apiKey = process.env.OPENCLAW_API_KEY;

  console.log(`Endpoint: ${endpoint}`);
  console.log(`API Key: ${apiKey ? '***' + apiKey.slice(-4) : 'not set'}`);

  const config: StratixOpenClawConfig = {
    accountId: 'stratix-test',
    endpoint,
    apiKey,
  };

  const adapter = new LocalOpenClawAdapter(config);

  try {
    console.log('\n1. Testing connection...');
    await adapter.connect();
    console.log('   ✓ Connected');

    console.log('\n2. Getting status...');
    const status = await adapter.getStatus();
    console.log('   Connected:', status.connected);

    console.log('\n3. Testing /tools/invoke (sessions_list)...');
    try {
      const sessions = await adapter.listSessions();
      console.log('   Sessions:', JSON.stringify(sessions, null, 2).slice(0, 200));
    } catch (error) {
      console.log('   Error:', (error as Error).message);
    }

    console.log('\n4. Testing /tools/invoke (agents_list)...');
    try {
      const agents = await adapter.listAgents();
      console.log('   Agents:', JSON.stringify(agents, null, 2).slice(0, 200));
    } catch (error) {
      console.log('   Error:', (error as Error).message);
    }

    console.log('\n5. Testing OpenAI-compatible API...');
    try {
      const response = await adapter.openaiChatCompletion({
        model: 'openclaw',
        messages: [{ role: 'user', content: 'Say "Hello from Stratix!" in exactly 5 words.' }],
        max_tokens: 20,
      });
      console.log('   Response:', response.choices[0]?.message?.content);
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('404') || msg.includes('405') || msg.includes('Not Found')) {
        console.log('   ✗ Chat completions endpoint not enabled');
        console.log('   Enable it in config: gateway.http.endpoints.chatCompletions.enabled = true');
      } else {
        console.log('   Error:', msg);
      }
    }

    console.log('\n✓ Local tests completed!');
    return true;
  } catch (error) {
    console.error('   ✗ Error:', (error as Error).message);
    if (!apiKey) {
      console.log(CONFIG_HELP);
    }
    return false;
  }
}

async function testRemoteConnection() {
  console.log('\n=== Testing Remote OpenClaw Connection ===\n');

  const remoteEndpoint = process.env.OPENCLAW_REMOTE_ENDPOINT;
  const remoteApiKey = process.env.OPENCLAW_REMOTE_API_KEY;

  if (!remoteEndpoint) {
    console.log('   Skipped: Set OPENCLAW_REMOTE_ENDPOINT to test remote');
    console.log('   Example: OPENCLAW_REMOTE_ENDPOINT=https://your-openclaw.example.com');
    return null;
  }

  console.log(`Endpoint: ${remoteEndpoint}`);

  const config: StratixOpenClawConfig = {
    accountId: 'stratix-remote',
    endpoint: remoteEndpoint,
    apiKey: remoteApiKey,
  };

  const adapter = new RemoteOpenClawAdapter(config);

  try {
    console.log('\n1. Connecting...');
    await adapter.connect();
    console.log('   ✓ Connected');

    console.log('\n2. Listing models...');
    const models = await adapter.listModels();
    console.log('   Models:', models.slice(0, 5).join(', ') + (models.length > 5 ? '...' : ''));

    console.log('\n3. Sending message...');
    const response = await adapter.sendMessage('Say hello in one word.');
    console.log('   Response:', response.content);

    console.log('\n✓ Remote tests passed!');
    return true;
  } catch (error) {
    console.error('   ✗ Error:', (error as Error).message);
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   OpenClaw Adapter Connection Test        ║');
  console.log('╚═══════════════════════════════════════════╝');

  const localOk = await testLocalConnection();
  const remoteOk = await testRemoteConnection();

  console.log('\n═══════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  Local:   ${localOk ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Remote:  ${remoteOk === null ? 'SKIPPED' : remoteOk ? '✓ PASS' : '✗ FAIL'}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch(console.error);
