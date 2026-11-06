/**
 * 文件职责：**lint 豁免账本的棘轮测试**（@since v3.3，task_223 / QA-03）。
 *
 *   断言两条：
 *     ① 账实一致 —— `.eslintrc.cjs` 里出现的每一处豁免（ignorePatterns / overrides 的 files /
 *        import.core-modules）都必须在 `lint-waivers.ts` 账本里登记；
 *        账本里登记的也必须真的在配置里（账本过期 ⇒ 失败，提示去删账本条目）。
 *     ② 每条豁免都写清了理由与后续处置 —— 空理由 / 空 followUp ⇒ 失败。
 *
 *   why 需要这条：ESLint 的 ignorePatterns 是**沉默的** —— 加一条就少扫一片目录，
 *   不登记的话 lint 覆盖率会静默塌陷（QA-03 首跑就发现 e2e-tests / plugins / tools 三棵树
 *   因为不在任何 tsconfig 工程里而**零 lint 覆盖**）。
 *
 *   禁止事项：在测试里改产品代码 —— 这里只读、只报告。
 */

import * as path from 'path';

import { LINT_WAIVERS } from '../lint-waivers';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** `.eslintrc.cjs` 的最小结构（只取本测试关心的三处）。 */
interface EslintrcShape {
  readonly ignorePatterns?: readonly string[];
  readonly overrides?: readonly { readonly files?: readonly string[] }[];
  readonly settings?: { readonly 'import/core-modules'?: readonly string[] };
}

/* eslint-disable @typescript-eslint/no-var-requires */
const eslintrc = require(path.join(REPO_ROOT, '.eslintrc.cjs')) as EslintrcShape;

/** 配置里真实存在的豁免范围集合。 */
function configScopes(): Set<string> {
  const scopes = new Set<string>();
  for (const p of eslintrc.ignorePatterns ?? []) scopes.add(p);
  for (const o of eslintrc.overrides ?? []) {
    for (const f of o.files ?? []) scopes.add(f);
  }
  for (const m of eslintrc.settings?.['import/core-modules'] ?? []) scopes.add(m);
  return scopes;
}

/** 账本里登记的范围集合。 */
function ledgerScopes(): Set<string> {
  const scopes = new Set<string>();
  for (const w of LINT_WAIVERS) {
    for (const s of w.scopes) scopes.add(s);
  }
  return scopes;
}

describe('lint 豁免账本（QA-03）', () => {
  it('账本里的每条豁免都写清了理由与后续处置', () => {
    for (const w of LINT_WAIVERS) {
      expect(w.reason.trim().length).toBeGreaterThan(10);
      expect(w.followUp.trim().length).toBeGreaterThan(5);
      expect(w.scopes.length).toBeGreaterThan(0);
    }
  });

  it('编号不重复', () => {
    const ids = LINT_WAIVERS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('配置里的每处豁免都在账本里登记了（未登记豁免 ⇒ 失败）', () => {
    const ledger = ledgerScopes();
    const unregistered = [...configScopes()].filter((s) => !ledger.has(s));
    expect(unregistered).toEqual([]);
  });

  it('账本里没有过期条目（配置已收掉 ⇒ 失败，提示去删账本条目）', () => {
    const config = configScopes();
    const stale = [...ledgerScopes()].filter((s) => !config.has(s));
    expect(stale).toEqual([]);
  });
});
