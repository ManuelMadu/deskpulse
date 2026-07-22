import { Menu, Tray, nativeImage } from 'electron';

import { buildTrayView } from './tray-model.js';
import { TRAY_ICONS } from './tray-icons.generated.js';

import type { HealthSnapshot, TrayHealth } from './health-state.js';
import type { TrayView } from './tray-model.js';
import type { NativeImage } from 'electron';

/**
 * The menu-bar presence (PDD §13/§16). A single Tray whose icon reflects the
 * three aggregate health states and whose dropdown summarises status, lists
 * monitors, and offers Open / Pause all / Quit. The icon is a template image
 * so macOS tints it for light/dark menu bars automatically.
 */

export interface TrayActions {
  onOpen: () => void;
  onPauseAll: () => void;
  onQuit: () => void;
}

const ICON_KEY: Record<TrayHealth, keyof typeof TRAY_ICONS> = {
  nominal: 'nominal',
  degraded: 'degraded',
  'agent-down': 'agentDown',
};

function trayImage(health: TrayHealth): NativeImage {
  const png = TRAY_ICONS[ICON_KEY[health]];
  const image = nativeImage.createFromBuffer(Buffer.from(png.x1, 'base64'));
  image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(png.x2, 'base64') });
  image.setTemplateImage(true);
  return image;
}

export class TrayController {
  private tray: Tray | undefined;
  private currentIcon: TrayHealth | undefined;

  constructor(private readonly actions: TrayActions) {}

  /** Create the tray immediately at launch (PDD §13: fast feedback). */
  create(initial: HealthSnapshot): void {
    if (this.tray) {
      return;
    }
    const view = buildTrayView(initial);
    this.tray = new Tray(trayImage(view.icon));
    this.currentIcon = view.icon;
    this.tray.setToolTip(view.tooltip);
    this.render(view);
  }

  /** Reflect a new health snapshot: swap the icon and rebuild the menu. */
  update(snapshot: HealthSnapshot): void {
    if (!this.tray) {
      return;
    }
    const view = buildTrayView(snapshot);
    if (view.icon !== this.currentIcon) {
      this.tray.setImage(trayImage(view.icon));
      this.currentIcon = view.icon;
    }
    this.tray.setToolTip(view.tooltip);
    this.render(view);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }

  private render(view: TrayView): void {
    if (!this.tray) {
      return;
    }
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: view.statusLine, enabled: false },
      { type: 'separator' },
    ];

    if (view.monitorRows.length === 0) {
      template.push({ label: 'No monitors configured', enabled: false });
    } else {
      for (const row of view.monitorRows) {
        template.push({ label: row.label, enabled: false });
      }
      if (view.overflowCount > 0) {
        template.push({ label: `${view.overflowCount} more…`, enabled: false });
      }
    }

    template.push(
      { type: 'separator' },
      { label: 'Open DeskPulse', click: () => this.actions.onOpen() },
      {
        label: 'Pause all monitors',
        enabled: view.monitorRows.length > 0,
        click: () => this.actions.onPauseAll(),
      },
      { type: 'separator' },
      { label: 'Quit DeskPulse', click: () => this.actions.onQuit() },
    );

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }
}
