#!/usr/bin/env node
/**
 * Generate ground tile sheets for all themes from source assets.
 * Copies GrassAssests tile sheets to public/rts-textures/{theme}/ground_base.png
 *
 * Source assets (4x3 grid of 32x32 tiles = 128x96):
 *   fantasy   -> Sprite_Tiles_GreenGrassland.png
 *   cartoon   -> Sprite_Tiles_whiteGrassland.png
 *   cyberpunk -> Sprite_Tiles_BottleGreenGrassland.png
 *   nature    -> Sprite_Tiles_YellowGrassland.png
 */

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'GrassAssests');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'rts-textures');

const THEME_MAP = {
  fantasy: 'Sprite_Tiles_GreenGrassland.png',
  cartoon: 'Sprite_Tiles_whiteGrassland.png',
  cyberpunk: 'Sprite_Tiles_BottleGreenGrassland.png',
  nature: 'Sprite_Tiles_YellowGrassland.png',
};

function generate() {
  console.log('Generating ground tile sheets...\n');

  for (const [theme, filename] of Object.entries(THEME_MAP)) {
    const src = path.join(ASSETS_DIR, filename);
    const dstDir = path.join(OUTPUT_DIR, theme);
    const dst = path.join(dstDir, 'ground_base.png');

    if (!fs.existsSync(src)) {
      console.error(`  ❌ Source not found: ${src}`);
      continue;
    }

    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    fs.copyFileSync(src, dst);
    console.log(`  ✅ ${theme}: ${filename} -> ${dst}`);
  }

  console.log('\nDone!');
}

generate();
