import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen,
  FileText,
  Folder,
  Plus,
  Trash2,
  Download,
  Moon,
  Sun,
  Bell,
  ClipboardCheck,
  RefreshCw,
  Copy,
  ExternalLink,
} from 'lucide-react';
import type { MountedLaptopFile, WorkspaceFileEntry } from '../types';
import {
  checkLocalOsBridge,
  connectViaBridgePopup,
  deleteLaptopFile,
  deleteOsBridgeFile,
  getBridgeDownloadUrl,
  getBridgePairToken,
  isFileSystemAccessSupported,
  isInIframe,
  listLaptopFolderEntries,
  listOsBridgeFiles,
  parseWebkitDirectoryFiles,
  pickRealLaptopFolder,
  readLaptopFile,
  readOsBridgeFile,
  sendOsBridgeSetting,
  writeOsBridgeFile,
  type BridgeHealth,
  type LaptopDirectoryHandle,
} from '../services/localLaptopBridge';

interface SystemControlViewProps {
  darkMode: boolean;
  onToggleDarkMode: (dark: boolean) => void;
  laptopDirHandle: LaptopDirectoryHandle | null;
  onMountLaptopDir: (handle: LaptopDirectoryHandle | null) => void;
  mountedFiles: MountedLaptopFile[];
  mountedFolderName: string | null;
  onMountFilesList: (folderName: string, files: MountedLaptopFile[]) => void;
  onProposeWriteFile: (path: string, content: string) => void;
  onProposeDeleteFile: (path: string) => void;
}

export const SystemControlView: React.FC<SystemControlViewProps> = ({
  darkMode,
  onToggleDarkMode,
  laptopDirHandle,
  onMountLaptopDir,
  mountedFiles,
  mountedFolderName,
  onMountFilesList,
  onProposeWriteFile,
  onProposeDeleteFile,
}) => {
  const [source, setSource] = useState<'server' | 'laptop-fs' | 'bridge'>(
    laptopDirHandle || mountedFiles.length > 0 ? 'laptop-fs' : 'server'
  );
  const [currentDir, setCurrentDir] = useState('');
  const [bridgeDir, setBridgeDir] = useState<string>('');
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [newFilename, setNewFilename] = useState('');
  const [bridge, setBridge] = useState<BridgeHealth>({ online: false });
  const [checkingBridge, setCheckingBridge] = useState(false);
  const [customBridgeUrl, setCustomBridgeUrl] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const dirInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    setStatusMessage(null);
    if (source === 'laptop-fs') {
      if (laptopDirHandle) {
        try {
          const list = await listLaptopFolderEntries(laptopDirHandle);
          setEntries(list);
        } catch (err) {
          setStatusMessage(err instanceof Error ? err.message : 'Failed reading laptop folder');
        }
      } else if (mountedFiles.length > 0) {
        setEntries(
          mountedFiles.slice(0, 200).map((f) => ({
            name: f.path,
            path: f.path,
            type: 'file' as const,
            size: f.size,
            modifiedAt: f.modifiedAt,
            source: 'laptop-fs' as const,
          }))
        );
      } else {
        setEntries([]);
      }
      return;
    }

    if (source === 'bridge') {
      try {
        const res = await listOsBridgeFiles(bridgeDir || undefined);
        setBridgeDir(res.dir);
        setEntries(res.entries);
      } catch (err) {
        setStatusMessage(err instanceof Error ? err.message : 'Bridge directory listing failed');
      }
      return;
    }

    try {
      const res = await fetch(`/api/system/workspace-files?dir=${encodeURIComponent(currentDir)}`);
      const data = (await res.json()) as { entries?: WorkspaceFileEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed listing workspace files');
      setEntries(data.entries || []);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed loading files');
    }
  }, [source, laptopDirHandle, mountedFiles, bridgeDir, currentDir]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleCheckBridge = useCallback(
    async (announce = true) => {
      setCheckingBridge(true);
      try {
        const res = await checkLocalOsBridge(customBridgeUrl.trim() || undefined);
        setBridge(res);
        if (announce) {
          if (res.online) {
            const modeLabel =
              res.mode === 'popup'
                ? 'Local Bridge Window'
                : res.mode === 'relay'
                ? 'Encrypted HTTPS Relay'
                : 'Local Loopback';
            setStatusMessage(
              `Connected to ${res.hostname || 'your laptop'} (${res.platform || 'OS'}) via ${modeLabel}.`
            );
          } else {
            setStatusMessage(
              res.diagnostic ||
                'Local OS Bridge not detected. Re-download azaris-local-bridge.mjs, restart it, and click Connect Bridge Window.'
            );
          }
        }
      } finally {
        setCheckingBridge(false);
      }
    },
    [customBridgeUrl]
  );

  const handleConnectPopup = async () => {
    setCheckingBridge(true);
    setStatusMessage('Opening http://127.0.0.1:43110/popup to pair directly with your laptop...');
    try {
      const res = await connectViaBridgePopup();
      setBridge(res);
      if (res.online) {
        setStatusMessage(
          `Connected to ${res.hostname || 'your laptop'} (${res.platform || 'OS'}) via Local Bridge Window. Keep that small window open or minimized.`
        );
      } else {
        setStatusMessage(
          res.diagnostic ||
            'Bridge popup did not answer. Re-download the latest azaris-local-bridge.mjs and restart it on port 43110.'
        );
      }
    } finally {
      setCheckingBridge(false);
    }
  };

  useEffect(() => {
    handleCheckBridge(false);
    const interval = setInterval(() => {
      handleCheckBridge(false);
    }, 4500);
    return () => clearInterval(interval);
  }, [handleCheckBridge]);

  // Safe mounting: uses showDirectoryPicker when top-level, and seamless <input webkitdirectory> inside iframes!
  const handleMountFolder = async () => {
    setStatusMessage(null);
    if (isFileSystemAccessSupported()) {
      try {
        const handle = await pickRealLaptopFolder();
        onMountLaptopDir(handle);
        setSource('laptop-fs');
        setSelectedPath(null);
        setEditorContent('');
        setStatusMessage(`Mounted real laptop folder (Read/Write): ${handle.name}`);
        return;
      } catch (err) {
        // Fall through to webkitdirectory picker if blocked by iframe policy
        if (!(err instanceof Error && err.name === 'AbortError')) {
          dirInputRef.current?.click();
          return;
        }
        return;
      }
    }
    dirInputRef.current?.click();
  };

  const handleWebkitDirectorySelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const { folderName, files } = parseWebkitDirectoryFiles(fileList);
    onMountFilesList(folderName, files);
    setSource('laptop-fs');
    setSelectedPath(null);
    setEditorContent('');
    setStatusMessage(`Mounted "${folderName}" (${files.length} real files from your laptop).`);
    e.target.value = '';
  };

  const handleOpenEntry = async (entry: WorkspaceFileEntry) => {
    if (entry.type === 'directory') {
      if (source === 'server') {
        setCurrentDir(entry.path);
      } else if (source === 'bridge') {
        setBridgeDir(entry.path);
      }
      return;
    }

    setSelectedPath(entry.path);
    if (source === 'laptop-fs') {
      if (laptopDirHandle) {
        const txt = await readLaptopFile(laptopDirHandle, entry.name);
        setEditorContent(txt);
      } else {
        const match = mountedFiles.find((f) => f.path === entry.path);
        if (match) {
          const txt = await match.file.text();
          setEditorContent(txt);
        }
      }
      return;
    }

    if (source === 'bridge') {
      const txt = await readOsBridgeFile(entry.path);
      setEditorContent(txt);
      return;
    }

    const res = await fetch('/api/system/workspace-files/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: entry.path }),
    });
    const d = (await res.json()) as { content?: string };
    setEditorContent(d.content || '');
  };

  const handleSaveSelected = async () => {
    if (!selectedPath) return;
    if (source === 'bridge') {
      await writeOsBridgeFile(selectedPath, editorContent);
      setStatusMessage(`Saved changes directly to ${selectedPath} via Local Bridge.`);
      return;
    }
    if (source === 'laptop-fs' && !laptopDirHandle) {
      // Download updated file back to laptop when mounted via iframe webkitdirectory
      const blob = new Blob([editorContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = selectedPath.split('/').pop() || 'edited-file.txt';
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage('Downloaded updated file to your laptop Downloads folder (run Local Bridge for in-place overwrite).');
      return;
    }
    onProposeWriteFile(selectedPath, editorContent);
  };

  const handleCreateFile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilename.trim()) return;
    if (source === 'bridge' && bridgeDir) {
      writeOsBridgeFile(`${bridgeDir}/${newFilename.trim()}`, `# ${newFilename.trim()}\n`).then(loadFiles);
      setNewFilename('');
      return;
    }
    const fullPath = source === 'server' && currentDir ? `${currentDir}/${newFilename.trim()}` : newFilename.trim();
    onProposeWriteFile(fullPath, `# ${newFilename.trim()}\nCreated via Azaris System Control.\n`);
    setNewFilename('');
  };

  const handleDeleteEntry = async (entry: WorkspaceFileEntry) => {
    if (source === 'bridge') {
      await deleteOsBridgeFile(entry.path);
      await loadFiles();
      return;
    }
    if (source === 'laptop-fs' && laptopDirHandle) {
      await deleteLaptopFile(laptopDirHandle, entry.name);
      await loadFiles();
      return;
    }
    onProposeDeleteFile(entry.path);
  };

  const handleWakeLock = async () => {
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (!nav.wakeLock) {
        setStatusMessage('Screen Wake Lock API not supported in this browser.');
        return;
      }
      await nav.wakeLock.request('screen');
      setWakeLockActive(true);
      setStatusMessage('Screen Wake Lock enabled — laptop display will stay awake.');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Wake Lock request declined.');
    }
  };

  const handleNotifications = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      new Notification('Azaris Workstation', { body: 'Desktop notifications are active.' });
      setStatusMessage('Desktop notifications enabled.');
    } else {
      setStatusMessage(`Notification permission: ${perm}`);
    }
  };

  const handleCopyClipboard = async () => {
    if (!editorContent) return;
    await navigator.clipboard.writeText(editorContent);
    setStatusMessage('Selected file contents copied to system clipboard.');
  };

  const handleOsBridgeAction = async (setting: string, value: string) => {
    const res = await sendOsBridgeSetting(setting, value);
    setStatusMessage(res.ok ? `OS Setting applied (${setting} = ${value})` : res.error || 'Bridge error');
  };

  const laptopLabel = laptopDirHandle?.name || mountedFolderName;

  return (
    <div className="space-y-6">
      <input
        ref={dirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard in Chromium/Safari/Firefox for folder upload
        webkitdirectory=""
        directory=""
        multiple
        onChange={handleWebkitDirectorySelected}
        className="hidden"
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
            Laptop Settings & System Files
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Mount any folder on your laptop, manage workspace files, and control device or OS settings via natural language.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMountFolder}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {laptopLabel ? `Mounted: ${laptopLabel}` : 'Mount Real Laptop Folder'}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-2.5 text-xs text-blue-800 dark:text-blue-200">
          {statusMessage}
        </div>
      )}

      {/* Hardware & OS Controls */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Workstation & Browser Controls</h3>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => onToggleDarkMode(!darkMode)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            </button>
            <button
              type="button"
              onClick={handleWakeLock}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {wakeLockActive ? 'Screen Awake Active' : 'Keep Screen Awake'}
            </button>
            <button
              type="button"
              onClick={handleNotifications}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Bell className="w-3.5 h-3.5" />
              Test Desktop Notification
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Local OS Companion Bridge
            </h3>
            <span className={`text-xs font-medium ${bridge.online ? 'text-emerald-600' : 'text-slate-500'}`}>
              {bridge.online
                ? `Connected (${bridge.platform}${
                    bridge.mode === 'popup' ? ' · Popup' : bridge.mode === 'relay' ? ' · Relay' : ' · Local'
                  })`
                : checkingBridge
                ? 'Checking...'
                : 'Not Connected'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Run <code className="font-mono">node azaris-local-bridge.mjs</code> on your laptop, then click{' '}
            <strong>Connect Bridge Window</strong> (works inside HTTPS iframes without browser blocks).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={getBridgeDownloadUrl()}
              download="azaris-local-bridge.mjs"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              Download Bridge Script
            </a>
            <button
              type="button"
              disabled={checkingBridge}
              onClick={handleConnectPopup}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-60"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Connect Bridge Window
            </button>
            <button
              type="button"
              disabled={checkingBridge}
              onClick={() => handleCheckBridge(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingBridge ? 'animate-spin' : ''}`} />
              {checkingBridge ? 'Checking...' : 'Re-check'}
            </button>
            {isInIframe() && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Full Tab
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                const origin = window.location.origin;
                const token = getBridgePairToken();
                const cmd = `node azaris-local-bridge.mjs --relay "${origin}" --token "${token}"`;
                navigator.clipboard.writeText(cmd);
                setStatusMessage('Copied terminal command! If you downloaded an earlier version, re-download Bridge Script first.');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Command
            </button>
            {bridge.online && (
              <button
                type="button"
                onClick={() => handleOsBridgeAction('os_volume', '50')}
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium"
              >
                Set OS Volume 50%
              </button>
            )}
          </div>
          {!bridge.online && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={customBridgeUrl}
                onChange={(e) => setCustomBridgeUrl(e.target.value)}
                placeholder="Optional custom URL (e.g. https://xxxx.trycloudflare.com)"
                className="flex-1 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => handleCheckBridge(true)}
                className="h-8 px-3 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium"
              >
                Connect
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Real Filesystem Explorer & Editor */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setSource('server');
                setSelectedPath(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                source === 'server' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Workspace Files
            </button>
            <button
              type="button"
              disabled={!laptopLabel}
              onClick={() => {
                setSource('laptop-fs');
                setSelectedPath(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md disabled:opacity-40 ${
                source === 'laptop-fs' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Laptop Folder {laptopLabel ? `(${laptopLabel})` : '(Not Mounted)'}
            </button>
            <button
              type="button"
              disabled={!bridge.online}
              onClick={() => {
                setSource('bridge');
                setSelectedPath(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md disabled:opacity-40 ${
                source === 'bridge' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Live Laptop Disk {bridge.online ? '(Bridge)' : '(Offline)'}
            </button>
          </div>

          <form onSubmit={handleCreateFile} className="flex items-center gap-2">
            <input
              type="text"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
              placeholder="New file (e.g. Notes.md)"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            />
            <button
              type="submit"
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Create
            </button>
          </form>
        </div>

        {source === 'server' && currentDir && (
          <button
            type="button"
            onClick={() => setCurrentDir('')}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
          >
            ← Back to workspace root (/{currentDir})
          </button>
        )}

        {source === 'bridge' && bridgeDir && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setBridgeDir(bridge.home || '')}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
            >
              Home ({bridgeDir})
            </button>
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-[340px] overflow-y-auto">
            {entries.length === 0 && (
              <div className="p-4 text-xs text-slate-400">No files in this directory.</div>
            )}
            {entries.map((entry) => (
              <div
                key={entry.path}
                className={`flex items-center justify-between px-3 py-2.5 text-xs ${
                  selectedPath === entry.path ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleOpenEntry(entry)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  {entry.type === 'directory' ? (
                    <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className="truncate font-medium">{entry.name}</span>
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">{entry.size} B</span>
                  {(source !== 'laptop-fs' || laptopDirHandle) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(entry)}
                      aria-label={`Delete ${entry.name}`}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-7 flex flex-col space-y-2">
            {selectedPath ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-500 truncate max-w-[260px]">{selectedPath}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyClipboard}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSelected}
                      className="px-3 py-1 rounded bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
                    >
                      {source === 'laptop-fs' && !laptopDirHandle ? 'Download Edited File' : 'Save'}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={12}
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 font-mono text-xs leading-relaxed"
                />
              </>
            ) : (
              <div className="h-full min-h-[240px] rounded-lg border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-xs text-slate-400">
                Select any file on the left to inspect or edit it.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
