import type { Config } from 'jest';

const config: Config = {
  projects: [
    '<rootDir>/apps/backend',
    '<rootDir>/apps/mcp-local',
    '<rootDir>/libraries/nestjs-libraries',
  ],
};

export default config;
