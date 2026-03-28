/**
 * Fix incorrect electron require in compiled JS
 * tsc-alias sometimes converts require('electron') to require('../electron')
 * which is wrong - 'electron' is an npm package, not a relative path
 */
const fs = require('fs');
const path = require('path');

const distElectron = path.join(__dirname, '..', 'dist', 'electron');

function walk(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith('.js')) {
      fixFile(full);
    }
  }
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  // Fix require('../electron'), require('../../electron'), etc. -> require('electron')
  // These are incorrectly converted by tsc-alias from require('electron') npm package
  const fixed = content.replace(/require\("(?:\.\.\/)+electron"\)/g, 'require("electron")');
  if (fixed !== content) {
    fs.writeFileSync(filePath, fixed);
    console.log('Fixed:', path.relative(distElectron, filePath));
  }
}

walk(distElectron);
console.log('Done fixing electron requires');
