/**
 * Playwright script: render BuildingTextureGenerator textures to PNGs
 * Usage: npx playwright test scripts/render-textures.ts --config=...
 * Or: node -e "require('playwright').chromium.launch().then(...)"
 */
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const OUT_DIR = path.join(__dirname, '..', 'texture-previews');

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const htmlPath = path.join(__dirname, 'preview-textures.html');
  await page.goto(`file://${htmlPath}`);
  
  // Wait for rendering to complete
  await page.waitForTimeout(1000);

  // Screenshot individual tiles with type prefix
  const types = ['data-center', 'workshop', 'studio', 'library', 'command'];
  const faces = ['wall', 'roof', 'foundation'];
  const states = ['lit', 'dim'];
  const tiles = await page.$$('.tile');
  console.log(`Found ${tiles.length} tiles`);

  // First 30 tiles = single textures (5 types × 3 faces × 2 states)
  // Next 30 tiles = 2x2 tiling preview
  let singleIdx = 0;
  let tilingIdx = 0;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const canvas = await tile.$('canvas');
    if (!canvas) continue;

    let filename: string;
    if (i < 30) {
      // Single texture
      const typeIdx = Math.floor(singleIdx / 6);
      const faceIdx = Math.floor((singleIdx % 6) / 2);
      const stateIdx = singleIdx % 2;
      filename = `${types[typeIdx]}-${faces[faceIdx]}-${states[stateIdx]}.png`;
      singleIdx++;
    } else {
      // Tiling preview
      const typeIdx = Math.floor(tilingIdx / 6);
      const faceIdx = Math.floor((tilingIdx % 6) / 2);
      const stateIdx = tilingIdx % 2;
      filename = `tile-${types[typeIdx]}-${faces[faceIdx]}-${states[stateIdx]}.png`;
      tilingIdx++;
    }

    const filepath = path.join(OUT_DIR, filename);
    await canvas.screenshot({ path: filepath });
    console.log(`Saved: ${filename}`);
  }

  // Also screenshot the full page for overview
  await page.screenshot({ 
    path: path.join(OUT_DIR, 'full-overview.png'), 
    fullPage: true 
  });
  console.log('Saved: full-overview.png');

  await browser.close();
  console.log('Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
