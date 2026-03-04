/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  coveragePathIgnorePatterns: [
    '/__tests__/fixtures\\.ts$',
    '/merging/trace\\.ts$',
  ],
  transform: {
    '^.+.tsx?$': ['ts-jest', {}],
  },
};
