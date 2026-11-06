/**
 * 文件职责：**架构铁律静态扫描器**（@since v3.3，task_222 / QA-02）。
 *
 *   五条铁律（口径出处：docs/REFACTOR_PLAN_V3.md §1「通信规则（铁律）」+ docs/DESIGN-dsh-bridge.md
 *   「core 是零 IO 纯逻辑层」+ CLAUDE.md「core 域零 IO / 契约全在 src/core/types.ts」）：
 *     LAW-1  hud ↔ world 互不 import —— 一切走 core 契约（总线铁律）
 *     LAW-2  core 零 IO —— 不直读 fs / net / process.env（core 是纯逻辑层）
 *     LAW-3  pixelfx 的名字不出现在 core —— 第三方库的知识不漏进 core
 *     LAW-4  pixelfx 管线 ↔ CharacterComposer 管线互不引用（双管线各自闭环）
 *     LAW-5  契约单一事实源 —— core 的契约名在仓库内不得有第二处**独立**定义（防漂移）
 *
 *   输入：仓库根目录。
 *   输出：ScanReport —— 每条铁律一条 LawResult，findings 是违规清单（空 = 通过）。
 *   禁止事项：
 *     1. 在这里修产品代码 —— 本模块只**报告**；修不修、怎么修是别的单的事；
 *     2. 用正则硬啃 import —— 解析走 TypeScript AST：注释掉的 import、字符串里的路径都不算数；
 *     3. 把「豁免」藏在本模块里 —— 豁免清单是独立文件（law-waivers.ts），账实要对得上；
 *     4. 静默跳过解析不出来的相对路径 —— 解析不出来一律当外部依赖（.vue / .css / 资源），
 *        只在确实是仓内源码却解析失败时放过（不误报），绝不因此崩掉整轮扫描。
 */

import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

export type LawId = 'LAW-1' | 'LAW-2' | 'LAW-3' | 'LAW-4' | 'LAW-5';

/** 一条违规。file 是仓库相对路径（posix 分隔），line 是 1 基行号。 */
export interface LawFinding {
  readonly lawId: LawId;
  readonly file: string;
  readonly line: number;
  /** 违规符号（模块规格 / 标识符 / 契约名），用于与豁免账本对齐。 */
  readonly symbol: string;
  readonly message: string;
}

/** 一条铁律的扫描结果。 */
export interface LawResult {
  readonly lawId: LawId;
  readonly title: string;
  /** 规则原文（人可读，报告里直接打出来）。 */
  readonly rule: string;
  readonly findings: readonly LawFinding[];
}

/** 一轮扫描的完整报告。 */
export interface ScanReport {
  readonly repoRoot: string;
  readonly results: readonly LawResult[];
}

/* ------------------------------------------------------------------ *
 * 常量：铁律口径
 * ------------------------------------------------------------------ */

/** core 域目录（仓库相对，posix）。 */
const CORE_DIR = 'src/core';
/** HUD 层目录。 */
const HUD_DIR = 'src/hud';
/** world 层目录。 */
const WORLD_DIR = 'src/world';
/** 契约面（总线契约的唯一事实源）。 */
const CONTRACT_FILE = 'src/core/types.ts';

/**
 * LAW-2：core 里不许直读的模块前缀（fs / net / 落库 一族）。
 * why 用前缀而不是精确名：`fs-extra`、`fs/promises`、`node:fs` 都是同一个「文件 IO」语义，
 *   只挡 `fs` 一个名字等于没挡。命中规则 = 去掉 `node:` 后与前缀**全等**或以 `前缀/` 开头。
 */
const BANNED_MODULE_PREFIXES: readonly string[] = [
  'fs',
  'fs-extra',
  'graceful-fs',
  'net',
  'http',
  'https',
  'child_process',
  'os',
  'dgram',
  'tls',
  'worker_threads',
  'cluster',
  'stream',
  'readline',
  'axios',
  'undici',
  'node-fetch',
  'ws',
  'express',
  'fastify',
  'socket.io',
  'electron',
  'better-sqlite3',
  'sql.js',
  'lowdb',
  'chokidar',
];

/** LAW-2：core 里不许直接用的浏览器 / 网络全局（DOM 与网络出口）。 */
const BANNED_GLOBALS: ReadonlySet<string> = new Set([
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'navigator',
  'fetch',
  'WebSocket',
  'XMLHttpRequest',
  'EventSource',
  'sendBeacon',
]);

/** LAW-4：pixelfx 管线的实现文件（仓库相对）。 */
const PIXELFX_PIPELINE_FILES: readonly string[] = [
  'src/app/fx/fx-code-pixelfx.ts',
  'src/app/fx/code-fx-sources.ts',
  'src/app/dev/fx-code-dev-main.ts',
];

/** LAW-4：CharacterComposer 管线的实现文件（仓库相对）。 */
const COMPOSER_PIPELINE_FILES: readonly string[] = [
  'src/world/appearance/character-composer.ts',
  'src/app/services/character-bake-service.ts',
  'src/app/services/unit-sprite-source.ts',
  'src/app/services/appearance-preview-service.ts',
  'src/app/services/appearance-preview-game.ts',
  'src/app/services/appearance-environment.ts',
  'src/app/services/character-bake-store.ts',
];

/**
 * LAW-4：装配点（composition root）—— 唯一允许同时认识两条管线的地方。
 * why 允许：app 层的组合根本就是「把各路实现接起来」的位置（core 契约 + world 渲染 + hud 面板
 *   都在这儿汇合），它同时认识 pixelfx 与 CharacterComposer 是**职责所在**，不是越界。
 *   但装配点**不许**让管线实现彼此引用（那条照样查）。
 */
const COMPOSITION_ROOTS: readonly string[] = ['src/app/main/main-entry.ts'];

/* ------------------------------------------------------------------ *
 * 基础设施
 * ------------------------------------------------------------------ */

/** 仓库相对路径（posix 分隔）。 */
function toRepoPath(repoRoot: string, absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

/** 目标是否在某个目录之下。 */
function isUnder(absPath: string, absDir: string): boolean {
  const rel = path.relative(absDir, absPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 递归列目录下的 .ts / .tsx（不含 .d.ts）。 */
function listTsFiles(absDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      out.push(abs);
    }
  };
  walk(absDir);
  return out.sort();
}

/** 一个文件的解析结果（懒解析，用到才建）。 */
interface ParsedFile {
  readonly absPath: string;
  readonly relPath: string;
  readonly text: string;
  readonly sf: ts.SourceFile;
}

/** 一处 import 引用。 */
interface ImportRef {
  /** 模块规格原文。 */
  readonly spec: string;
  /** 引用所在节点（取行号用）。 */
  readonly node: ts.Node;
}

/** 仓库索引：文件清单 + 解析缓存。 */
export class RepoIndex {
  private readonly cache = new Map<string, ParsedFile>();

  constructor(readonly repoRoot: string) {}

  /** 目录下的 .ts 文件（仓库相对 posix 路径）。 */
  filesUnder(relDir: string): string[] {
    return listTsFiles(path.join(this.repoRoot, relDir)).map((abs) => toRepoPath(this.repoRoot, abs));
  }

  /** 全部源码文件（src/ + scripts/，仓库相对 posix 路径）。 */
  allSourceFiles(): string[] {
    const out: string[] = [];
    for (const dir of ['src', 'scripts']) {
      const abs = path.join(this.repoRoot, dir);
      if (!fs.existsSync(abs)) continue;
      out.push(...listTsFiles(abs).map((f) => toRepoPath(this.repoRoot, f)));
    }
    return out;
  }

  /** 取（并缓存）一个文件的解析结果。 */
  parse(relPath: string): ParsedFile | null {
    const cached = this.cache.get(relPath);
    if (cached) return cached;
    const abs = path.join(this.repoRoot, relPath);
    if (!fs.existsSync(abs)) return null;
    const text = fs.readFileSync(abs, 'utf8');
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const parsed: ParsedFile = { absPath: abs, relPath, text, sf };
    this.cache.set(relPath, parsed);
    return parsed;
  }

  /** 文件里的全部 import 引用（静态 import / export from / import() / require()）。 */
  importsOf(relPath: string): ImportRef[] {
    const parsed = this.parse(relPath);
    if (!parsed) return [];
    const refs: ImportRef[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const spec = moduleSpecifierOf(node);
        if (spec !== null) refs.push({ spec, node });
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const spec = literalText(node.moduleReference.expression);
        if (spec !== null) refs.push({ spec, node });
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
        const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
        if (isRequire || isDynamicImport) {
          const spec = literalText(node.arguments[0]);
          if (spec !== null) refs.push({ spec, node });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(parsed.sf, visit);
    return refs;
  }

  /**
   * 解析模块规格到仓库内文件（相对路径 + '@/' 别名 + '@stratix-core/' 别名）。
   * 解析不出来返回 null（外部依赖 / 资源 / 无法解析的路径）。
   */
  resolve(fromRelPath: string, spec: string): string | null {
    let base: string | null = null;
    if (spec.startsWith('.')) {
      base = path.resolve(path.dirname(path.join(this.repoRoot, fromRelPath)), spec);
    } else if (spec.startsWith('@/')) {
      base = path.join(this.repoRoot, 'src', spec.slice(2));
    } else if (spec.startsWith('@stratix-core/')) {
      base = path.join(this.repoRoot, 'src/stratix-core', spec.slice('@stratix-core/'.length));
    } else {
      return null;
    }
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return toRepoPath(this.repoRoot, candidate);
        }
      } catch {
        /* 忽略：读不到就当解析不出来 */
      }
    }
    return null;
  }
}

/** 取 import/export from 的模块规格文本。 */
function moduleSpecifierOf(node: ts.ImportDeclaration | ts.ExportDeclaration): string | null {
  if (!node.moduleSpecifier) return null;
  return literalText(node.moduleSpecifier);
}

/** 取字符串字面量的文本（非字面量返回 null）。 */
function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** 取节点行号（1 基）。 */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return line + 1;
}

/* ------------------------------------------------------------------ *
 * LAW-1：hud ↔ world 互不 import
 * ------------------------------------------------------------------ */

function scanLaw1(index: RepoIndex): LawFinding[] {
  const findings: LawFinding[] = [];
  const hudAbs = path.join(index.repoRoot, HUD_DIR);
  const worldAbs = path.join(index.repoRoot, WORLD_DIR);
  const scope = [...index.filesUnder(HUD_DIR), ...index.filesUnder(WORLD_DIR)];
  for (const relPath of scope) {
    const parsed = index.parse(relPath);
    if (!parsed) continue;
    const inHud = isUnder(parsed.absPath, hudAbs);
    const inWorld = isUnder(parsed.absPath, worldAbs);
    for (const ref of index.importsOf(relPath)) {
      const target = index.resolve(relPath, ref.spec);
      if (target === null) continue;
      const targetAbs = path.join(index.repoRoot, target);
      if (inHud && isUnder(targetAbs, worldAbs)) {
        findings.push({
          lawId: 'LAW-1',
          file: relPath,
          line: lineOf(parsed.sf, ref.node),
          symbol: ref.spec,
          message: 'hud 层直接 import world 层（铁律：hud ↔ world 互不引用，一切走 core 契约）',
        });
      } else if (inWorld && isUnder(targetAbs, hudAbs)) {
        findings.push({
          lawId: 'LAW-1',
          file: relPath,
          line: lineOf(parsed.sf, ref.node),
          symbol: ref.spec,
          message: 'world 层直接 import hud 层（铁律：hud ↔ world 互不引用，一切走 core 契约）',
        });
      }
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * LAW-2：core 零 IO
 * ------------------------------------------------------------------ */

/** 判断标识符是否落在「值引用」位置（排除声明名 / 属性名 / 类型位置）。 */
function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (!parent) return false;
  if (ts.isTypeNode(parent)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodSignature(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isEnumMember(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isClassDeclaration(parent) && parent.name === node) return false;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return false;
  if (ts.isEnumDeclaration(parent) && parent.name === node) return false;
  if (ts.isModuleDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeParameterDeclaration(parent) && parent.name === node) return false;
  return true;
}

/** 去掉一层括号 / 类型断言，取出真正的表达式。 */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** 扫描 core 的 IO 违规。 */
function scanLaw2(index: RepoIndex): LawFinding[] {
  const findings: LawFinding[] = [];
  const coreAbs = path.join(index.repoRoot, CORE_DIR);
  const srcAbs = path.join(index.repoRoot, 'src');
  const coreAbsFiles = index.filesUnder(CORE_DIR).map((rel) => path.join(index.repoRoot, rel));

  const program = ts.createProgram(coreAbsFiles, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['node'],
  });
  const checker = program.getTypeChecker();

  /** 标识符是否解析到仓内声明（不是就是全局 / 外部）。 */
  const isGlobalIdentifier = (node: ts.Identifier): boolean => {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return true;
    const declarations = symbol.declarations ?? [];
    if (declarations.length === 0) return true;
    return !declarations.some((decl) => isUnder(decl.getSourceFile().fileName, srcAbs));
  };

  // why 走 program 自己的 SourceFile（不是自己 createSourceFile 的那份）：
  //   类型检查器按「节点所属的 SourceFile 实例」查符号，两份实例对不上 ⇒ 查不到符号 ⇒
  //   局部变量会被误判成全局（踩过坑：core/session/compress.ts 里的局部 window 被当成 DOM 全局）。
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.endsWith('.ts') && !sf.fileName.endsWith('.tsx')) continue;
    if (!isUnder(sf.fileName, coreAbs)) continue;
    const relPath = toRepoPath(index.repoRoot, sf.fileName);
    // 测试文件不受「零 IO」约束（单测本来就要读夹具 / 读仓库文件断言内容）。
    if (relPath.includes('/__tests__/') || relPath.endsWith('.test.ts')) continue;

    const report = (node: ts.Node, symbol: string, message: string): void => {
      findings.push({
        lawId: 'LAW-2',
        file: relPath,
        line: lineOf(sf, node),
        symbol,
        message,
      });
    };

    // ① 直读文件 / 网络 / 落库模块（fs / net 一族）
    for (const ref of index.importsOf(relPath)) {
      const bare = ref.spec.replace(/^node:/, '');
      const banned = BANNED_MODULE_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`));
      if (banned) {
        report(ref.node, ref.spec, `core 直读 IO 模块 ${ref.spec}（core 是零 IO 纯逻辑层）`);
      }
    }

    const visit = (node: ts.Node): void => {
      // ② process.env 直读
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process' &&
        node.name.text === 'env'
      ) {
        report(node, 'process.env', 'core 直读 process.env（环境配置归 app 层，core 只认注入的契约）');
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process' &&
        node.argumentExpression !== undefined &&
        literalText(node.argumentExpression) === 'env'
      ) {
        report(node, 'process.env', 'core 直读 process.env（环境配置归 app 层，core 只认注入的契约）');
      }

      // ③ 全局出口（fetch / WebSocket / document / localStorage …）
      if (ts.isPropertyAccessExpression(node)) {
        const base = unwrapExpression(node.expression);
        if (ts.isIdentifier(base) && base.text === 'globalThis') {
          if (BANNED_GLOBALS.has(node.name.text)) {
            report(node, `globalThis.${node.name.text}`, `core 用了全局出口 globalThis.${node.name.text}（core 零 IO）`);
          }
        }
      }

      if (ts.isIdentifier(node) && isValueReference(node)) {
        const name = node.text;
        if (BANNED_GLOBALS.has(name) && isGlobalIdentifier(node)) {
          report(node, name, `core 用了全局 ${name}（core 零 IO：IO 与 DOM 都归 app / world 层）`);
        }
      }

      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * LAW-3：pixelfx 的名字不出现在 core
 * ------------------------------------------------------------------ */

function scanLaw3(index: RepoIndex): LawFinding[] {
  const findings: LawFinding[] = [];
  const pattern = /pixelfx/i;
  for (const relPath of index.filesUnder(CORE_DIR)) {
    const parsed = index.parse(relPath);
    if (!parsed) continue;
    const lines = parsed.text.split('\n');
    lines.forEach((line, idx) => {
      if (!pattern.test(line)) return;
      findings.push({
        lawId: 'LAW-3',
        file: relPath,
        line: idx + 1,
        symbol: 'pixelfx',
        message: 'core 里出现了 pixelfx 的名字（第三方库的知识只留在 app 层适配器里）',
      });
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * LAW-4：pixelfx 管线 ↔ CharacterComposer 管线互不引用
 * ------------------------------------------------------------------ */

function scanLaw4(index: RepoIndex): LawFinding[] {
  const findings: LawFinding[] = [];
  const composerSet = new Set(COMPOSER_PIPELINE_FILES);
  const pixelfxSet = new Set(PIXELFX_PIPELINE_FILES);
  const roots = new Set(COMPOSITION_ROOTS);

  for (const relPath of index.allSourceFiles()) {
    const parsed = index.parse(relPath);
    if (!parsed) continue;
    const refs = index.importsOf(relPath);
    const resolvedTargets = refs
      .map((ref) => ({ ref, target: index.resolve(relPath, ref.spec) }))
      .filter((entry): entry is { ref: ImportRef; target: string } => entry.target !== null);

    const importsComposer = resolvedTargets.filter((entry) => composerSet.has(entry.target));
    const importsPixelfxImpl = resolvedTargets.filter((entry) => pixelfxSet.has(entry.target));
    const usesPixelfxLib = refs.some(
      (ref) => ref.spec === 'pixelfx' || ref.spec.startsWith('pixelfx/')
    );

    const report = (ref: ImportRef, symbol: string, message: string): void => {
      findings.push({
        lawId: 'LAW-4',
        file: relPath,
        line: lineOf(parsed.sf, ref.node),
        symbol,
        message,
      });
    };

    // ① 管线实现互相引用：pixelfx 实现引 CharacterComposer，或反之。
    if (pixelfxSet.has(relPath)) {
      for (const entry of importsComposer) {
        report(entry.ref, entry.ref.spec, 'pixelfx 管线实现引用了 CharacterComposer 管线（双管线必须各自闭环）');
      }
    }
    if (composerSet.has(relPath)) {
      if (usesPixelfxLib) {
        const ref = refs.find((r) => r.spec === 'pixelfx' || r.spec.startsWith('pixelfx/'));
        if (ref) report(ref, ref.spec, 'CharacterComposer 管线直接依赖了 pixelfx 库（双管线必须各自闭环）');
      }
      for (const entry of importsPixelfxImpl) {
        report(entry.ref, entry.ref.spec, 'CharacterComposer 管线引用了 pixelfx 管线实现（双管线必须各自闭环）');
      }
    }

    // ② 「双知」文件：同时认识两条管线（装配点除外 —— 组合根本就该同时认识它们）。
    if (!roots.has(relPath) && importsComposer.length > 0 && (usesPixelfxLib || importsPixelfxImpl.length > 0)) {
      const ref = importsComposer[0].ref;
      report(ref, ref.spec, '同一文件同时引用 pixelfx 管线与 CharacterComposer 管线（双管线互不引用）');
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * LAW-5：契约单一事实源
 * ------------------------------------------------------------------ */

/** 顶层导出声明的名字。 */
interface Declaration {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly kind: 'interface' | 'type' | 'class' | 'enum' | 'const' | 'function';
}

/** 收集一个文件里的顶层导出声明。 */
function collectDeclarations(index: RepoIndex, relPath: string): Declaration[] {
  const parsed = index.parse(relPath);
  if (!parsed) return [];
  const out: Declaration[] = [];
  for (const stmt of parsed.sf.statements) {
    const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) ?? [] : [];
    const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isInterfaceDeclaration(stmt)) {
      out.push({ name: stmt.name.text, file: relPath, line: lineOf(parsed.sf, stmt), kind: 'interface' });
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      out.push({ name: stmt.name.text, file: relPath, line: lineOf(parsed.sf, stmt), kind: 'type' });
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name.text, file: relPath, line: lineOf(parsed.sf, stmt), kind: 'class' });
    } else if (ts.isEnumDeclaration(stmt)) {
      out.push({ name: stmt.name.text, file: relPath, line: lineOf(parsed.sf, stmt), kind: 'enum' });
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name.text, file: relPath, line: lineOf(parsed.sf, stmt), kind: 'function' });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          out.push({ name: decl.name.text, file: relPath, line: lineOf(parsed.sf, stmt), kind: 'const' });
        }
      }
    }
  }
  return out;
}

/**
 * 判断另一个文件里的同名声明是否只是「转发」（pass-through）。
 * 转发 = 从 core 源文件 import 后原样再导出（别名 / `export { X }` / `export const Y = X`）。
 * 转发不算第二事实源；自己另写一份才算漂移。
 */
function isPassThrough(index: RepoIndex, otherFile: string, name: string, coreFile: string): boolean {
  const parsed = index.parse(otherFile);
  if (!parsed) return false;

  // 从 core 文件 import 进来的本地名 → 原始名
  const importedLocalToOriginal = new Map<string, string>();
  let reExportedDirectly = false;
  for (const ref of index.importsOf(otherFile)) {
    const target = index.resolve(otherFile, ref.spec);
    if (target !== coreFile) continue;
    const node = ref.node;
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) {
        const exported = spec.name.text;
        if (exported === name) reExportedDirectly = true;
      }
      continue;
    }
    if (ts.isImportDeclaration(node) && node.importClause) {
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const spec of bindings.elements) {
          const original = (spec.propertyName ?? spec.name).text;
          importedLocalToOriginal.set(spec.name.text, original);
        }
      }
    }
  }
  if (reExportedDirectly) return true;

  // `export { X as name }`（X 是从 core import 的同名符号）
  for (const stmt of parsed.sf.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;
    for (const spec of stmt.exportClause.elements) {
      if (spec.name.text !== name) continue;
      const local = (spec.propertyName ?? spec.name).text;
      if (importedLocalToOriginal.get(local) === name) return true;
    }
  }

  // `export const name = <core import 的本地名>`
  for (const stmt of parsed.sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      const init = decl.initializer;
      if (init && ts.isIdentifier(init) && importedLocalToOriginal.get(init.text) === name) return true;
    }
  }
  return false;
}

function scanLaw5(index: RepoIndex): LawFinding[] {
  const findings: LawFinding[] = [];
  const seen = new Set<string>();
  const allFiles = index.allSourceFiles();

  // 全仓的顶层导出声明（按名字归组）
  const byName = new Map<string, Declaration[]>();
  for (const relPath of allFiles) {
    for (const decl of collectDeclarations(index, relPath)) {
      const list = byName.get(decl.name);
      if (list) list.push(decl);
      else byName.set(decl.name, [decl]);
    }
  }

  const contractFile = CONTRACT_FILE;

  const report = (other: Declaration, sourceFile: string): void => {
    const key = `${other.file}|${other.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      lawId: 'LAW-5',
      file: other.file,
      line: other.line,
      symbol: other.name,
      message: `契约名 ${other.name} 在 ${other.file} 有第二处独立定义（契约唯一事实源：${sourceFile}）`,
    });
  };

  // ① 总线契约面（core/types.ts）：契约名在仓库内只能有一处定义。
  for (const decl of collectDeclarations(index, contractFile)) {
    const others = (byName.get(decl.name) ?? []).filter((d) => d.file !== contractFile);
    for (const other of others) {
      if (isPassThrough(index, other.file, decl.name, contractFile)) continue;
      report(other, contractFile);
    }
  }

  // ② core 域其余模块（core/character、core/session、core/theme …）的契约名同样唯一。
  for (const relPath of index.filesUnder(CORE_DIR)) {
    if (relPath === contractFile) continue;
    for (const decl of collectDeclarations(index, relPath)) {
      const others = (byName.get(decl.name) ?? []).filter((d) => d.file !== relPath);
      for (const other of others) {
        if (isPassThrough(index, other.file, decl.name, relPath)) continue;
        report(other, relPath);
      }
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

/** 铁律清单（报告顺序 = 检查顺序）。 */
const LAW_META: ReadonlyArray<{ lawId: LawId; title: string; rule: string; scan: (index: RepoIndex) => LawFinding[] }> = [
  {
    lawId: 'LAW-1',
    title: 'hud ↔ world 互不 import',
    rule: 'hud/world 两层互不知道对方存在，只认识 core/types.ts 的契约；任何 hud ↔ world 的直接引用 = 架构违规。',
    scan: scanLaw1,
  },
  {
    lawId: 'LAW-2',
    title: 'core 零 IO',
    rule: 'core 域是零 IO 纯逻辑层：不直读 fs / net 一族模块、不直读 process.env、不用 DOM 与网络全局。',
    scan: scanLaw2,
  },
  {
    lawId: 'LAW-3',
    title: 'pixelfx 的名字不出现在 core',
    rule: 'pixelfx 是第三方库（vendor 进仓），它的知识只留在 app 层适配器里；core 里连名字都不该出现。',
    scan: scanLaw3,
  },
  {
    lawId: 'LAW-4',
    title: 'pixelfx 管线 ↔ CharacterComposer 管线互不引用',
    rule: '特效管线（pixelfx）与角色合成管线（CharacterComposer）各自闭环：一个文件不许同时认识两条管线（组合根除外）。',
    scan: scanLaw4,
  },
  {
    lawId: 'LAW-5',
    title: '契约单一事实源',
    rule: 'core 的契约名在仓库内只能有一处定义；同名再写一份就是漂移（转发 / 再导出不算）。',
    scan: scanLaw5,
  },
];

/** 跑一轮扫描（仓库根目录）。 */
export function scanArchitecture(repoRoot: string): ScanReport {
  const index = new RepoIndex(repoRoot);
  const results: LawResult[] = LAW_META.map((meta) => ({
    lawId: meta.lawId,
    title: meta.title,
    rule: meta.rule,
    findings: meta.scan(index),
  }));
  return { repoRoot, results };
}

/** 报告里所有违规（扁平）。 */
export function allFindings(report: ScanReport): LawFinding[] {
  return report.results.flatMap((r) => r.findings);
}
