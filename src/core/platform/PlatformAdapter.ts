/**
 * Platform abstraction for file I/O. The only part of core that must be
 * swapped when packaging as a desktop app (Tauri): implement this interface
 * with native dialogs and keep everything else unchanged.
 */
export interface FileTypeFilter {
  description: string;
  /** Extensions with the dot, e.g. ['.nbs']. */
  extensions: string[];
  mime?: string;
}

export interface OpenedFile {
  name: string;
  data: ArrayBuffer;
}

export interface PlatformAdapter {
  openFile(filters: FileTypeFilter[]): Promise<OpenedFile | null>;
  /** Returns false if the user cancelled. */
  saveFile(
    suggestedName: string,
    data: ArrayBuffer | string,
    filter: FileTypeFilter,
  ): Promise<boolean>;
}
