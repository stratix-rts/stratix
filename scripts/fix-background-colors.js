#!/usr/bin/env node
/**
 * Fix hardcoded background colors in Vue components
 * Replace rgba(...) with color-mix using design system tokens
 */

const fs = require('fs');
const path = require('path');

// Mapping of hardcoded rgba colors to color-mix expressions
// Only process <style> blocks
const REPLACEMENTS = [
  // Black semi-transparent → bg-base based
  { pattern: /background:\s*rgba\(0,\s*0,\s*0,\s*0\.85\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-base) 85%, transparent)' },
  { pattern: /background:\s*rgba\(0,\s*0,\s*0,\s*0\.2\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-base) 20%, transparent)' },
  { pattern: /background:\s*rgba\(0,\s*0,\s*0,\s*0\.3\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-base) 30%, transparent)' },
  
  // White semi-transparent → bg-elevated based
  { pattern: /background:\s*rgba\(255,\s*255,\s*255,\s*0\.03\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-elevated) 3%, transparent)' },
  { pattern: /background:\s*rgba\(255,\s*255,\s*255,\s*0\.05\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-elevated) 5%, transparent)' },
  { pattern: /background:\s*rgba\(255,\s*255,\s*255,\s*0\.1\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-elevated) 10%, transparent)' },
  
  // Cyberpunk specific dark colors → bg-base based
  { pattern: /background:\s*rgba\(13,\s*13,\s*20,\s*0\.85\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-base) 85%, transparent)' },
  { pattern: /background:\s*rgba\(30,\s*30,\s*50,\s*0\.9\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-base) 90%, transparent)' },
  { pattern: /background:\s*rgba\(20,\s*20,\s*40,\s*0\.85\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-base) 85%, transparent)' },
  { pattern: /background:\s*rgba\(50,\s*50,\s*80,\s*0\.95\)/g, replacement: 'background: color-mix(in srgb, var(--ds-bg-base) 95%, transparent)' },
  
  // Cyan/info semi-transparent → status-info based
  { pattern: /background:\s*rgba\(0,\s*212,\s*255,\s*0\.05\)/g, replacement: 'background: color-mix(in srgb, var(--ds-status-info) 5%, transparent)' },
  { pattern: /background:\s*rgba\(0,\s*212,\s*255,\s*0\.1\)/g, replacement: 'background: color-mix(in srgb, var(--ds-status-info) 10%, transparent)' },
  { pattern: /background:\s*rgba\(0,\s*212,\s*255,\s*0\.2\)/g, replacement: 'background: color-mix(in srgb, var(--ds-status-info) 20%, transparent)' },
  
  // Blue semi-transparent → status-info based
  { pattern: /background:\s*rgba\(59,\s*130,\s*246,\s*0\.1\)/g, replacement: 'background: color-mix(in srgb, var(--ds-status-info) 10%, transparent)' },
  { pattern: /background:\s*rgba\(59,\s*130,\s*246,\s*0\.2\)/g, replacement: 'background: color-mix(in srgb, var(--ds-status-info) 20%, transparent)' },
  { pattern: /background:\s*rgba\(59,\s*130,\s*246,\s*0\.3\)/g, replacement: 'background: color-mix(in srgb, var(--ds-status-info) 30%, transparent)' },
  
  // Amber/warning semi-transparent → status-warning based
  { pattern: /background:\s*rgba\(245,\s*158,\s*11,\s*0\.1\)/g, replacement: 'background: color-mix(in srgb, var(--ds-status-warning) 10%, transparent)' },
  
  // Hardcoded hex colors in specific components
  { pattern: /background:\s*#1a1a2e/g, replacement: 'background: var(--ds-bg-overlay)' },
];

function findVueFiles(dir, files = []) {
  const fullDir = path.resolve(dir);
  if (!fs.existsSync(fullDir)) return files;
  
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      findVueFiles(fullPath, files);
    } else if (entry.name.endsWith('.vue')) {
      files.push(fullPath);
    }
  }
  return files;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let modified = content;
  let hasChanges = false;
  const changes = [];

  // Find <style> blocks
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let match;
  const styleRanges = [];
  while ((match = styleRegex.exec(content)) !== null) {
    styleRanges.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[1],
    });
  }

  if (styleRanges.length === 0) return { changed: false, changes: [] };

  for (const range of styleRanges) {
    let styleContent = range.content;
    let styleModified = false;

    for (const rule of REPLACEMENTS) {
      const original = styleContent;
      styleContent = styleContent.replace(rule.pattern, rule.replacement);
      if (styleContent !== original) {
        styleModified = true;
        const count = (original.match(rule.pattern) || []).length;
        if (count > 0) {
          changes.push({ file: path.relative(process.cwd(), filePath), count, type: rule.replacement });
        }
      }
    }

    if (styleModified) {
      hasChanges = true;
      const beforeStyle = modified.substring(0, range.start);
      const afterStyle = modified.substring(range.end);
      const newStyleBlock = modified.substring(range.start, range.end).replace(range.content, styleContent);
      modified = beforeStyle + newStyleBlock + afterStyle;
    }
  }

  if (hasChanges) {
    fs.writeFileSync(filePath, modified, 'utf-8');
  }

  return { changed: hasChanges, changes };
}

// Main
console.log('🔧 Fixing hardcoded background colors\n');

const allFiles = findVueFiles('src');
console.log(`Found ${allFiles.length} Vue files\n`);

let changedFiles = 0;
let totalReplacements = 0;

for (const file of allFiles) {
  const result = processFile(file);
  if (result.changed) {
    changedFiles++;
    totalReplacements += result.changes.reduce((sum, c) => sum + c.count, 0);
  }
}

console.log(`✅ Modified ${changedFiles} files`);
console.log(`📊 Total replacements: ${totalReplacements}`);
