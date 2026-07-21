/**
 * Preload bridge. DP-8 exposes the frozen, narrow window.deskPulse surface via
 * contextBridge — never ipcRenderer itself, never Node globals (PDD §17).
 * Until then this file only proves the preload pipeline builds and loads.
 */
export {};
