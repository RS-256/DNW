/**
 * Browser implementation of PlatformAdapter: File System Access API where
 * available (Chromium), falling back to <input type=file> / <a download>.
 */
import type { FileTypeFilter, OpenedFile, PlatformAdapter } from './PlatformAdapter';

interface FsaWindow extends Window {
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
}

function toAcceptTypes(filters: FileTypeFilter[]) {
  return filters.map((f) => ({
    description: f.description,
    accept: { [f.mime ?? 'application/octet-stream']: f.extensions },
  }));
}

async function openViaInput(filters: FileTypeFilter[]): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions).join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, data: await file.arrayBuffer() } : null);
    };
    // Cancel never fires reliably; resolve(null) on window focus loss is
    // overkill for v1 — the promise just stays pending if cancelled.
    input.click();
  });
}

export const webAdapter: PlatformAdapter = {
  async openFile(filters) {
    const w = window as FsaWindow;
    if (w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({ types: toAcceptTypes(filters) });
        if (!handle) return null;
        const file = await handle.getFile();
        return { name: file.name, data: await file.arrayBuffer() };
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return null;
        throw err;
      }
    }
    return openViaInput(filters);
  },

  async saveFile(suggestedName, data, filter) {
    const blobData = typeof data === 'string' ? new Blob([data]) : new Blob([data]);
    const w = window as FsaWindow;
    if (w.showSaveFilePicker) {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName,
          types: toAcceptTypes([filter]),
        });
        const writable = await (
          handle as unknown as {
            createWritable: () => Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
          }
        ).createWritable();
        await writable.write(blobData);
        await writable.close();
        return true;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return false;
        throw err;
      }
    }
    const url = URL.createObjectURL(blobData);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  },
};
