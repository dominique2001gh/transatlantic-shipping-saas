import { baseConfig } from '../../eslint.config.base.mjs';

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        // Needed for decorator metadata (NestJS DI, class-validator).
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
    rules: {
      // Nest constructors commonly declare parameter properties that are
      // only read via DI, not "unused".
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: ['dist/**', 'prisma/migrations/**'],
  },
];
