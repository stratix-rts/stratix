#!/usr/bin/env node
/**
 * Design System Token Migration Script
 * 将 Vue 组件中的硬编码样式替换为设计系统 CSS 变量
 */

const fs = require('fs');
const path = require('path');

const TARGET_DIRS = [
  'src/components/ui',
  'src/components',
  'src/stratix-project/ui',
  'src/stratix-command-panel/components',
  'src/stratix-designer/components',
  'src/stratix-blueprint/ui',
  'src/stratix-rts/ui',
];

// 替换规则（按优先级排序，更具体的模式先匹配）
const REPLACEMENTS = [
  // ====== Font Family ======
  {
    pattern: /font-family:\s*'SF Mono',\s*'Monaco',\s*'Inconsolata',\s*'Fira Mono',\s*monospace/g,
    replacement: 'font-family: var(--ds-font-mono)',
    category: 'font',
  },
  {
    pattern: /font-family:\s*'SF Mono',\s*'Monaco',\s*monospace/g,
    replacement: 'font-family: var(--ds-font-mono)',
    category: 'font',
  },
  {
    pattern: /font-family:\s*'Monaco',\s*'Menlo',\s*monospace/g,
    replacement: 'font-family: var(--ds-font-mono)',
    category: 'font',
  },
  {
    pattern: /font-family:\s*'Monaco',\s*'Menlo',\s*'Courier New',\s*monospace/g,
    replacement: 'font-family: var(--ds-font-mono)',
    category: 'font',
  },
  {
    pattern: /font-family:\s*'Monaco',\s*'Menlo',\s*'Ubuntu Mono',\s*monospace/g,
    replacement: 'font-family: var(--ds-font-mono)',
    category: 'font',
  },
  {
    pattern: /font-family:\s*'Fira Code',\s*monospace/g,
    replacement: 'font-family: var(--ds-font-mono)',
    category: 'font',
  },
  {
    pattern: /font-family:\s*monospace/g,
    replacement: 'font-family: var(--ds-font-mono)',
    category: 'font',
  },
  {
    pattern: /font-family:\s*'Fira Sans',\s*sans-serif/g,
    replacement: 'font-family: var(--ds-font-sans)',
    category: 'font',
  },

  // ====== Border Radius ======
  {
    pattern: /border-radius:\s*0\s*;/g,
    replacement: 'border-radius: var(--ds-radius-none);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*2px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-sm);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*3px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-sm);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*4px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-sm);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*6px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-md);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*8px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-md);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*10px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-lg);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*12px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-lg);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*16px\s*;/g,
    replacement: 'border-radius: var(--ds-radius-xl);',
    category: 'radius',
  },
  {
    pattern: /border-radius:\s*50%\s*;/g,
    replacement: 'border-radius: var(--ds-radius-full);',
    category: 'radius',
  },

  // ====== Box Shadow（纯黑/灰阴影）======
  {
    pattern: /box-shadow:\s*0\s+1px\s+2px\s+rgba\(0,\s*0,\s*0,\s*0\.05\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-sm);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+1px\s+2px\s+rgba\(0,\s*0,\s*0,\s*0\.1\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-sm);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+1px\s+3px\s+rgba\(0,\s*0,\s*0,\s*0\.1\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-sm);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+2px\s+4px\s+rgba\(0,\s*0,\s*0,\s*0\.2\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-sm);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+2px\s+8px\s+rgba\(0,\s*0,\s*0,\s*0\.2\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-md);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+4px\s+8px\s+rgba\(0,\s*0,\s*0,\s*0\.3\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-md);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+4px\s+12px\s+rgba\(0,\s*0,\s*0,\s*0\.15\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-md);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+4px\s+12px\s+rgba\(0,\s*0,\s*0,\s*0\.3\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-md);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+4px\s+16px\s+rgba\(0,\s*0,\s*0,\s*0\.4\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-lg);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+8px\s+16px\s+rgba\(0,\s*0,\s*0,\s*0\.5\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-lg);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+8px\s+16px\s+rgba\(0,\s*0,\s*0,\s*0\.6\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-lg);',
    category: 'shadow',
  },
  {
    pattern: /box-shadow:\s*0\s+20px\s+40px\s+rgba\(0,\s*0,\s*0,\s*0\.3\)\s*;/g,
    replacement: 'box-shadow: var(--ds-shadow-xl);',
    category: 'shadow',
  },

  // ====== Padding（单一值，精确匹配）======
  {
    pattern: /padding:\s*4px\s*;/g,
    replacement: 'padding: var(--ds-spacing-xs);',
    category: 'spacing',
  },
  {
    pattern: /padding:\s*8px\s*;/g,
    replacement: 'padding: var(--ds-spacing-sm);',
    category: 'spacing',
  },
  {
    pattern: /padding:\s*16px\s*;/g,
    replacement: 'padding: var(--ds-spacing-md);',
    category: 'spacing',
  },
  {
    pattern: /padding:\s*24px\s*;/g,
    replacement: 'padding: var(--ds-spacing-lg);',
    category: 'spacing',
  },
  {
    pattern: /padding:\s*32px\s*;/g,
    replacement: 'padding: var(--ds-spacing-xl);',
    category: 'spacing',
  },
  {
    pattern: /padding:\s*48px\s*;/g,
    replacement: 'padding: var(--ds-spacing-2xl);',
    category: 'spacing',
  },

  // ====== Gap（单一值，精确匹配）======
  {
    pattern: /gap:\s*4px\s*;/g,
    replacement: 'gap: var(--ds-spacing-xs);',
    category: 'spacing',
  },
  {
    pattern: /gap:\s*8px\s*;/g,
    replacement: 'gap: var(--ds-spacing-sm);',
    category: 'spacing',
  },
  {
    pattern: /gap:\s*16px\s*;/g,
    replacement: 'gap: var(--ds-spacing-md);',
    category: 'spacing',
  },
  {
    pattern: /gap:\s*24px\s*;/g,
    replacement: 'gap: var(--ds-spacing-lg);',
    category: 'spacing',
  },
  {
    pattern: /gap:\s*32px\s*;/g,
    replacement: 'gap: var(--ds-spacing-xl);',
    category: 'spacing',
  },
  {
    pattern: /gap:\s*48px\s*;/g,
    replacement: 'gap: var(--ds-spacing-2xl);',
    category: 'spacing',
  },
];

function findVueFiles(dir, files = []) {
  const fullDir = path.resolve(dir);
  if (!fs.existsSync(fullDir)) return files;
  
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
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

  // 找到 <style> 块的范围
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

  // 只在 <style> 块内做替换
  for (const range of styleRanges) {
    let styleContent = range.content;
    let styleModified = false;

    for (const rule of REPLACEMENTS) {
      const original = styleContent;
      styleContent = styleContent.replace(rule.pattern, rule.replacement);
      if (styleContent !== original) {
        styleModified = true;
        const count = (original.match(rule.pattern) || []).length;
        changes.push({
          file: path.relative(process.cwd(), filePath),
          category: rule.category,
          count,
          example: rule.replacement,
        });
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

// 主流程
console.log('🔧 Design System Token Migration\n');

const allFiles = [];
for (const dir of TARGET_DIRS) {
  allFiles.push(...findVueFiles(dir));
}

// 去重
const uniqueFiles = [...new Set(allFiles)];
console.log(`Found ${uniqueFiles.length} Vue files to process\n`);

const allChanges = [];
let changedFiles = 0;

for (const file of uniqueFiles) {
  const result = processFile(file);
  if (result.changed) {
    changedFiles++;
    allChanges.push(...result.changes);
  }
}

// 汇总报告
const summary = {};
for (const change of allChanges) {
  if (!summary[change.category]) summary[change.category] = 0;
  summary[change.category] += change.count;
}

console.log(`✅ Modified ${changedFiles} files`);
console.log(`📊 Replacements by category:`);
for (const [cat, count] of Object.entries(summary)) {
  console.log(`   ${cat}: ${count}`);
}
console.log(`\nTotal replacements: ${Object.values(summary).reduce((a, b) => a + b, 0)}`);
