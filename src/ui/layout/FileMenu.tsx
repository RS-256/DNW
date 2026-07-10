/**
 * File operations: new / open (.dnw.json or .nbs) / save / export (via the
 * shared export modal), plus the song title field.
 */
import { useState } from 'react';
import { createDefaultSong } from '../../core/model/song';
import { readNbs } from '../../core/nbs/reader';
import { NBS_FILTER, PROJECT_FILTER } from '../../core/platform/fileFilters';
import { webAdapter } from '../../core/platform/webAdapter';
import { deserializeProject, serializeProject } from '../../core/project/serialize';
import ConfirmDialog from '../common/ConfirmDialog';
import ExportModal from '../export/ExportModal';
import { useEditorStore } from '../../state/editorStore';
import { useSongStore } from '../../state/songStore';

function loadSong(song: ReturnType<typeof createDefaultSong>): void {
  useSongStore.getState().replaceSong(song);
  useEditorStore.getState().setActiveLayer(0);
}

export default function FileMenu() {
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | null>(null);
  const [showExport, setShowExport] = useState(false);
  const name = useSongStore((s) => s.song.meta.name);
  const mutate = useSongStore((s) => s.mutate);

  const wrap = (fn: () => Promise<void>) => () => {
    setError(null);
    void fn().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const doNew = () => loadSong(createDefaultSong());

  const doOpen = wrap(async () => {
    const file = await webAdapter.openFile([PROJECT_FILTER, NBS_FILTER]);
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.nbs')) {
      loadSong(readNbs(file.data));
    } else {
      loadSong(deserializeProject(new TextDecoder().decode(file.data)));
    }
  });

  /** Warn before discarding a song that has any notes. */
  const guarded = (action: 'new' | 'open') => () => {
    const hasNotes = useSongStore.getState().song.layers.some((l) => l.notes.length > 0);
    if (hasNotes) setPendingAction(action);
    else if (action === 'new') doNew();
    else doOpen();
  };

  const onSave = wrap(async () => {
    const song = useSongStore.getState().song;
    const base = song.meta.name.trim() || 'untitled';
    await webAdapter.saveFile(`${base}.dnw.json`, serializeProject(song), PROJECT_FILTER);
  });

  return (
    <div className="file-menu">
      <button onClick={guarded('new')}>New</button>
      <button onClick={guarded('open')}>Open</button>
      <button onClick={onSave}>Save</button>
      <button onClick={() => setShowExport(true)} title="Export the song (choose format and tracks)">
        Export…
      </button>
      <input
        className="song-title"
        placeholder="untitled"
        value={name}
        onChange={(e) =>
          mutate((draft) => {
            draft.meta.name = e.target.value;
          })
        }
        title="Song title"
      />
      {error && <span className="file-menu-error">{error}</span>}
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {pendingAction && (
        <ConfirmDialog
          title={pendingAction === 'new' ? 'New song' : 'Open song'}
          message="The current song will be replaced. Unsaved changes will be lost (autosave keeps only the latest state)."
          confirmLabel={pendingAction === 'new' ? 'Discard & New' : 'Discard & Open'}
          onConfirm={() => {
            const action = pendingAction;
            setPendingAction(null);
            if (action === 'new') doNew();
            else doOpen();
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
