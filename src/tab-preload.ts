import { contextBridge } from 'electron';

// Runs in every page of the MODit browser, including iframes (the Cloudflare "verify you are human" box is an iframe).
// A real Chrome has a window.chrome object and Electron does not; its absence is one of the things bot checks look for.
try {
  contextBridge.exposeInMainWorld('chrome', {
    app: { isInstalled: false },
    csi: () => ({}),
    loadTimes: () => ({}),
    runtime: {},
  });
} catch { /* already defined */ }