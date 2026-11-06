/**
 * 文件职责：**lint 范围与规则豁免的账本**（@since v3.3，task_223 / QA-03）。
 *
 *   这个账本是什么：`.eslintrc.cjs` 里**所有「不 lint / 换个语义 lint / 不查依赖」的决定**，
 *   逐条在这里登记成书面豁免 —— 每条都要说清「为什么这么定」与「后续怎么处置」。
 *
 *   为什么要有账本（对齐 QA-02 的 law-waivers.ts）：
 *     ESLint 的 ignorePatterns / overrides 是**沉默的** —— 加一条就少扫一片目录，
 *     没人会发现「这个目录从今天起没人 lint 了」。豁免一旦不登记，lint 覆盖率会静默塌陷。
 *     QA-02 用「扫描器 + 账本」做棘轮：账本里有、扫描器也扫到 ⇒ 已豁免；扫描器扫到、
 *     账本里没有 ⇒ 未豁免违规 ⇒ 测试红。这里是同一套棘轮，只是对象换成 lint 配置本身。
 *
 *   怎么用（棘轮）：
 *     - 账本里有、`.eslintrc.cjs` 里也有 ⇒ 账实一致，测试通过；
 *     - `.eslintrc.cjs` 里加了新豁免、账本里没有 ⇒ **未登记豁免** ⇒ 测试失败；
 *     - 账本里有、`.eslintrc.cjs` 里没有 ⇒ 过期豁免 ⇒ 测试失败（提示删账本条目）。
 *
 *   输入：无（纯常量账本；零 import、零 IO —— scopes 里的字面量要与 `.eslintrc.cjs` 的
 *     ignorePatterns / overrides.files / settings.import.core-modules **逐字一致**才能对上账）。
 *   输出：`LINT_WAIVERS`（readonly LintWaiver[]，首版 11 条 L-01 … L-11），每条 =
 *     id / kind（ignore-pattern | override | core-module）/ scopes（精确范围字面量）/
 *     reason / followUp。棘轮比对的是 `.eslintrc.cjs` 与本账本的**集合是否相等**
 *     （配置里有而账本里没有 = 未登记豁免；账本里有而配置里没有 = 过期豁免）。
 *
 *   禁止事项：
 *     1. 把豁免当「顺手放过」—— 每条必须写清理由与后续处置（followUp）；
 *     2. 悄悄扩大豁免范围 —— 往 `.eslintrc.cjs` 加豁免必须同时来这里登记；
 *     3. 在这里改产品代码 —— 本文件只记账，不修债。
 *
 *   说明：本账本登记的是**范围/语义/依赖解析**三类豁免。
 *   `rules` 里关掉的通用规则（no-explicit-any / no-console / ban-ts-comment …）是**风格口径**，
 *   不是「某片代码逃过检查」，不重复登记（见 `docs/CODE-REVIEW-TRIAGE-QA03.md` 的口径表）。
 */

/** 一条 lint 豁免。 */
export interface LintWaiver {
  /** 稳定编号（L-01 …），报告与提交信息里直接引用。 */
  readonly id: string;
  /** 豁免类别。 */
  readonly kind: 'ignore-pattern' | 'override' | 'core-module';
  /** 被豁免的**精确范围**（ignorePatterns 的字面量 / overrides 的 files glob / core-modules 的模块名）。 */
  readonly scopes: readonly string[];
  /** 为什么豁免（人读）。 */
  readonly reason: string;
  /** 后续处置（另开单修 / 何时可以收掉这条）。 */
  readonly followUp: string;
}

/** lint 豁免账本（QA-03 首版，11 条）。 */
export const LINT_WAIVERS: readonly LintWaiver[] = [
  {
    id: 'L-01',
    kind: 'ignore-pattern',
    scopes: ['node_modules', 'dist'],
    reason:
      '第三方依赖与构建产物：不是本仓源码，且 dist/ 里是 tsc 编译后的 JS（再 lint 一遍等于 lint 编译器输出）。',
    followUp: '永不收掉 —— 属于 lint 的基本边界。',
  },
  {
    id: 'L-02',
    kind: 'ignore-pattern',
    scopes: ['vendor'],
    reason:
      '第三方库源码进仓（vendor/pixelfx，MIT、零依赖）。它有自己的代码风格与 lint 口径，不该被本仓规则判罚；' +
      '本仓只在自己的代码里用 import 引用它（别名声明在 core/types.ts 与 settings.import/core-modules）。',
    followUp: '永不收掉 —— vendor 目录天然在 lint 边界外。',
  },
  {
    id: 'L-03',
    kind: 'ignore-pattern',
    scopes: ['scripts'],
    reason:
      '运维/工具脚本（arch-scan.ts、dead-code-scan.ts 等）由 tsx 直接跑，不进 tsconfig 工程也不进构建产物。' +
      '它们不是产品代码，规则口径与 src 不同（脚本常按单文件可执行来写）。',
    followUp: '若将来把 scripts 纳入某个 tsconfig 工程（tsconfig.eslint.json），再评估是否收回这条。',
  },
  {
    id: 'L-04',
    kind: 'ignore-pattern',
    scopes: ['features', 'pythagora-core', 'stratix-backups', 'release'],
    reason:
      '**当前仓内不存在这些目录**（历史遗留的 ignore 项，checkout 后为空）。留着无害，收掉也无行为差异。',
    followUp: '确认这些目录彻底不再回来后，可从 ignorePatterns 与本账本一并删除（清理项，不阻断）。',
  },
  {
    id: 'L-05',
    kind: 'ignore-pattern',
    scopes: ['tests', '**/*.test.ts', '**/*.spec.ts', '*.spec.ts', '**/__tests__/**'],
    reason:
      '**已知覆盖缺口（不是「没问题」，是「没扫」）**：测试文件整体不参与 lint。' +
      'why 现在不收：仓内测试文件从未被 lint 过（历史写法与主规则差异大），一次性纳入会一次性爆出成百上千条 error，' +
      '把「error 清零」这个目标冲垮。测试由 jest + tsc 双重把关，缺的是风格类检查而非正确性检查。',
    followUp:
      '另开单：把测试文件纳入 lint 覆盖（需先把 tsconfig.test.json 加进 eslint 的 parserOptions.project，' +
      '再按目录清历史债；清完把本条从账本删掉）。**本单只记账，不顺手改产品代码。**',
  },
  {
    id: 'L-06',
    kind: 'ignore-pattern',
    scopes: ['jest.config.js', '*.config.ts'],
    reason:
      '构建/测试配置文件：CommonJS/配置对象写法，与 TS 模块语义不同（import/order、no-undef 都不适用）。',
    followUp: '永不收掉 —— 配置文件天然不适用模块语义规则。',
  },
  {
    id: 'L-07',
    kind: 'ignore-pattern',
    scopes: ['tmp'],
    reason:
      'tmp/ 是 **gitignore 掉的本地草稿区**（探针脚本、截图、临时 mjs）。' +
      'ESLint 8 不读 .gitignore ⇒ 不显式忽略的话，`eslint .` 会因为这些文件不在任何 tsconfig 工程里而报解析错。',
    followUp: '若将来 tmp/ 变成正式目录（要进版本库），改走正常工程纳管，删掉本条。',
  },
  {
    id: 'L-08',
    kind: 'core-module',
    scopes: [
      'pixelfx',
      'pixelfx/fx/holy/heal-aoe',
      'pixelfx/fx/impacts/hit-spark',
      'pixelfx/fx/scifi/emp-blast',
      'pixelfx/fx/spawn/poof',
      'pixelfx/fx/ui/confetti',
    ],
    reason:
      'pixelfx 是**仓内 vendor**（vendor/pixelfx）：类型声明走 ambient module（src/app/dev/pixelfx.d.ts），' +
      '运行时靠 tsconfig paths 别名。eslint 的 import 解析器只认 tsconfig 的 paths ⇒ 不声明就会 import/no-unresolved 误报。' +
      'core-modules 是**纯 lint 侧**声明：不装包、不改构建、不影响产物。' +
      'why 逐个列而不写通配：eslint-plugin-import 的 core-modules 不吃 glob，写 ' +
      "'pixelfx/fx/*' 会漏掉一半（只匹到主模块）。",
    followUp: '永不收掉 —— 纯 lint 侧声明；随 vendor/pixelfx 的去留同步即可。',
  },
  {
    id: 'L-09',
    kind: 'core-module',
    scopes: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery'],
    reason:
      'plugins/dsh-bridge 是**独立 npm 包**（plugins/dsh-bridge/package.json），这三个 dsh 依赖装在**插件自己的** node_modules 里，' +
      '本仓根 node_modules 没有 ⇒ eslint 的 import 解析器找不到 ⇒ import/no-unresolved 误报。' +
      '与 L-08 同理：core-modules 是纯 lint 侧声明，不装包、不改构建。',
    followUp: '插件退役时同步删掉本条。',
  },
  {
    id: 'L-10',
    kind: 'override',
    scopes: ['tools/texture-generator/generators/**/*.js'],
    reason:
      '**浏览器全局脚本**（由 index.html 用 <script src> 按序加载，跨文件共享全局 PALETTES / lerpColor / drawRockSmall …）。' +
      '按 module 语义看，「别的文件里定义的全局」就是 no-undef、「给别的脚本调用的函数」就是 no-unused-vars —— 两条都是假阳性。' +
      '故：parserOptions.project=null（不进类型工程）+ 声明共享全局 + 关 no-unused-vars + 关 import/order。',
    followUp: '若将来纹理生成器改成模块化（import/export），本条可收掉。',
  },
  {
    id: 'L-11',
    kind: 'override',
    scopes: ['tools/texture-generator/generate-textures.js'],
    reason:
      '**Node CLI**（CommonJS require 的纹理生成入口）：module 语义与 browser 脚本都不同，故单列一条 override，' +
      'env 同时开 node 与 browser（脚本里既用 fs 也用 canvas），parserOptions.project=null（纯 JS，不进类型工程）。',
    followUp: '与 L-10 一起评估。',
  },
];
