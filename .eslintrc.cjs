module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
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
};
