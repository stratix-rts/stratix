import { EmbeddedTailscale } from './EmbeddedTailscale';

async function testEmbeddedTailscale() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   Embedded Tailscale Test                ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  const tailscale = new EmbeddedTailscale({
    openClawPort: 18789,
    hostname: 'stratix-test',
  });

  let exiting = false;
  async function gracefulExit(code: number) {
    if (exiting) return;
    exiting = true;
    console.log('\nStopping Tailscale...');
    await tailscale.stop();
    process.exit(code);
  }
  process.on('SIGINT', () => gracefulExit(0));

  tailscale.subscribe((event) => {
    console.log(`[Event] ${event.type}`, event.data ? JSON.stringify(event.data).slice(0, 100) : '');
  });

  console.log('1. Starting embedded Tailscale (userspace mode)...');
  console.log('   State directory: ~/.stratix/tailscale');

  try {
    const started = await tailscale.start();
    console.log(`   ${started ? '✓ Started' : '✗ Failed to start'}`);
  } catch (error) {
    console.log(`   ✗ Error: ${(error as Error).message}`);
    console.log('\n   Note: tailscaled binary must be available.');
    console.log('   Install via: brew install tailscale');
    await gracefulExit(1);
  }

  console.log('\n2. Checking status...');
  await new Promise(r => setTimeout(r, 1000));
  const status = await tailscale.getStatus();
  
  if (status) {
    console.log(`   Backend State: ${status.backendState}`);
    console.log(`   Self: ${status.self.hostName}`);
    console.log(`   Peers: ${status.peers.length}`);
  }

  if (tailscale.needsAuthentication()) {
    console.log('\n3. Authentication required!');
    console.log('   Get login URL...');
    const loginUrl = await tailscale.getLoginURL();
    if (loginUrl) {
      console.log(`\n   Open this URL in browser:\n   ${loginUrl}\n`);
    } else {
      console.log('   Set STRATIX_TAILSCALE_AUTH_KEY env var or pass authKey in config');
      console.log('   Get auth key from: https://login.tailscale.com/admin/settings/keys');
    }
    
    console.log('\n   Waiting for authentication (60s timeout)...');
    await new Promise(r => setTimeout(r, 60000));
    await gracefulExit(0);
  }

  console.log('\n3. Discovering OpenClaw nodes...');
  const nodes = await tailscale.discoverOpenClawNodes();
  
  if (nodes.length > 0) {
    console.log(`   Found ${nodes.length} OpenClaw node(s):`);
    for (const node of nodes) {
      console.log(`   - ${node.peer.hostName}: ${node.url}`);
    }
  } else {
    console.log('   No OpenClaw nodes found');
    console.log('   Ensure other machines have OpenClaw running with:');
    console.log('   - gateway.auth.allowTailscale = true');
  }

  console.log('\n4. Stopping...');
  await tailscale.stop();
  console.log('   ✓ Stopped');

  console.log('\n═══════════════════════════════════════════');
  console.log('Test complete!');
  console.log('═══════════════════════════════════════════\n');
}

testEmbeddedTailscale().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
