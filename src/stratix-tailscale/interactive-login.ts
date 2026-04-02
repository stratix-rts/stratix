import * as readline from 'readline';

import { EmbeddedTailscale } from './EmbeddedTailscale';

async function interactiveLogin() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   Tailscale Interactive Login            ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  const tailscale = new EmbeddedTailscale({
    openClawPort: 18789,
    hostname: 'stratix',
  });

  console.log('Starting embedded Tailscale...');
  await tailscale.start();

  const status = await tailscale.getStatus();
  console.log(`Status: ${status?.backendState}\n`);

  if (tailscale.needsAuthentication()) {
    console.log('Getting login URL...\n');
    
    // Try to get login URL via tailscale up --verbose
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('Please run this command in another terminal:');
    console.log('\n  tailscale up --socket=~/.stratix/tailscale/tailscaled.sock\n');
    console.log('Then open the URL shown.\n');

    console.log('Or get an auth key from:');
    console.log('https://login.tailscale.com/admin/settings/keys\n');

    rl.question('Press Enter after you have logged in...', async () => {
      rl.close();
      
      const newStatus = await tailscale.getStatus();
      console.log('\nStatus:', newStatus?.backendState);
      
      if (newStatus?.backendState === 'Running') {
        console.log('\n✓ Authenticated successfully!');
        console.log(`Self: ${newStatus.self.hostName} (${newStatus.self.dnsName})`);
        console.log(`Peers: ${newStatus.peers.length}`);

        console.log('\nDiscovering OpenClaw nodes...');
        const nodes = await tailscale.discoverOpenClawNodes();
        console.log(`Found ${nodes.length} healthy nodes`);
        for (const node of nodes) {
          console.log(`  - ${node.peer.hostName}: ${node.url}`);
        }
      } else {
        console.log('\n✗ Still not authenticated');
      }

      await tailscale.stop();
    });
  } else {
    console.log('✓ Already authenticated');
    await tailscale.stop();
  }
}

interactiveLogin().catch(console.error);
