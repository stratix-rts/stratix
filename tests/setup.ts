import { jest } from '@jest/globals';

jest.setTimeout(10000);

beforeAll(() => {
  console.log('🚀 Starting tests...');
});

afterAll(() => {
  console.log('✅ All tests completed');
});
