/**
 * 迁移测试断言：core 零 IO 铁律（task_177 / M1-03 · design §7.1 M1-03 行验收①）。
 *
 * 断言：`src/core/` 全目录的**生产代码**里，`fs` / `sqlite` / `persistence` 的**实际 import 数恒为 0**。
 *   —— 这是「切副本」这条迁移线的前提：core 只做**裁决**，所有 IO 经由 app 层注入的端口完成
 *      （design §1.2.5 端口注入方案）。core 一旦自己 import fs，
 *      裁决就会与 IO 缠在一起，端口注入方案当场失效。
 *
 * 为什么断言放在 core 之外（tests/migration/）：本测试自身要读源码 ⇒ 自身就得 import fs。
 *   放在 src/core/ 里会让「core 目录里 fs 的 import 数」自证自扰。
 *
 * 为什么**排除测试文件**：测试读源码是正当的（既有先例：src/core/theme/__tests__/visual-spec.test.ts
 *   扫源码断言「色值只此一份」）；铁律约束的是**生产代码**——它才是会被打进产物、
 *   才会真的在渲染进程里碰到文件系统的那一份。
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const CORE_DIR = path.join(REPO_ROOT, 'src', 'core');

/** 命中即视为 IO 依赖的模块名（core 一律不许碰）。 */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^(node:)?fs(\/.*)?$/, // fs / node:fs / fs/promises
  /^(node:)?sqlite3?$/, // sqlite3 / node:sqlite
  /^better-sqlite3$/, // 落库用的 sqlite 驱动
  /persistence/, // app 层持久化目录（相对路径引入也算）
];

/** 递归收集目录下的 .ts 文件。 */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 测试文件不进「生产代码」口径（见文件头注）。 */
function isTestFile(file: string): boolean {
  return file.includes(`${path.sep}__tests__${path.sep}`) || file.endsWith('.test.ts');
}

/** 抓出文件里所有 import / require 的模块名（静态 + 动态）。 */
function importedSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g, // import ... from 'x'
    /\bimport\s+['"]([^'"]+)['"]/g, // import 'x'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // await import('x')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('x')
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match !== null) {
      specs.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return specs;
}

interface Violation {
  readonly file: string;
  readonly specifier: string;
}

describe('core 零 IO 铁律（迁移断言）', () => {
  test('src/core/ 生产代码里 fs / sqlite / persistence 的实际 import 数为 0', () => {
    const violations: Violation[] = [];

    for (const file of collectTsFiles(CORE_DIR)) {
      if (isTestFile(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of importedSpecifiers(source)) {
        if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(specifier))) {
          violations.push({ file: path.relative(REPO_ROOT, file), specifier });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('core 里没有落地实现（端口实现由 app 层注入）', () => {
    // 端口只有形状：core 侧只能出现类型引用，不得出现端口实现类。
    const offenders: string[] = [];
    for (const file of collectTsFiles(CORE_DIR)) {
      if (isTestFile(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (/class\s+\w*(Loader|Archive)\w*Port/.test(source)) offenders.push(path.relative(REPO_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});
