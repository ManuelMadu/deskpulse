import type { DeskPulseTransport } from '../preload/preload.js';

declare global {
  interface Window {
    deskPulse: DeskPulseTransport;
  }
}

export {};
