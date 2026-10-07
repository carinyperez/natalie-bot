/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    // Uses tsconfig.json; its isolatedModules makes ts-jest transpile only. `npm run typecheck` checks types.
    '^.+\\.ts$': 'ts-jest',
  },
  // Mirrors the "@shared/*" path in tsconfig.json.
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
  },
};
