import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'DeskPulse',
    appBundleId: 'com.manuelmadubugini.deskpulse',
    appCategoryType: 'public.app-category.developer-tools',
    asar: true,
    // Phase 2 adds extraResource: the esbuild agent bundle
    // (services/system-agent/dist/agent.cjs), resolved at runtime via
    // process.resourcesPath. Signing/notarization stays behind env-controlled
    // config until a paid Apple Developer account exists (PDD §34).
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin']), new MakerDMG({}, ['darwin'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      // RunAsNode stays ENABLED — deliberately diverging from the Forge
      // template: the supervisor launches the bundled system agent with
      // ELECTRON_RUN_AS_NODE=1 (PDD §28, OD-1). Every other fuse is locked.
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
