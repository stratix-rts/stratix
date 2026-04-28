#!/usr/bin/env node
/**
 * 文档新鲜度检测脚本
 * 对比 docs/ 中提到的模块路径与该模块代码的最后修改时间
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DOCS_DIR = path.resolve(__dirname, '../docs');
const SRC_DIR = path.resolve(__dirname, '../src');

// 提取文档中提到的 src/ 路径（简单的正则匹配）
function extractModuleRefs(content) {
  const refs = [];
  // 匹配 `src/stratix-xxx` 或 `stratix-xxx`
  const matches = content.match(/(?:src\/)?stratix-[a-z-]+/g) || [];
  return [...new Set(matches)];
}

// 获取文件/目录的最后 git 修改时间
function getLastModified(targetPath) {
  try {
    const output = execSync(
      `git log -1 --format="%ct" -- "${targetPath}"`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '..') }
    ).trim();
    return output ? parseInt(output, 10) * 1000 : 0;
  } catch {
    return 0;
  }
}

function main() {
  const docs = fs.readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(DOCS_DIR, f));

  const results = [];

  for (const docPath of docs) {
    const content = fs.readFileSync(docPath, 'utf-8');
    const refs = extractModuleRefs(content);
    
    if (refs.length === 0) {
      results.push({ doc: path.basename(docPath), status: 'NO_REFS', refs: [], freshness: 'UNKNOWN' });
      continue;
    }

    const docMtime = getLastModified(docPath);
    let hasFreshCode = false;
    let hasOldCode = false;

    for (const ref of refs) {
      const modulePath = path.join(SRC_DIR, ref.replace('src/', ''));
      if (!fs.existsSync(modulePath)) continue;
      
      const codeMtime = getLastModified(modulePath);
      // 如果代码在文档之后有修改，说明文档可能过时
      if (codeMtime > docMtime + 86400000) { // 给1天缓冲
        hasFreshCode = true;
      } else {
        hasOldCode = true;
      }
    }

    let status;
    if (hasFreshCode && !hasOldCode) status = 'STALE';
    else if (hasFreshCode && hasOldCode) status = 'PARTIAL';
    else status = 'FRESH';

    results.push({
      doc: path.basename(docPath),
      status,
      refs,
      freshness: status === 'STALE' ? '⚠️ 可能过时' : status === 'PARTIAL' ? '⚠️ 部分过时' : '✅ 较新鲜'
    });
  }

  console.log('文档新鲜度检测报告\n');
  console.log('=' .repeat(80));
  
  const stale = results.filter(r => r.status === 'STALE');
  const partial = results.filter(r => r.status === 'PARTIAL');
  const fresh = results.filter(r => r.status === 'FRESH');
  const unknown = results.filter(r => r.status === 'NO_REFS');

  if (stale.length) {
    console.log('\n❌ 可能过时的文档（代码在文档后有大改动）：');
    stale.forEach(r => console.log(`   ${r.doc} → ${r.refs.join(', ')}`));
  }

  if (partial.length) {
    console.log('\n⚠️ 部分过时的文档（部分模块有改动）：');
    partial.forEach(r => console.log(`   ${r.doc} → ${r.refs.join(', ')}`));
  }

  if (fresh.length) {
    console.log('\n✅ 较新鲜的文档：');
    fresh.forEach(r => console.log(`   ${r.doc}`));
  }

  if (unknown.length) {
    console.log('\n❓ 未引用代码的文档（需人工判断）：');
    unknown.forEach(r => console.log(`   ${r.doc}`));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`总计: ${results.length} 份文档 | ❌ ${stale.length} | ⚠️ ${partial.length} | ✅ ${fresh.length} | ❓ ${unknown.length}`);
}

main();
