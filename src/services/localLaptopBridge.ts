import type { MountedLaptopFile, WorkspaceFileEntry } from '../types';

export interface LaptopDirectoryHandle {
  name: string;
  entries: () => AsyncIterable<[string, FileSystemHandle]>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<LaptopDirectoryHandle>;
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
}

export function isInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && !isInIframe();
}

export async function pickRealLaptopFolder(): Promise<LaptopDirectoryHandle> {
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<LaptopDirectoryHandle>;
  };
  if (!w.showDirectoryPicker) {
    throw new Error('File System Access API requires Chrome or Edge.');
  }
  return await w.showDirectoryPicker({ mode: 'readwrite' });
}

export async function listLaptopFolderEntries(dirHandle: LaptopDirectoryHandle): Promise<WorkspaceFileEntry[]> {
  const entries: WorkspaceFileEntry[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    let size = 0;
    let modifiedAt = new Date().toISOString();
    if (handle.kind === 'file') {
      try {
        const f = await (handle as FileSystemFileHandle).getFile();
        size = f.size;
        modifiedAt = new Date(f.lastModified).toISOString();
      } catch {
        // Ignore unreadable system file metadata
      }
    }
    entries.push({
      name,
      path: name,
      type: handle.kind === 'directory' ? 'directory' : 'file',
      size,
      modifiedAt,
      source: 'laptop-fs',
    });
  }
  return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
}

export async function readLaptopFile(dirHandle: LaptopDirectoryHandle, filename: string): Promise<string> {
  const fileHandle = await dirHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return await file.text();
}

export async function writeLaptopFile(
  dirHandle: LaptopDirectoryHandle,
  filename: string,
  content: string
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function deleteLaptopFile(dirHandle: LaptopDirectoryHandle, filename: string): Promise<void> {
  await dirHandle.removeEntry(filename, { recursive: true });
}

export function parseWebkitDirectoryFiles(fileList: FileList): { folderName: string; files: MountedLaptopFile[] } {
  const arr = Array.from(fileList);
  const firstPath = arr[0]?.webkitRelativePath || '';
  const folderName = firstPath.split('/')[0] || 'Laptop Folder';
  const files: MountedLaptopFile[] = arr.map((f) => ({
    name: f.name,
    path: f.webkitRelativePath || f.name,
    size: f.size,
    modifiedAt: new Date(f.lastModified).toISOString(),
    file: f,
  }));
  return { folderName, files };
}

export interface BridgeHealth {
  online: boolean;
  mode?: 'direct' | 'relay' | 'popup';
  platform?: string;
  hostname?: string;
  home?: string;
  diagnostic?: string;
}

const BRIDGE_TOKEN_STORAGE_KEY = 'azaris_bridge_pair_token';
let cachedBridgeToken: string | null = null;
let activeDirectUrl: string | null = null;
let activeTransport: 'direct' | 'relay' | 'popup' | 'none' = 'none';
let bridgePopupWindow: Window | null = null;
let popupBridgeHealth: BridgeHealth | null = null;
let popupListenerAttached = false;
const popupReadyWaiters: Array<(health: BridgeHealth) => void> = [];
const pendingPopupCalls = new Map<
  string,
  {
    resolve: (data: Record<string, unknown>) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function ensurePopupListener() {
  if (popupListenerAttached || typeof window === 'undefined') return;
  popupListenerAttached = true;

  window.addEventListener('message', (ev: MessageEvent) => {
    if (
      ev.origin !== 'http://127.0.0.1:43110' &&
      ev.origin !== 'http://localhost:43110'
    ) {
      return;
    }
    const msg = (ev.data || {}) as {
      type?: string;
      id?: string;
      ok?: boolean;
      data?: Record<string, unknown>;
      error?: string;
      platform?: string;
      hostname?: string;
      home?: string;
    };

    if (msg.type === 'azaris-bridge-ready') {
      if (ev.source && typeof (ev.source as Window).postMessage === 'function') {
        bridgePopupWindow = ev.source as Window;
      }
      const health: BridgeHealth = {
        online: true,
        mode: 'popup',
        platform: msg.platform,
        hostname: msg.hostname,
        home: msg.home,
      };
      popupBridgeHealth = health;
      activeTransport = 'popup';
      while (popupReadyWaiters.length > 0) {
        const w = popupReadyWaiters.shift();
        w?.(health);
      }
      return;
    }

    if (msg.type === 'azaris-bridge-res' && msg.id) {
      const pending = pendingPopupCalls.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingPopupCalls.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.data || {});
      } else {
        pending.reject(new Error(msg.error || 'Local popup bridge execution failed'));
      }
    }
  });
}

export function getBridgePairToken(): string {
  if (cachedBridgeToken) return cachedBridgeToken;
  try {
    const existing = window.localStorage.getItem(BRIDGE_TOKEN_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) {
      cachedBridgeToken = existing;
      return existing;
    }
    const generated =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : `az${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(BRIDGE_TOKEN_STORAGE_KEY, generated);
    cachedBridgeToken = generated;
    return generated;
  } catch {
    cachedBridgeToken = `az${Date.now()}`;
    return cachedBridgeToken;
  }
}

export function getBridgeDownloadUrl(): string {
  const token = getBridgePairToken();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `/api/system/local-bridge-script?origin=${encodeURIComponent(origin)}&token=${encodeURIComponent(token)}`;
}

function formatBridgeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (err instanceof TypeError || /failed to fetch|load failed|networkerror|abort/i.test(msg)) {
    return 'Browser blocked direct port 43110 inside iframe. In Laptop & Files, click "Connect Bridge Window" (after updating azaris-local-bridge.mjs) or open Azaris in a top-level browser tab.';
  }
  return msg || 'Local OS Companion Bridge request failed.';
}

export async function connectViaBridgePopup(): Promise<BridgeHealth> {
  ensurePopupListener();

  if (bridgePopupWindow && !bridgePopupWindow.closed && popupBridgeHealth?.online) {
    activeTransport = 'popup';
    return popupBridgeHealth;
  }

  const popup = window.open(
    'http://127.0.0.1:43110/popup',
    'azaris_local_bridge',
    'width=440,height=320'
  );
  if (!popup) {
    return {
      online: false,
      diagnostic: 'Popup blocked by browser. Allow popups for this site and click "Connect Bridge Window" again.',
    };
  }
  bridgePopupWindow = popup;

  return await new Promise<BridgeHealth>((resolve) => {
    let settled = false;
    const onReady = (health: BridgeHealth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(pingInterval);
      resolve(health);
    };

    popupReadyWaiters.push(onReady);

    const pingInterval = setInterval(() => {
      if (popup.closed) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          clearInterval(pingInterval);
          resolve({
            online: false,
            diagnostic: 'Bridge window was closed before handshake completed.',
          });
        }
        return;
      }
      try {
        popup.postMessage({ type: 'azaris-bridge-ping' }, '*');
      } catch {
        // Ignore cross-origin postMessage startup race
      }
    }, 350);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(pingInterval);
      const idx = popupReadyWaiters.indexOf(onReady);
      if (idx !== -1) popupReadyWaiters.splice(idx, 1);
      resolve({
        online: false,
        diagnostic:
          'Bridge window did not respond on http://127.0.0.1:43110/popup. Make sure you re-downloaded the latest azaris-local-bridge.mjs and restarted it with "node azaris-local-bridge.mjs".',
      });
    }, 4500);
  });
}

async function tryDirectHealth(baseUrl: string): Promise<BridgeHealth | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1400);
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; platform?: string; hostname?: string; home?: string };
    if (!data.ok) return null;
    return {
      online: true,
      mode: 'direct',
      platform: data.platform,
      hostname: data.hostname,
      home: data.home,
    };
  } catch {
    return null;
  }
}

export async function checkLocalOsBridge(customUrl?: string): Promise<BridgeHealth> {
  ensurePopupListener();

  if (bridgePopupWindow && !bridgePopupWindow.closed && popupBridgeHealth?.online) {
    activeTransport = 'popup';
    return popupBridgeHealth;
  }

  const candidates = [
    ...(customUrl ? [customUrl.replace(/\/+$/, '')] : []),
    'http://127.0.0.1:43110',
    'http://localhost:43110',
  ];

  for (const url of candidates) {
    const hit = await tryDirectHealth(url);
    if (hit) {
      activeDirectUrl = url;
      activeTransport = 'direct';
      return hit;
    }
  }

  // Fallback to authenticated HTTPS Relay (works when app URL has no IAP auth gate)
  try {
    const token = getBridgePairToken();
    const res = await fetch(`/api/bridge/relay/health?token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const data = (await res.json()) as {
        online?: boolean;
        platform?: string;
        hostname?: string;
        home?: string;
      };
      if (data.online) {
        activeTransport = 'relay';
        activeDirectUrl = null;
        return {
          online: true,
          mode: 'relay',
          platform: data.platform,
          hostname: data.hostname,
          home: data.home,
        };
      }
    }
  } catch {
    // Ignore relay probe failure
  }

  activeTransport = 'none';
  activeDirectUrl = null;
  return {
    online: false,
    diagnostic: isInIframe()
      ? 'Browser blocked direct port 43110 inside this preview iframe. Re-download the latest azaris-local-bridge.mjs, restart it, and click "Connect Bridge Window" (or open Azaris in a top-level tab).'
      : 'Port 43110 did not respond. Download & run "node azaris-local-bridge.mjs", then click Re-check / Connect.',
  };
}

async function callBridgeEndpoint<T extends Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 10000
): Promise<T> {
  ensurePopupListener();

  if (activeTransport === 'none') {
    await checkLocalOsBridge();
  }

  if (activeTransport === 'popup') {
    if (!bridgePopupWindow || bridgePopupWindow.closed) {
      activeTransport = 'none';
      popupBridgeHealth = null;
    } else {
      return await new Promise<T>((resolve, reject) => {
        const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const timer = setTimeout(() => {
          pendingPopupCalls.delete(id);
          reject(new Error('Timed out waiting for local bridge popup window.'));
        }, timeoutMs);
        pendingPopupCalls.set(id, {
          resolve: (d) => resolve(d as T),
          reject,
          timer,
        });
        bridgePopupWindow!.postMessage({ type: 'azaris-bridge-cmd', id, action, payload }, '*');
      });
    }
  }

  if (activeTransport === 'direct' && activeDirectUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${activeDirectUrl}${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = (await res.json()) as T & { error?: string };
      if (!res.ok) throw new Error(data.error || `Bridge HTTP ${res.status}`);
      return data;
    } catch (err) {
      const recheck = await checkLocalOsBridge();
      if (recheck.mode !== 'relay' && recheck.mode !== 'popup') {
        throw new Error(formatBridgeError(err));
      }
    }
  }

  if (activeTransport === 'relay') {
    const res = await fetch('/api/bridge/relay/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: getBridgePairToken(),
        action,
        payload,
      }),
    });
    const data = (await res.json()) as T & { ok?: boolean; error?: string };
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Relay bridge HTTP ${res.status}`);
    }
    return data;
  }

  throw new Error(formatBridgeError(new TypeError('Failed to fetch')));
}

export async function sendOsBridgeSetting(
  setting: string,
  value: string
): Promise<{ ok: boolean; output?: string; error?: string }> {
  try {
    const data = await callBridgeEndpoint<{ ok?: boolean; output?: string }>('/setting', { setting, value }, 6000);
    return { ok: Boolean(data.ok), output: data.output };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : formatBridgeError(err) };
  }
}

export async function listOsBridgeFiles(dir?: string): Promise<{ dir: string; entries: WorkspaceFileEntry[] }> {
  const data = await callBridgeEndpoint<{
    dir?: string;
    entries?: Array<{ name: string; path: string; type: 'file' | 'directory'; size: number; modifiedAt: string }>;
  }>('/files/list', { dir });
  return {
    dir: data.dir || '',
    entries: (data.entries || []).map((e) => ({ ...e, source: 'laptop-fs' })),
  };
}

export async function readOsBridgeFile(filePath: string): Promise<string> {
  const data = await callBridgeEndpoint<{ content?: string }>('/files/read', { path: filePath });
  return data.content || '';
}

export async function writeOsBridgeFile(filePath: string, content: string): Promise<void> {
  await callBridgeEndpoint('/files/write', { path: filePath, content });
}

export async function deleteOsBridgeFile(filePath: string): Promise<void> {
  await callBridgeEndpoint('/files/delete', { path: filePath });
}

export async function triggerOsBridgeCall(phone: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await callBridgeEndpoint<{ ok?: boolean }>('/call', { phone }, 5000);
    return { ok: Boolean(data.ok) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : formatBridgeError(err) };
  }
}

export async function triggerOsBridgeHangup(): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await callBridgeEndpoint<{ ok?: boolean }>('/call/hangup', {}, 4000);
    return { ok: Boolean(data.ok) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : formatBridgeError(err) };
  }
}
