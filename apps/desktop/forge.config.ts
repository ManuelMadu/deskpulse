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
    // The agent ships as a standalone bundle next to the app resources and is
    // spawned with ELECTRON_RUN_AS_NODE — never imported (PDD §34, §35).
    // Signing/notarization stays behind env-controlled config until a paid
    // Apple Developer account exists (PDD §34).
    extraResource: ['../../services/system-agent/dist/agent.cjs'],
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
      // Two fuses stay ENABLED, deliberately diverging from the Forge template
      // (rationale in ADR-0001):
      // - RunAsNode: the supervisor launches the bundled system agent with
      //   ELECTRON_RUN_AS_NODE=1 (PDD §28, OD-1).
      // - NodeCliInspectArguments: Playwright's Electron driver attaches via
      //   --inspect=0; disabling it hangs E2E against the packaged app. With
      //   RunAsNode already enabled this concedes nothing extra to same-user
      //   processes, which the PDD §30 threat model excludes regardless.
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
