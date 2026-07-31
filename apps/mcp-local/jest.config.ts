import type { Config } from 'jest';

const config: Config = {
  displayName: 'mcp-local',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'node16',
          moduleResolution: 'node16',
          isolatedModules: true,
          target: 'es2020',
          lib: ['es2021', 'dom'],
          strict: true,
          esModuleInterop: true,
          types: ['node', 'jest'],
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};

export default config;
