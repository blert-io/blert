/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/**/__tests__/*.test.ts'],
      transform: {
        '^.+.tsx?$': ['ts-jest', {}],
      },
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
      transform: {
        '^.+.tsx?$': ['ts-jest', {}],
      },
      setupFilesAfterEnv: ['<rootDir>/__tests__/integration/setup.ts'],
    },
  ],
};
