// Bundles the agent into a single CJS file for fast startup and clean packaging:
// the Electron app ships dist/agent.cjs via Forge extraResource and runs it with
// ELECTRON_RUN_AS_NODE — no runtime node_modules resolution (PDD §19, §34).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/agent.cjs',
  sourcemap: true,
  // Keep the bundle self-contained: everything (zod, undici, pino, archiver,
  // contracts) is compiled in. Node built-ins stay external automatically.
});
