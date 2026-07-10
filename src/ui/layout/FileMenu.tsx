/**
 * File operations: new / open (.dnw.json or .nbs) / save / export .nbs,
 * plus the song title field.
 */
import { useState } from 'react';
import { createDefaultSong } from '../../core/model/song';
import { readNbs } from '../../core/nbs/reader';
import { writeNbs } from '../../core/nbs/writer';
import { webAdapter } from '../../core/platform/webAdapter';
import { deserializeProject, serializeProject } from '../../core/project/serialize';
import ConfirmDialog from '../common/ConfirmDialog';
import { useEditorStore } from '../../state/editorStore';
import { useSongStore } from '../../state/songStore';

// Note: the File System Access API rejects multi-dot extensions like
// '.dnw.json', so the filter uses '.json'; suggested names still end in
// '.dnw.json'.
const PROJECT_FILTER = {
  description: 'DNW project',
  extensions: ['.json'],
  mime: 'application/json',
};
const NBS_FILTER = {
  description: 'Note Block Studio song',
  extensions: ['.nbs'],
  mime: 'application/octet-stream',
};

function loadSong(song: ReturnType<typeof createDefaultSong>): void {
  useSongStore.getState().replaceSong(song);
  useEditorStore.getState().setActiveLayer(0);
}

export default function FileMenu() {
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | null>(null);
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

  const onExport = wrap(async () => {
    const song = useSongStore.getState().song;
    const base = song.meta.name.trim() || 'untitled';
    await webAdapter.saveFile(`${base}.nbs`, writeNbs(song), NBS_FILTER);
  });

  return (
    <div className="file-menu">
      <button onClick={guarded('new')}>New</button>
      <button onClick={guarded('open')}>Open</button>
      <button onClick={onSave}>Save</button>
      <button onClick={onExport} title="Export as Note Block Studio .nbs">
        Export .nbs
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
