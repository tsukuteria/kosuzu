import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.npm-cache/**'] },
  {
    files: ['ecosystem.config.cjs'],
    languageOptions: { globals: { module: 'readonly', __dirname: 'readonly' } },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
