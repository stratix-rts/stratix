#!/usr/bin/env node

/**
 * agency-agents 导入脚本
 *
 * 用法:
 *   npx ts-node scripts/import-agency-agents.ts
 *   npx ts-node scripts/import-agency-agents.ts --path /path/to/agency-agents
 *   npx ts-node scripts/import-agency-agents.ts --clone
 *   npx ts-node scripts/import-agency-agents.ts --save ./templates.json
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { EnhancedTemplateLibrary } from '../src/stratix-data-store/EnhancedTemplateLibrary';

// 配置
const AGENCY_AGENTS_REPO = 'https://github.com/hotjp/agency-agents.git';
const DEFAULT_TEMP_DIR = path.join(process.cwd(), 'temp', 'agency-agents');
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'stratix-data', 'templates');

interface CLIOptions {
  path?: string;
  clone?: boolean;
  save?: string;
  load?: string;
  clear?: boolean;
}

/**
 * 解析命令行参数
 */
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--path':
      case '-p':
        options.path = args[++i];
        break;
      case '--clone':
      case '-c':
        options.clone = true;
        break;
      case '--save':
      case '-s':
        options.save = args[++i];
        break;
      case '--load':
      case '-l':
        options.load = args[++i];
        break;
      case '--clear':
        options.clear = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

/**
 * 打印帮助信息
 */
function printHelp(): void {
  console.log(`
agency-agents 导入脚本

用法:
  npx ts-node scripts/import-agency-agents.ts [选项]

选项:
  --path, -p <path>    指定 agency-agents 目录路径
  --clone, -c          克隆仓库到临时目录
  --save, -s <file>    导出模板到文件
  --load, -l <file>    从文件加载模板
  --clear              清空现有模板
  --help, -h           显示帮助信息

示例:
  # 克隆并导入所有模板
  npx ts-node scripts/import-agency-agents.ts --clone

  # 使用本地目录
  npx ts-node scripts/import-agency-agents.ts --path /path/to/agency-agents

  # 导出到文件
  npx ts-node scripts/import-agency-agents.ts --clone --save ./templates.json

  # 从文件加载
  npx ts-node scripts/import-agency-agents.ts --load ./templates.json
`);
}

/**
 * 克隆仓库
 */
function cloneRepo(targetDir: string): void {
  console.log(`正在克隆 ${AGENCY_AGENTS_REPO}...`);

  // 确保目标目录存在
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  // 如果目录已存在，先删除
  if (fs.existsSync(targetDir)) {
    console.log('目录已存在，正在删除...');
    fs.rmSync(targetDir, { recursive: true });
  }

  try {
    execSync(`git clone ${AGENCY_AGENTS_REPO} ${targetDir}`, {
      stdio: 'inherit',
    });
    console.log('克隆完成!');
  } catch (error) {
    console.error('克隆失败:', error);
    process.exit(1);
  }
}

/**
 * 导入模板
 */
async function importTemplates(sourcePath: string, library: EnhancedTemplateLibrary): Promise<void> {
  console.log(`正在从 ${sourcePath} 导入模板...`);

  if (!fs.existsSync(sourcePath)) {
    console.error(`路径不存在: ${sourcePath}`);
    process.exit(1);
  }

  const result = await library.importFromDirectory(sourcePath);

  console.log('\n导入结果:');
  console.log(`  成功: ${result.imported}`);
  console.log(`  跳过: ${result.skipped}`);
  console.log(`  失败: ${result.failed}`);

  if (result.errors.length > 0) {
    console.log('\n错误:');
    result.errors.forEach(e => console.log(`  - ${e}`));
  }

  // 显示统计
  const stats = library.getStats();
  console.log('\n模板统计:');
  console.log(`  总数: ${stats.total}`);
  console.log('  按领域:');
  for (const [domain, count] of Object.entries(stats.byDomain)) {
    if (count > 0) {
      console.log(`    ${domain}: ${count}`);
    }
  }
}

/**
 * 保存模板到文件
 */
async function saveTemplates(filePath: string, library: EnhancedTemplateLibrary): Promise<void> {
  console.log(`正在保存模板到 ${filePath}...`);

  await library.saveToFile(filePath);

  console.log('保存完成!');
}

/**
 * 从文件加载模板
 */
async function loadTemplates(filePath: string, library: EnhancedTemplateLibrary): Promise<void> {
  console.log(`正在从 ${filePath} 加载模板...`);

  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    process.exit(1);
  }

  const count = await library.loadFromFile(filePath);
  console.log(`加载了 ${count} 个模板`);
}

/**
 * 打印模板列表
 */
function printTemplateList(library: EnhancedTemplateLibrary): void {
  const templates = library.getAllTemplates();

  console.log(`\n模板列表 (${templates.length} 个):\n`);

  // 按领域分组显示
  const byDomain = library.getTemplatesByDomain();
  for (const [domain, domainTemplates] of byDomain) {
    if (domainTemplates.length === 0) continue;

    console.log(`\n## ${domain} (${domainTemplates.length})`);

    for (const template of domainTemplates.slice(0, 5)) {
      console.log(`  - ${template.name} (${template.id})`);
    }

    if (domainTemplates.length > 5) {
      console.log(`  ... 还有 ${domainTemplates.length - 5} 个`);
    }
  }

  // 显示分类
  console.log('\n\n## 分类');
  const categories = library.getCategories();
  for (const cat of categories) {
    console.log(`  ${cat.name}: ${cat.count} 个`);
  }

  // 显示热门标签
  console.log('\n\n## 热门标签');
  const popularTags = library.getPopularTags(10);
  console.log('  ' + popularTags.map(t => `${t.tag}(${t.count})`).join(', '));
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  agency-agents 导入工具');
  console.log('═'.repeat(60));
  console.log();

  const options = parseArgs();

  // 创建模板库
  const library = new EnhancedTemplateLibrary(DEFAULT_OUTPUT_DIR);

  // 清空现有模板
  if (options.clear) {
    console.log('正在清空现有模板...');
    library.clear();
    console.log('清空完成');
  }

  // 从文件加载
  if (options.load) {
    await loadTemplates(options.load, library);
  }

  // 克隆并导入
  if (options.clone) {
    cloneRepo(DEFAULT_TEMP_DIR);
    await importTemplates(DEFAULT_TEMP_DIR, library);
  } else if (options.path) {
    await importTemplates(options.path, library);
  }

  // 保存到文件
  if (options.save) {
    await saveTemplates(options.save, library);
  }

  // 显示结果
  printTemplateList(library);

  console.log('\n完成!');
}

main().catch(console.error);
