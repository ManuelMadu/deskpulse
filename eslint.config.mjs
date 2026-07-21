// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Node built-ins that must not leak into the contracts package (runtime-pure)
 * or the renderer (sandboxed, no Node access). The `node:*` pattern catches
 * prefixed forms; the bare names catch legacy unprefixed imports.
 */
const NODE_BUILTINS = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/.vite/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // Plain JS config files (this file, esbuild configs): no typed linting
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ── Dependency walls (§35 of the PDD; dependency-cruiser enforces the full graph in CI) ──

  // contracts: pure — zod only, no Electron, no Node built-ins at runtime
  {
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...NODE_BUILTINS.map((m) => ({
              name: m,
              message: 'packages/contracts must stay runtime-pure (no Node built-ins).',
            })),
            { name: 'electron', message: 'packages/contracts must not depend on Electron.' },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'packages/contracts must stay runtime-pure (no Node built-ins).',
            },
            {
              group: ['@deskpulse/*'],
              message: 'packages/contracts must not depend on other workspaces.',
            },
          ],
        },
      ],
    },
  },

  // agent: plain Node — never Electron, never desktop code
  {
    files: ['services/system-agent/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'The agent is a standalone Node process.' }],
          patterns: [
            { group: ['@deskpulse/desktop*'], message: 'The agent must not import desktop code.' },
          ],
        },
      ],
    },
  },

  // renderer: sandboxed web code — no Electron, no Node
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...NODE_BUILTINS.map((m) => ({
              name: m,
              message: 'The renderer is sandboxed: no Node built-ins.',
            })),
            { name: 'electron', message: 'The renderer must not import Electron.' },
          ],
          patterns: [
            { group: ['node:*'], message: 'The renderer is sandboxed: no Node built-ins.' },
            {
              group: ['@deskpulse/system-agent*'],
              message: 'The renderer must not import agent code.',
            },
          ],
        },
      ],
    },
  },

  // desktop main/preload: Electron allowed, agent source forbidden
  {
    files: ['apps/desktop/src/main/**/*.ts', 'apps/desktop/src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@deskpulse/system-agent*'],
              message:
                'Desktop must never import agent source — it spawns the built agent bundle only.',
            },
          ],
        },
      ],
    },
  },

  // tests: relax the strictest type rules where mocking makes them noisy
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
