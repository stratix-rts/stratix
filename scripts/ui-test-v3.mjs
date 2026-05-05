#!/usr/bin/env node
/**
 * UI Auto-Test v3 - Press Z to enter zone drawing mode, then draw
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, '.ui-test-screenshots');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true });
  fs.mkdirSync(DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[error] ${err.message}`));

  await page.goto('http://localhost:7523', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(5000); // Wait for full init

  await page.screenshot({ path: path.join(DIR, '01-loaded.png') });

  // Press Z to enter zone drawing mode
  const canvas = page.locator('canvas').first();
  // Focus canvas first by clicking on it
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(300);
    }
  }
  
  console.log('Pressing Z to enter zone drawing mode...');
  await page.keyboard.press('z');
  await sleep(1000);

  await page.screenshot({ path: path.join(DIR, '02-z-pressed.png') });

  // Now draw a zone by click-drag
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box) {
      // Draw in top-left area to avoid overlapping existing zones (which are centered ~529,451)
      const sx = box.x + 50, sy = box.y + 50;
      const ex = box.x + 250, ey = box.y + 200;
      
      await page.mouse.move(sx, sy);
      await sleep(100);
      await page.mouse.down();
      await sleep(100);
      
      for (let i = 0; i <= 20; i++) {
        await page.mouse.move(
          sx + (ex - sx) * i / 20,
          sy + (ey - sy) * i / 20
        );
        await sleep(30);
      }
      
      await page.mouse.up();
      console.log('Zone drawn, waiting for response...');
      await sleep(3000);
    }
  }

  await page.screenshot({ path: path.join(DIR, '03-zone-created.png') });

  // Right-click on canvas to test move command
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 500, box.y + 400, { button: 'right' });
      await sleep(1000);
    }
  }

  await page.screenshot({ path: path.join(DIR, '04-right-click.png') });

  // Double click on existing zone
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box) {
      // Double-click on an existing zone (we know one exists at ~529,451)
      const zx = box.x + 529;
      const zy = box.y + 451;
      await page.mouse.dblclick(zx, zy);
      await sleep(2000);
    }
  }

  await page.screenshot({ path: path.join(DIR, '05-double-click-zone.png') });

  // Print relevant logs
  const relevant = logs.filter(l =>
    l.toLowerCase().includes('zone') || l.toLowerCase().includes('error') ||
    l.toLowerCase().includes('project') || l.toLowerCase().includes('panel') ||
    l.toLowerCase().includes('created') || l.toLowerCase().includes('mode')
  );
  console.log('\n=== RELEVANT LOGS ===');
  for (const l of relevant.slice(-40)) {
    console.log(l);
  }

  fs.writeFileSync(path.join(DIR, 'console.log'), logs.join('\n'));
  
  // Check for issues
  const errors = logs.filter(l => l.includes('[error]'));
  const zoneCreated = logs.some(l => l.includes('zone_created') || l.includes('Zone created'));
  const panelOpened = logs.some(l => l.includes('openZonePanel') || l.includes('Zone panel'));
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Page errors: ${errors.length}`);
  console.log(`Zone created event: ${zoneCreated}`);
  console.log(`Panel opened: ${panelOpened}`);

  await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
