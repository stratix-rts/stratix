#!/usr/bin/env node
/**
 * UI Auto-Test v2 - More detailed interaction testing
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, '.ui-test-screenshots');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  if (fs.existsSync(SCREENSHOT_DIR)) fs.rmSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  // Collect ALL console messages
  const logs = [];
  page.on('console', msg => {
    logs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    logs.push(`[PAGE_ERROR] ${err.message}`);
  });

  console.log('Navigating...');
  await page.goto('http://localhost:7523', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);

  // Screenshot 1: initial
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-initial.png') });

  // Try to find and click zone drawing button
  const allButtons = await page.locator('button').allTextContents();
  console.log('Buttons found:', allButtons.filter(b => b.trim()).map(b => b.trim()));

  // Look for any zone-related button  
  const zoneButtons = await page.locator('button').all();
  let zoneBtnFound = false;
  for (const btn of zoneButtons) {
    const text = await btn.textContent();
    const ariaLabel = await btn.getAttribute('aria-label');
    const dataTestId = await btn.getAttribute('data-testid');
    if (text?.includes('Zone') || text?.includes('区域') || ariaLabel?.includes('zone') || dataTestId?.includes('zone')) {
      console.log(`Found zone button: "${text}" (aria: ${ariaLabel}, testid: ${dataTestId})`);
      await btn.click();
      zoneBtnFound = true;
      await sleep(500);
      break;
    }
  }

  if (!zoneBtnFound) {
    console.log('No zone button found, trying canvas direct interaction...');
  }

  // Screenshot 2: after zone button click
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-after-zone-btn.png') });

  // Draw zone on canvas
  const canvas = page.locator('canvas').first();
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box) {
      console.log(`Canvas at: ${box.x},${box.y} ${box.width}x${box.height}`);
      
      // Draw zone: click and drag
      const sx = box.x + 300, sy = box.y + 200;
      const ex = box.x + 600, ey = box.y + 450;
      
      await page.mouse.move(sx, sy);
      await sleep(100);
      await page.mouse.down();
      await sleep(100);
      
      for (let i = 0; i <= 20; i++) {
        await page.mouse.move(sx + (ex - sx) * i / 20, sy + (ey - sy) * i / 20);
        await sleep(30);
      }
      
      await page.mouse.up();
      await sleep(2000);
    }
  }

  // Screenshot 3: after zone draw
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-after-zone-draw.png') });

  // Right-click on canvas to test agent command
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 400, box.y + 300, { button: 'right' });
      await sleep(500);
    }
  }

  // Screenshot 4: after right-click
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-after-right-click.png') });

  // Print relevant logs
  console.log('\n=== RELEVANT LOGS ===');
  const relevant = logs.filter(l => 
    l.includes('zone') || l.includes('Zone') || l.includes('ERROR') || 
    l.includes('createProject') || l.includes('ProjectManager') || 
    l.includes('zone_created') || l.includes('panel') || l.includes('Panel')
  );
  for (const l of relevant.slice(-30)) {
    console.log(l);
  }

  // Save full log
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'console.log'), logs.join('\n'));
  console.log(`\nFull log saved to ${SCREENSHOT_DIR}/console.log`);

  await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
