module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.eslint.json', './plugins/dsh-bridge/tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: './tsconfig.json',
      },
    },
    /**
     * pixelfx 是**仓内 vendor** 的库（vendor/pixelfx，MIT、零依赖；task_191 / AP-01 起 vendor 进仓）。
     * why 声明成 core module 而不是配 resolver 路径：
     *   ① tsconfig 的 paths 一旦指向 vendor 目录，产物里 require('pixelfx') 会被
     *      tsc-alias 改写成机器相关的相对路径 → 产物不可移植；
     *      类型声明走 ambient module（src/app/dev/pixelfx.d.ts），编译期零外部依赖；
     *   ② eslint 的 import 解析器（typescript resolver）只认 tsconfig 的 paths，
     *      拿不到别名 → import/no-unresolved 误报。
     *   core-modules 是**纯 lint 侧**的声明：不碰构建、不碰类型、不影响产物。
     *   why 把 5 个效果模块逐个列出来而不是写通配：eslint-plugin-import 的
     *   core-modules 不吃 glob —— 写 'pixelfx/fx/*' 会漏掉一半（只匹到主模块）。
     */
    'import/core-modules': [
      'pixelfx',
      'pixelfx/fx/holy/heal-aoe',
      'pixelfx/fx/impacts/hit-spark',
      'pixelfx/fx/scifi/emp-blast',
      'pixelfx/fx/spawn/poof',
      'pixelfx/fx/ui/confetti',
      // plugins/dsh-bridge 的三个 dsh 依赖（@since task_223 / QA-03）：
      //   该插件是**独立 npm 包**（plugins/dsh-bridge/package.json），依赖装在插件自己的 node_modules 里，
      //   本仓根 node_modules 里没有 ⇒ eslint 的 import 解析器找不到它们 → import/no-unresolved 误报。
      //   与 pixelfx 同理：core-modules 是**纯 lint 侧**声明（不装包、不改构建、不进产物）。
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/schemastery',
    ],
  },
  env: {
    node: true,
    es2020: true,
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    'vendor',
    'scripts',
    'features',
    'pythagora-core',
    'stratix-backups',
    'release',
    'tests',
    'jest.config.js',
    '*.config.ts',
    '*.spec.ts',
    '**/*.spec.ts',
    '**/*.test.ts',
    '**/__tests__/**',
    // tmp/ 是 gitignore 掉的本地草稿区（探针脚本/截图），ESLint 8 不读 .gitignore ⇒ 显式忽略，
    // 否则 `eslint .` 会因为这些文件不在任何 tsconfig 工程里而报解析错（@since task_223 / QA-03）。
    'tmp',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    'no-console': 'off',
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        alphabetize: { order: 'asc' },
        'newlines-between': 'always',
      },
    ],
    'import/newline-after-import': 'error',
  },
  /**
   * 按目录切语义（@since task_223 / QA-03）。
   * why 需要 overrides：`eslint .` 会扫全仓，而仓里混着三种**模块语义**不同的代码，
   * 用同一套 module 语义 lint 它们会误报（不是代码有错，是 lint 的前提错了）：
   *   ① TS 模块（src / e2e-tests / plugins）—— 默认；
   *   ② 浏览器全局脚本（tools/texture-generator/generators/**）—— 由 index.html 用
   *      `<script src>` 按顺序加载，**跨文件共享全局**（PALETTES / lerpColor / createNoise /
   *      drawRockSmall …）；按 module 语义看，"别的文件里定义的全局"就是 no-undef，
   *      "给别的脚本调用的函数"就是 no-unused-vars —— 两条都是假阳性。
   *   ③ Node CLI（tools/texture-generator/generate-textures.js）—— CommonJS require。
   */
  overrides: [
    {
      files: ['tools/texture-generator/generators/**/*.js'],
      env: { browser: true },
      parserOptions: { sourceType: 'script', project: null },
      globals: {
        PALETTES: 'readonly',
        lerpColor: 'readonly',
        getPalette: 'readonly',
        createNoise: 'readonly',
        drawRock: 'readonly',
        drawRockSmall: 'readonly',
        drawRockLarge: 'readonly',
        drawGrassTuft: 'readonly',
        drawFlower: 'readonly',
        drawWater: 'readonly',
        drawCloudShape: 'readonly',
      },
      rules: {
        // 这里的函数是**给别的 <script> 调用的全局**，本文件内没人用是正常的。
        '@typescript-eslint/no-unused-vars': 'off',
        // script 语义下的 require 不成组，不适用 import/order。
        'import/order': 'off',
      },
    },
    {
      files: ['tools/texture-generator/generate-textures.js'],
      env: { node: true, browser: true },
      parserOptions: { sourceType: 'script', project: null },
    },
  ],
};
