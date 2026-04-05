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
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/tests/app\\.spec\\.ts',
    '/tests/api\\.spec\\.ts',
    '/tests/rts\\.spec\\.ts',
    '/tests/test_',
    '/tests/diagnose\\.spec\\.ts',
    '/tests/design-system/',
    '/tests/migration/',
    '/tests/texture-management/',
    // Exclude tests that require Phaser/browser globals
    '/tests/stratix-rts/ui/ZoneUI\\.test\\.ts',
    '/src/stratix-core/__tests__/UnifiedOpenClawConnectionManager\\.test\\.ts',
    '/tests/project-management/unit/ProjectStore\\.test\\.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/stratix-project/**/*.ts',
    '!src/stratix-project/**/*.d.ts',
    '!src/stratix-project/index.ts',
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
