/**
 * 文件职责：**架构铁律静态扫描的测试套件**（@since v3.3，task_222 / QA-02）。
 *
 *   两组用例：
 *     ① 扫描器自测 —— 在临时目录里**注入**违规（hud 引 world / core 读 fs / core 出现 pixelfx /
 *        双管线互引 / 契约名重复定义），必须被逐条抓出来。
 *        why 必须有这一组：只会「通过」的扫描器等于没有扫描器 —— 它得先证明自己会红。
 *     ② 本仓现状 —— 五条铁律在真实仓库上跑，**未豁免**违规必须为 0（有违规 = 测试失败，不是 warning）；
 *        豁免账本必须与扫描结果账实一致（账本里记了、实际没了 ⇒ 账本过期 ⇒ 失败，提示去清理）。
 *
 *   禁止事项：在测试里改产品代码 —— 这里只读、只报告。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { allFindings, scanArchitecture, type LawFinding, type LawId } from '../law-scanner';
import { LAW_WAIVERS } from '../law-waivers';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** 豁免键：铁律 + 文件 + 符号。 */
function waiverKey(lawId: string, file: string, symbol: string): string {
  return `${lawId}|${file}|${symbol}`;
}

/** 找一条违规对应的豁免。 */
function findWaiver(finding: LawFinding): string | undefined {
  return LAW_WAIVERS.find(
    (w) => w.lawId === finding.lawId && w.file === finding.file && w.symbol === finding.symbol
  )?.id;
}

/* ------------------------------------------------------------------ *
 * ① 扫描器自测：注入违规必须被抓到
 * ------------------------------------------------------------------ */

/** 造一个临时「小仓库」，注入六类违规。 */
function buildFixtureRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-arch-laws-'));
  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };

  // 契约面
  write(
    'src/core/types.ts',
    ['export interface HudCommand {', '  readonly kind: string;', '}', '', 'export interface WorldState {', '  readonly tick: number;', '}', ''].join('\n')
  );
  // LAW-2：core 直读 fs + 用全局 fetch
  write(
    'src/core/io-bad.ts',
    ['import * as fs from \'fs\';', '', 'export function readIt(): string {', '  void fs;', '  void fetch(\'http://x\');', '  return String(document.title);', '}', ''].join('\n')
  );
  // LAW-3：core 里出现 pixelfx 的名字
  write('src/core/fx-bad.ts', ['export const FX_NOTE = \'pixelfx pipeline\';', ''].join('\n'));
  // LAW-5：契约名第二处独立定义
  write('src/hud/dup-bad.ts', ['export interface HudCommand {', '  readonly other: string;', '}', ''].join('\n'));
  // LAW-5：转发不算漂移（正向用例 —— 不许误报）
  write('src/hud/alias-ok.ts', ['export { HudCommand } from \'../core/types\';', ''].join('\n'));
  // LAW-1：hud 直接引 world
  write('src/world/scene.ts', ['export const SCENE = 1;', ''].join('\n'));
  write('src/hud/panel-bad.ts', ['import { SCENE } from \'../world/scene\';', 'export const PANEL = SCENE;', ''].join('\n'));
  // LAW-4：同一文件同时认识两条管线
  write(
    'src/world/appearance/character-composer.ts',
    ['export class CharacterComposer {', '  compose(): string {', '    return \'\';', '  }', '}', ''].join('\n')
  );
  write(
    'src/app/services/character-bake-service.ts',
    ['export const BAKE = 1;', ''].join('\n')
  );
  write(
    'src/app/dual-bad.ts',
    [
      'import { createFx } from \'pixelfx\';',
      'import { CharacterComposer } from \'../world/appearance/character-composer\';',
      'export const BOTH = [createFx, CharacterComposer];',
      '',
    ].join('\n')
  );
  return root;
}

describe('扫描器自测（注入的违规必须被抓到）', () => {
  const fixtureRoot = buildFixtureRepo();
  const report = scanArchitecture(fixtureRoot);

  afterAll(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  const findingsOf = (lawId: LawId): readonly LawFinding[] =>
    report.results.find((r) => r.lawId === lawId)?.findings ?? [];

  test('LAW-1：hud 直接 import world 被抓到', () => {
    const hits = findingsOf('LAW-1');
    expect(hits.some((f) => f.file === 'src/hud/panel-bad.ts')).toBe(true);
  });

  test('LAW-2：core 直读 fs / 用全局 fetch、document 被抓到', () => {
    const hits = findingsOf('LAW-2');
    const symbols = hits.map((f) => f.symbol);
    expect(symbols).toContain('fs');
    expect(symbols).toContain('fetch');
    expect(symbols).toContain('document');
  });

  test('LAW-3：core 里出现 pixelfx 的名字被抓到', () => {
    const hits = findingsOf('LAW-3');
    expect(hits.some((f) => f.file === 'src/core/fx-bad.ts')).toBe(true);
  });

  test('LAW-4：同时认识两条管线的文件被抓到', () => {
    const hits = findingsOf('LAW-4');
    expect(hits.some((f) => f.file === 'src/app/dual-bad.ts')).toBe(true);
  });

  test('LAW-5：契约名第二处独立定义被抓到', () => {
    const hits = findingsOf('LAW-5');
    expect(hits.some((f) => f.file === 'src/hud/dup-bad.ts' && f.symbol === 'HudCommand')).toBe(true);
  });

  test('LAW-5：转发（re-export）不算漂移，不误报', () => {
    const hits = findingsOf('LAW-5');
    expect(hits.some((f) => f.file === 'src/hud/alias-ok.ts')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * ② 本仓现状：五条铁律 + 豁免账本账实一致
 * ------------------------------------------------------------------ */

describe('本仓架构铁律现状', () => {
  const report = scanArchitecture(REPO_ROOT);

  test('扫描器覆盖全部五条铁律', () => {
    expect(report.results.map((r) => r.lawId)).toEqual(['LAW-1', 'LAW-2', 'LAW-3', 'LAW-4', 'LAW-5']);
  });

  test.each(report.results.map((r) => [r.lawId, r] as const))(
    '铁律 %s：未豁免违规为 0（有违规 = 测试失败）',
    (_lawId, result) => {
      const unwaived = result.findings.filter((f) => findWaiver(f) === undefined);
      const detail = unwaived.map((f) => `  ${f.file}:${f.line} ${f.symbol} —— ${f.message}`).join('\n');
      expect(unwaived.map((f) => `${f.file}:${f.line} ${f.symbol}`)).toEqual([]);
      expect(detail).toBe('');
    }
  );

  test('豁免账本账实一致：账本里的每条都还对应着一条真实违规', () => {
    const live = new Set(allFindings(report).map((f) => waiverKey(f.lawId, f.file, f.symbol)));
    const stale = LAW_WAIVERS.filter((w) => !live.has(waiverKey(w.lawId, w.file, w.symbol)));
    expect(
      stale.map((w) => `${w.id}（${w.lawId} ${w.file} ${w.symbol}）—— 对应违规已消失，请从 src/architecture/law-waivers.ts 删除该条`)
    ).toEqual([]);
  });

  test('豁免账本没有重复键', () => {
    const keys = LAW_WAIVERS.map((w) => waiverKey(w.lawId, w.file, w.symbol));
    expect(keys.length).toBe(new Set(keys).size);
  });
});
