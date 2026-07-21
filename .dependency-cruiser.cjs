/**
 * Workspace dependency rules (PDD §35). ESLint's no-restricted-imports gives fast
 * editor feedback; this is the authoritative CI gate over the resolved module graph.
 *
 *   packages/contracts   → zod only; no workspaces, no Electron, no Node built-ins
 *   services/system-agent→ contracts ok; never electron, never apps/*
 *   apps/desktop         → contracts ok; never services/* source (spawns built bundle)
 *   no circular deps anywhere
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      comment:
        'an import that cannot be resolved is either a typo or a forbidden edge hiding behind a missing exports map',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'contracts-no-workspace-deps',
      comment: 'contracts is the shared leaf: it may not depend on any other workspace',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: { path: '^(apps|services|tests)/' },
    },
    {
      name: 'contracts-runtime-pure',
      comment: 'contracts may not use Node built-ins or Electron at runtime',
      severity: 'error',
      from: { path: '^packages/contracts/src', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'contracts-zod-only',
      comment: 'zod is the only npm dependency contracts may use',
      severity: 'error',
      from: { path: '^packages/contracts/src', pathNot: '\\.test\\.ts$' },
      to: { path: 'node_modules', pathNot: 'node_modules/zod' },
    },
    {
      name: 'agent-no-electron',
      severity: 'error',
      from: { path: '^services/system-agent' },
      to: { path: 'node_modules/electron' },
    },
    {
      name: 'agent-no-desktop',
      severity: 'error',
      from: { path: '^services/system-agent' },
      to: { path: '^apps/' },
    },
    {
      name: 'desktop-no-agent-source',
      comment: 'the desktop app spawns the built agent bundle; it never imports agent source',
      severity: 'error',
      from: { path: '^apps/desktop' },
      to: { path: '^services/' },
    },
    {
      name: 'renderer-no-electron',
      comment: 'the renderer is sandboxed; electron may only appear in main/preload',
      severity: 'error',
      from: { path: '^apps/desktop/src/renderer' },
      to: { path: 'node_modules/electron' },
    },
  ],
  options: {
    // Record edges into node_modules and built workspace output, but don't
    // descend into them — workspace imports resolve through symlinks to
    // packages/*/dist, and those edges are exactly what the rules police.
    doNotFollow: { path: 'node_modules|/dist/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    exclude: { path: '\\.test\\.(ts|tsx|js)$' },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
