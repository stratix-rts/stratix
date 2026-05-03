import axios from 'axios';

import { TailscaleService } from './TailscaleService';

async function testTailscale() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   Tailscale Service Test                  ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  const service = new TailscaleService({
    openClawPort: 18789,
  });

  let exiting = false;
  function gracefulExit(code: number) {
    if (exiting) return;
    exiting = true;
    service.stop();
    process.exit(code);
  }
  process.on('SIGINT', () => gracefulExit(0));

  service.subscribe((event) => {
    console.log(`[Event] ${event.type}`);
  });

  console.log('1. Initializing Tailscale service...');
  const initialized = await service.initialize();
  
  if (!initialized) {
    console.log('\n   ✗ Tailscale not available');
    console.log('   Please ensure:');
    console.log('   1. Tailscale is installed: https://tailscale.com/download');
    console.log('   2. Tailscale is running: tailscale up');
    console.log('   3. You are connected to a tailnet');
    gracefulExit(1);
  }

  console.log('   ✓ Tailscale service initialized');

  console.log('\n2. Getting status...');
  const status = service.getStatus();
  if (status) {
    console.log(`   Self: ${status.self.hostName} (${status.self.dnsName})`);
    console.log(`   IPs: ${status.self.tailscaleIps.join(', ')}`);
    console.log(`   Tailnet: ${status.currentTailnet.name}`);
    console.log(`   Peers: ${status.peers.length}`);
    console.log(`   Health: ${status.health}`);
  }

  console.log('\n3. Discovering OpenClaw nodes...');
  const nodes = await service.discoverOpenClawNodes();
  if (nodes.length > 0) {
    console.log(`   Found ${nodes.length} OpenClaw node(s):`);
    for (const node of nodes) {
      console.log(`   - ${node.peer.hostName}: ${node.url} (${node.healthy ? 'healthy' : 'unhealthy'})`);
    }
  } else {
    console.log('   No OpenClaw nodes found in tailnet');
    console.log('   Ensure OpenClaw is running on other machines with:');
    console.log('   - gateway.auth.allowTailscale = true');
    console.log('   - gateway.tailscale.mode = "serve"');
  }

  console.log('\n4. Testing node access...');
  const healthyNode = service.getFirstHealthyNode();
  if (healthyNode) {
    try {
      const response = await axios.get(`${healthyNode.url}/`, { timeout: 5000 });
      console.log(`   ✓ ${healthyNode.peer.hostName} responded with status ${response.status}`);
    } catch (error) {
      console.log(`   ✗ ${healthyNode.peer.hostName} error: ${(error as Error).message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('Tailscale integration test complete!');
  console.log('═══════════════════════════════════════════\n');

  service.stop();
}

testTailscale().catch((err) => {
  console.error(err);
  process.exit(1);
});
