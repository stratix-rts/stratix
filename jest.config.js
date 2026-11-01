/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  // Only run Jest unit tests (not Playwright tests)
  testMatch: [
    '**/*.test.ts'
  ],
  // Exclude Playwright test files and tests requiring browser/Phaser
  // why 只剩三条（task_017）：原先排除的 app/api/rts/diagnose spec、design-system、migration、
  // UnifiedOpenClawConnectionManager 测试，其被测源码已随 legacy 删除，忽略项一起清掉（留着就是假覆盖）。
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    // 纹理管理测试需要 Phaser/浏览器全局，jest(node env) 跑不了
    '/tests/texture-management/'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    // why 排除 electron/：主进程只在 electron 运行时里跑，jest(node env) 覆盖它没有意义
    '!src/electron/**',
    'src/stratix-core/state/StratixStateStore.ts',
    'src/stratix-core/retry/RetryPolicyEngine.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  // Limit workers: avoid eating all CPU cores (CI=50%, local=2)
  maxWorkers: process.env.CI ? '50%' : 2,
  testTimeout: 15000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@stratix-core/(.*)$': '<rootDir>/src/stratix-core/$1'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(lowdb)/)',
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      useESM: false
    }]
  }
};
