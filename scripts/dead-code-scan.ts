/**
 * 脚本职责：**死代码扫描（未引用文件 / 未使用导出）**（@since v3.3，task_223 / QA-03）。
 *
 *   用法：npm run dead:scan
 *
 *   口径（三条线索，逐条收紧）：
 *     A 未被引用的文件 —— 在仓内（src/ + scripts/ + tests/ + e2e-tests/ + tools/）
 *       **没有任何文件 import 它**（测试文件本身由 jest 直接跑，不算引用）。
 *       入口文件天然没人 import —— 已在 KNOWN_ENTRY_FILES 里标出，其余需人工确认。
 *     B 未被 import 的导出 —— 一个文件 export 了某个符号，但没有任何文件 import 它。
 *       **再往下收紧**：barrel（index.ts 转发导出）不算真引用 —— 顺着转发链找到**真正的定义处**，
 *       定义处没人 import 才算候选。
 *     C 完全未使用的导出 —— 定义处**本地也没人用**（连自己文件里都没引用）⇒ 铁证死代码。
 *
 *   解析方式：TypeScript AST（跟 src/architecture/law-scanner.ts 同一口径）——
 *     注释掉的 import、字符串里的路径都不算数。
 *
 *   输入：仓库根（REPO_ROOT = path.resolve(__dirname, '..')）——
 *     扫描面 = src/ 下的 .ts（测试文件不作为「被扫描对象」，但仍是引用方）+ scripts/ + tests/
 *     + e2e-tests/ + tools/；引用线索还包含非 .ts 文本文件（json / html / js / mjs / cjs / sh / py / yml / yaml）。
 *   输出：stdout 的三段清单（【A】零引用文件候选、【B】完全未使用的导出、【C】仅本文件内部使用的导出）
 *     + 合计行；不写任何文件、不改任何代码，退出码恒为 0（只报告，不阻断 CI）。
 *
 *   禁止事项：
 *     1. 在本脚本里改产品代码 —— 本脚本只**报告**；
 *     2. 把候选直接当结论 —— 处置前必须人工确认（任务要求：候选清单先产出再动）。
 */

import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

/** 仓库根。 */
const REPO_ROOT = path.resolve(__dirname, '..');
/** 源码根。 */
const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** 入口文件（相对 src 的 posix 路径）—— 天然没人 import，不是死文件。 */
const KNOWN_ENTRY_FILES: ReadonlySet<string> = new Set([
  'app/main/main-entry.ts',
  'app/dev/hello-loop-entry.ts',
  'electron/main.ts',
  'electron/preload.ts',
  'hud/dev/hud-dev-entry.ts',
  'stratix-gateway/index.ts',
]);

/**
 * **已确认保留**的零引用文件（账本）—— 工具只报告，处置由人定（@since task_223 / QA-03）。
 *
 *   为什么有账本：扫描只回答「没人引用」，不回答「该不该删」。
 *   「实现完整、只是还没接线」的功能模块 —— 删掉等于抹掉已写好的功能，属于**产品决策**，
 *   不该由 lint/死代码单顺手做掉。这里逐条写清保留理由与后续处置，工具输出会原样带出来。
 *
 *   棘轮：删掉一条就要在这里删一条；新增一条必须写理由。
 */
const KEPT_DEAD_FILES: ReadonlyMap<string, { reason: string; followUp: string }> = new Map([
  [
    'src/stratix-core/services/ServiceLocator.ts',
    {
      reason:
        'legacy 服务定位器（ServiceLocator / defaultServiceLocator / getServices）。它唯一的门面 ' +
        'src/stratix-core/services/index.ts 零引用、已在 QA-03 删掉 ⇒ 实现文件随之失去引用。',
      followUp: '随 legacy 包 src/stratix-core 整体退役时删除（CLAUDE.md 的 legacy 退役计划）。',
    },
  ],
  [
    'src/stratix-gateway/api/retry/GatewayRetryAdapter.ts',
    {
      reason:
        '网关侧重试适配器（包住 stratix-core 的 retryPolicyEngine）。实现完整，**尚未接线**到网关的 HTTP/WS 路径。',
      followUp: '另开单：把 GatewayRetryAdapter 接进网关请求路径；接完即可删。',
    },
  ],
  [
    'src/stratix-gateway/command-transformer/SkillExecutor.ts',
    {
      reason: '网关侧技能执行器（前置/后置钩子）。实现完整，尚未接线。',
      followUp: '另开单：接线到技能执行链；接完即可删。',
    },
  ],
  [
    'src/stratix-lra-bridge/LRAWatcher.ts',
    {
      reason: 'LRA 任务列表轮询监听器。LRAClient 在用，Watcher 尚未接线。',
      followUp: '另开单：接线到 LRA 任务流；接完即可删。',
    },
  ],
  [
    'src/stratix-orchestration/context/ContextCompressionService.ts',
    {
      reason:
        '上下文压缩服务（归档旧对话 + 相关性打分）。注：core/session/manager.ts 另有一套压缩口径，' +
        '两套并存 —— 这是**真重复**，但删哪一套要产品拍板（涉及落库表结构）。',
      followUp: '另开单：与 core/session 的压缩口径二选一，退役另一套。',
    },
  ],
  [
    'src/stratix-orchestration/context/RelevanceScorer.ts',
    {
      reason: '上下文相关性打分器，与 ContextCompressionService 配套（同一重复问题）。',
      followUp: '同上：随上下文压缩口径统一一并处置。',
    },
  ],
  [
    'src/stratix-orchestration/worker/AgentWorker.ts',
    {
      reason: '编排层 worker 实现（worker/index.ts 门面零引用、已删 ⇒ 实现文件随之失去引用）。',
      followUp: '随 legacy 编排层退役时删除。',
    },
  ],
  [
    'src/stratix-openclaw-adapter/demo-one-to-many.ts',
    {
      reason: '一对多连接的**手工演示脚本**（不参与构建、不被任何入口调用）。',
      followUp: '另开单：确认演示价值后决定留（挪进 docs/ 或 scripts/）还是删。',
    },
  ],
  [
    'src/stratix-openclaw-adapter/test-connection.ts',
    {
      reason: '手工连接自检脚本（package.json 未挂任何 script 入口）。',
      followUp: '同上：确认手工排障价值后决定留或删。',
    },
  ],
  [
    'src/stratix-tailscale/test-tailscale.ts',
    {
      reason:
        '手工 tailscale 自检脚本。注意 package.json 挂的是 test-embedded.ts（另一个文件），' +
        '本文件**连脚本入口都没有** —— 是上一次改名的遗留。',
      followUp: '另开单：删除，或补一个 npm script 把它变成有入口的正式脚本。',
    },
  ],
  [
    'src/world/appearance/part-config.ts',
    {
      reason:
        '部位类别展示配置（类别 → 文案/图标/z 序/是否必选，复活自 stratix-character-creator）。' +
        '实现完整，但角色合成栈当前没读它（appearance/index.ts 门面零引用、已删 ⇒ 实现文件随之失去引用）。',
      followUp: '另开单：要么接进角色合成栈，要么退役（复活来源的旧路径已不存在）。',
    },
  ],
]);

/** 仓库相对路径（posix）。 */
function rel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/** 收集目录下所有 .ts 文件（含测试文件 —— 测试也是引用方）。 */
function collectSources(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSources(abs, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
  return out;
}

/** 跳过的大目录（构建产物 / 依赖 / vendor）。 */
const TEXT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'vendor',
  'coverage',
  'playwright-report',
  'test-results',
  '.long-run-agent',
  'stratix-data',
]);

/**
 * 非 .ts 的**文本**文件（仓相对 posix 路径）—— 它们也能引用 .ts 文件
 * （package.json 的 script、HTML 的 <script src>、bin/*.js 的路径拼接 …）。
 * why 不收 .md：文档提到文件名不等于代码在用它，信号太噪。
 */
const TEXT_FILES: string[] = (() => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (TEXT_SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
      } else if (/\.(json|html|js|mjs|cjs|sh|py|yml|yaml)$/.test(entry.name)) {
        out.push(rel(abs));
      }
    }
  };
  walk(REPO_ROOT);
  return out;
})();

/** 测试文件（jest 直接跑，不靠 import 被人引用 —— 不能当死文件候选）。 */
function isTestFile(abs: string): boolean {
  return /(^|[\\/])__tests__[\\/]/.test(abs) || /\.test\.ts$/.test(abs) || /\.spec\.ts$/.test(abs);
}

/** 把模块说明符解析成仓内源文件；解析不出来（npm 包 / css / 资源）返回 null。 */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else if (spec.startsWith('@/')) {
    base = path.join(SRC_ROOT, spec.slice(2));
  } else if (spec.startsWith('@stratix-core/')) {
    base = path.join(SRC_ROOT, 'stratix-core', spec.slice('@stratix-core/'.length));
  } else {
    return null;
  }
  const clean = base.split('?')[0];
  const candidates = [clean, `${clean}.ts`, `${clean}.tsx`, path.join(clean, 'index.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** 一个文件的导出符号。 */
interface FileFacts {
  readonly abs: string;
  /** 导出符号名。 */
  readonly exports: Set<string>;
  /** 转发导出：本地名 → 目标文件（barrel 转发）。 */
  readonly reexports: Map<string, string>;
  /** export * from 的目标文件。 */
  readonly starReexports: string[];
  /** 本文件里被**引用**（非声明）的标识符计数。 */
  readonly localRefs: Map<string, number>;
}

/** 收集一个文件的导出符号与本地引用计数。 */
function collectFacts(sf: ts.SourceFile, abs: string): FileFacts {
  const exports = new Set<string>();
  const reexports = new Map<string, string>();
  const starReexports: string[] = [];
  const localRefs = new Map<string, number>();

  const hasExportModifier = (node: ts.Node): boolean =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exports.add(decl.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      hasExportModifier(stmt) &&
      stmt.name
    ) {
      exports.add(stmt.name.text);
    } else if (ts.isExportAssignment(stmt)) {
      exports.add('default');
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) exports.add(el.name.text);
      }
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const target = resolveSpecifier(stmt.moduleSpecifier.text, abs);
        if (target) {
          if (!stmt.exportClause) {
            starReexports.push(target);
          } else if (ts.isNamedExports(stmt.exportClause)) {
            for (const el of stmt.exportClause.elements) {
              reexports.set(el.name.text, target);
            }
          }
        }
      }
    }
  }

  // 本地引用计数：只数「引用」，不算声明处 / import 说明符 / 属性名 / 对象字面量键。
  const isDeclarationName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
    if (ts.isParameter(parent) && parent.name === node) return true;
    if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
    if (ts.isClassDeclaration(parent) && parent.name === node) return true;
    if (ts.isInterfaceDeclaration(parent) && parent.name === node) return true;
    if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return true;
    if (ts.isEnumDeclaration(parent) && parent.name === node) return true;
    if (ts.isPropertyDeclaration(parent) && parent.name === node) return true;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
    if (ts.isMethodDeclaration(parent) && parent.name === node) return true;
    if (ts.isPropertySignature(parent) && parent.name === node) return true;
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true;
    if (ts.isExportSpecifier(parent)) return true;
    if (ts.isBindingElement(parent) && parent.name === node) return true;
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const text = node.text;
      localRefs.set(text, (localRefs.get(text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { abs, exports, reexports, starReexports, localRefs };
}

/** 主流程。 */
function main(): void {
  /** 候选池：src/ 下的非测试源文件。 */
  const allSrcFiles = collectSources(SRC_ROOT);
  const candidateFiles = allSrcFiles.filter((f) => !isTestFile(f));
  /** 引用方全集：仓内任何地方 import 都算数（含 src 下的测试文件 —— 它们也是引用方）。 */
  const files = [
    ...allSrcFiles,
    ...collectSources(path.join(REPO_ROOT, 'scripts')),
    ...collectSources(path.join(REPO_ROOT, 'tests')),
    ...collectSources(path.join(REPO_ROOT, 'e2e-tests')),
    ...collectSources(path.join(REPO_ROOT, 'tools')),
  ];

  const facts = new Map<string, FileFacts>();
  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const abs of files) {
    const text = fs.readFileSync(abs, 'utf8');
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
    sourceFiles.set(abs, sf);
    facts.set(abs, collectFacts(sf, abs));
  }

  /** 文件 → 引用它的文件集合。 */
  const importedBy = new Map<string, Set<string>>();
  /** `文件#符号` → 引用它的文件集合（按**定义处**记账）。 */
  const symbolUsedBy = new Map<string, Set<string>>();

  const markFileUsed = (target: string, importer: string): void => {
    if (!importedBy.has(target)) importedBy.set(target, new Set());
    importedBy.get(target)!.add(importer);
  };
  const markSymbolUsed = (target: string, name: string, importer: string): void => {
    const key = `${target}#${name}`;
    if (!symbolUsedBy.has(key)) symbolUsedBy.set(key, new Set());
    symbolUsedBy.get(key)!.add(importer);
  };

  /**
   * 顺着 barrel 转发链找到**真正的定义处**（递归，带环保护）。
   * 一个符号可能有多个来源（`export *` 转发多个文件），所以返回集合。
   */
  const origins = (file: string, name: string, seen = new Set<string>()): Set<string> => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return new Set();
    seen.add(key);
    const fact = facts.get(file);
    if (!fact) return new Set([file]);
    const result = new Set<string>();
    const forwarded = fact.reexports.get(name);
    if (forwarded) {
      for (const o of origins(forwarded, name, seen)) result.add(o);
    }
    let starMatched = false;
    for (const target of fact.starReexports) {
      const targetFact = facts.get(target);
      if (targetFact?.exports.has(name)) {
        starMatched = true;
        for (const o of origins(target, name, seen)) result.add(o);
      }
    }
    if (result.size === 0 && !starMatched) result.add(file);
    return result;
  };

  for (const abs of files) {
    const sf = sourceFiles.get(abs)!;

    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const target = resolveSpecifier(stmt.moduleSpecifier.text, abs);
        if (!target) continue;
        markFileUsed(target, abs);
        const clause = stmt.importClause;
        if (!clause) continue;
        if (clause.name) markSymbolUsed(target, 'default', abs);
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            for (const name of facts.get(target)?.exports ?? []) markSymbolUsed(target, name, abs);
          } else {
            for (const el of clause.namedBindings.elements) {
              markSymbolUsed(target, (el.propertyName ?? el.name).text, abs);
            }
          }
        }
      }
      if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const target = resolveSpecifier(stmt.moduleSpecifier.text, abs);
        if (!target) continue;
        markFileUsed(target, abs);
        if (!stmt.exportClause) {
          for (const name of facts.get(target)?.exports ?? []) markSymbolUsed(target, name, abs);
        } else if (ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            markSymbolUsed(target, (el.propertyName ?? el.name).text, abs);
          }
        }
      }
    }

    // 动态 import('...') / require('...')
    /**
     * 动态 import 也会**取具名导出** —— 只记文件引用会把它误判成「完全未使用的导出」。
     * 这里补两种最常见形态（src/agent-platform/ipc/execution.ts 就是第一种）：
     *   ① const { X } = await import('...')            → 解构绑定
     *   ② import('...').then((m) => m.X)              → then 回调里取属性
     */
    const visitDynamic = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.arguments.length >= 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        (ts.isImportKeyword(node.expression) || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const target = resolveSpecifier(node.arguments[0].text, abs);
        if (target) markFileUsed(target, abs);

        // 形态①：const { X, Y: Z } = await import('...')
        // 注意 `await import(...)` 的父节点是 AwaitExpression，不是 VariableDeclaration —— 要先脱壳。
        const parent = ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent;
        if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)) {
          for (const el of parent.name.elements) {
            const imported = el.propertyName ?? el.name;
            if (ts.isIdentifier(imported) || ts.isStringLiteral(imported)) {
              markSymbolUsed(target, imported.text, abs);
            }
          }
        }

        // 形态②：import('...').then((m) => m.X)
        if (ts.isPropertyAccessExpression(parent) && parent.name.text === 'then') {
          const cb = parent.parent;
          if (ts.isCallExpression(cb) && cb.arguments.length >= 1) {
            const handler = cb.arguments[0];
            const paramName = (() => {
              if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return undefined;
              const p = handler.parameters[0];
              if (!p) return undefined;
              if (ts.isIdentifier(p.name)) return p.name.text;
              return undefined; // 解构形参（({X}) => …）由形态①同源处理，这里保守跳过
            })();
            if (paramName) {
              const walk = (n: ts.Node): void => {
                if (
                  ts.isPropertyAccessExpression(n) &&
                  ts.isIdentifier(n.expression) &&
                  n.expression.text === paramName
                ) {
                  markSymbolUsed(target, n.name.text, abs);
                }
                ts.forEachChild(n, walk);
              };
              ts.forEachChild(handler, walk);
            }
          }
        }
      }
      ts.forEachChild(node, visitDynamic);
    };
    visitDynamic(sf);
  }

  /* ---------------- A：未被引用的文件 ---------------- */
  /**
   * 补充证据：**非 import 形态**的引用（HTML 的 <script src>、package.json 的 script、
   *   bin/*.js 里的路径拼接、.mjs 里的动态路径 …）—— AST 看不见它们，
   *   但它们同样是「这个文件还活着」的证据。全仓文本兜底扫一遍。
   */
  const textRefsOf = (abs: string): string[] => {
    const relPath = rel(abs); // 例：src/stratix-gateway/mcp/bin/stratix-mcp.ts
    const withoutExt = relPath.replace(/\.ts$/, '');
    const tail = withoutExt.split('/').slice(-3).join('/'); // 例：mcp/bin/stratix-mcp
    // 带扩展名的文件名（例：stratix-mcp.ts）—— 命中「路径是拼出来的」这类引用
    //   （bin/stratix-mcp.js 用 path.join(ROOT, 'src', '…', 'stratix-mcp.ts') 拼路径，字符串不连续）。
    const fileName = path.basename(relPath); // 例：stratix-mcp.ts
    // why 不用裸 basename（"index" / "main" / "types"）：满仓都是，信号全被噪声吃掉。
    //   只留「仓相对全路径」与「末三段」两种足够具体的写法，且长度下限 8。
    const needles = [...new Set([withoutExt, tail, ...(fileName.includes('-') || fileName.includes('_') ? [fileName] : [])])].filter(
      (n) => n.length >= 8,
    );
    const hits: string[] = [];
    for (const file of TEXT_FILES) {
      if (file === relPath) continue;
      let text: string;
      try {
        text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      } catch {
        continue;
      }
      for (const needle of needles) {
        if (text.includes(needle)) {
          hits.push(`${file} (含 "${needle}")`);
          break;
        }
      }
    }
    // 同目录的 HTML 用相对路径引入口（`<script src="./main.ts">`）——
    //   全仓按全路径找找不到，只在**同目录**里按文件名找，命中才算数（邻目录的同名文件不算）。
    const dir = path.dirname(relPath);
    const stem = fileName.replace(/\.ts$/, '');
    for (const file of TEXT_FILES) {
      if (path.dirname(file) !== dir || file === relPath) continue;
      let text: string;
      try {
        text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      } catch {
        continue;
      }
      if (text.includes(stem)) {
        hits.push(`${file} (同目录引用 "${stem}")`);
        break;
      }
    }
    return hits;
  };

  const unusedFiles = candidateFiles
    .filter((abs) => (importedBy.get(abs)?.size ?? 0) === 0)
    .map((abs) => rel(abs))
    .sort();

  /* ---------------- B/C：未被引用的导出 ---------------- */
  interface ExportRow {
    readonly file: string;
    readonly name: string;
    /** 是否只在本文件内部被用（= export 多余，但代码是活的）。 */
    readonly localOnly: boolean;
  }
  const deadExports: ExportRow[] = [];
  const localOnlyExports: ExportRow[] = [];

  for (const abs of candidateFiles) {
    const fact = facts.get(abs)!;
    for (const name of fact.exports) {
      // barrel 转发出去的符号不算「本文件的定义」—— 归到真正的定义处判。
      if (fact.reexports.has(name)) continue;
      // 谁 import 了它（按定义处记账）。
      let imported = false;
      for (const origin of origins(abs, name)) {
        if ((symbolUsedBy.get(`${origin}#${name}`)?.size ?? 0) > 0) imported = true;
      }
      const localRefs = fact.localRefs.get(name) ?? 0;
      if (imported) continue;
      if (localRefs > 0) {
        localOnlyExports.push({ file: rel(abs), name, localOnly: true });
      } else {
        deadExports.push({ file: rel(abs), name, localOnly: false });
      }
    }
  }
  deadExports.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  localOnlyExports.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

  console.log('═'.repeat(78));
  console.log('死代码扫描（task_223 / QA-03）');
  console.log('═'.repeat(78));
  console.log('');
  console.log(`【A】未被任何仓内文件引用的文件（${unusedFiles.length} 个）—— 候选，需人工确认`);
  console.log('     [入口]= 进程入口（天然没人 import）；[活]= 非 import 形态被引用（HTML / package.json / 路径拼接）');
  for (const f of unusedFiles) {
    const isEntry = KNOWN_ENTRY_FILES.has(f.replace(/^src\//, ''));
    const textRefs = textRefsOf(path.join(REPO_ROOT, f));
    const kept = KEPT_DEAD_FILES.get(f);
    const tag = isEntry ? '[入口]' : textRefs.length > 0 ? '[活]' : kept ? '[保留]' : '[候选]';
    console.log(`  ${tag} ${f}`);
    for (const h of textRefs.slice(0, 3)) console.log(`        ↳ 非 import 引用：${h}`);
    if (kept) {
      console.log(`        ↳ 保留理由：${kept.reason}`);
      console.log(`        ↳ 后续处置：${kept.followUp}`);
    }
  }
  console.log('');
  console.log(`【B】完全未使用的导出（没人 import + 本地也没人用）（${deadExports.length} 个）—— 铁证死代码`);
  for (const u of deadExports) console.log(`  ${u.file}  →  ${u.name}`);
  console.log('');
  console.log(`【C】只在本文件内部使用的导出（export 多余，代码是活的）（${localOnlyExports.length} 个）—— 可选清理`);
  for (const u of localOnlyExports) console.log(`  ${u.file}  →  ${u.name}`);

  console.log('');
  console.log('─'.repeat(78));
  console.log(
    `合计：候选文件 ${unusedFiles.length} 个 / 完全未使用导出 ${deadExports.length} 个 / 仅内部使用导出 ${localOnlyExports.length} 个`,
  );
}

main();
