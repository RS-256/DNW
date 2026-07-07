import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultSong, createNote, insertNoteSorted } from '../core/model/song';
import { useEditorStore } from './editorStore';
import * as actions from './songActions';
import { useSongStore } from './songStore';

function reset(): void {
  useSongStore.getState().replaceSong(createDefaultSong());
  useEditorStore.getState().setActiveLayer(0);
  useEditorStore.getState().setClipboard([]);
}

function activeNotes() {
  return useSongStore.getState().song.layers[0]!.notes;
}

beforeEach(reset);

describe('songStore history', () => {
  it('undoes and redoes a mutation', () => {
    const store = useSongStore.getState();
    expect(store.canUndo).toBe(false);
    store.mutate((draft) => {
      insertNoteSorted(
        draft.layers[0]!.notes,
        createNote({ tick: 3, instrument: 0, key: 45, velocity: 100, pan: 0, pitch: 0 }),
      );
    });
    expect(activeNotes()).toHaveLength(1);
    expect(useSongStore.getState().canUndo).toBe(true);

    useSongStore.getState().undo();
    expect(activeNotes()).toHaveLength(0);
    expect(useSongStore.getState().canRedo).toBe(true);

    useSongStore.getState().redo();
    expect(activeNotes()).toHaveLength(1);
    expect(activeNotes()[0]!.tick).toBe(3);
  });

  it('does not record empty mutations', () => {
    useSongStore.getState().mutate(() => {});
    expect(useSongStore.getState().canUndo).toBe(false);
  });

  it('clears the redo stack on a new mutation', () => {
    actions.addNote(0, 45);
    useSongStore.getState().undo();
    actions.addNote(1, 46);
    expect(useSongStore.getState().canRedo).toBe(false);
  });
});

describe('songActions', () => {
  it('addNote inserts sorted, selects the note, and rejects duplicates', () => {
    actions.addNote(5, 45);
    actions.addNote(2, 45);
    expect(activeNotes().map((n) => n.tick)).toEqual([2, 5]);
    expect(useEditorStore.getState().selection.size).toBe(1);
    expect(actions.addNote(5, 45)).toBeNull();
  });

  it('moveSelection shifts notes and overwrites collisions', () => {
    const a = actions.addNote(0, 45)!;
    actions.addNote(2, 45);
    useEditorStore.getState().setSelection([a.id]);
    actions.moveSelection(2, 0); // lands on the tick-2 note -> overwrite
    expect(activeNotes()).toHaveLength(1);
    expect(activeNotes()[0]!.id).toBe(a.id);
    expect(activeNotes()[0]!.tick).toBe(2);
  });

  it('moveSelection rejects out-of-bounds moves', () => {
    const a = actions.addNote(0, 45)!;
    useEditorStore.getState().setSelection([a.id]);
    actions.moveSelection(-1, 0);
    expect(activeNotes()[0]!.tick).toBe(0);
  });

  it('copy/paste duplicates notes at a target tick and selects them', () => {
    actions.addNote(0, 45);
    actions.addNote(1, 47);
    actions.selectAll();
    actions.copySelection();
    actions.pasteClipboard(8);
    expect(activeNotes().map((n) => n.tick)).toEqual([0, 1, 8, 9]);
    expect(useEditorStore.getState().selection.size).toBe(2);
  });

  it('deleteSelection removes only selected notes and is undoable', () => {
    const a = actions.addNote(0, 45)!;
    actions.addNote(1, 47);
    useEditorStore.getState().setSelection([a.id]);
    actions.deleteSelection();
    expect(activeNotes().map((n) => n.tick)).toEqual([1]);
    useSongStore.getState().undo();
    expect(activeNotes()).toHaveLength(2);
  });

  it('setSelectedNoteProps applies to the whole selection', () => {
    actions.addNote(0, 45);
    actions.addNote(1, 47);
    actions.selectAll();
    actions.setSelectedNoteProps({ velocity: 50, pan: -0.5 });
    for (const n of activeNotes()) {
      expect(n.velocity).toBe(50);
      expect(n.pan).toBe(-0.5);
    }
  });

  it('addLayer/removeLayer manage layers and the active index', () => {
    actions.addLayer();
    expect(useSongStore.getState().song.layers).toHaveLength(2);
    expect(useEditorStore.getState().activeLayer).toBe(1);
    actions.removeLayer(1);
    expect(useSongStore.getState().song.layers).toHaveLength(1);
    expect(useEditorStore.getState().activeLayer).toBe(0);
    actions.removeLayer(0); // last layer is protected
    expect(useSongStore.getState().song.layers).toHaveLength(1);
  });

  it('moveLayer reorders and keeps the same layer active', () => {
    actions.addLayer(); // active = 1
    const activeId = useSongStore.getState().song.layers[1]!.id;
    actions.moveLayer(1, 0);
    expect(useSongStore.getState().song.layers[0]!.id).toBe(activeId);
    expect(useEditorStore.getState().activeLayer).toBe(0);
  });

  it('moveSelectionToLayer transfers notes and follows them', () => {
    const a = actions.addNote(0, 45)!;
    actions.addLayer(); // active = 1
    useEditorStore.getState().setActiveLayer(0);
    useEditorStore.getState().setSelection([a.id]);
    actions.moveSelectionToLayer(1);
    const song = useSongStore.getState().song;
    expect(song.layers[0]!.notes).toHaveLength(0);
    expect(song.layers[1]!.notes).toHaveLength(1);
    expect(useEditorStore.getState().activeLayer).toBe(1);
    expect(useEditorStore.getState().selection.has(a.id)).toBe(true);
  });

  it('track groups: create, join via moveLayer, and dissolve', () => {
    actions.addLayer(); // Track 2 (active)
    actions.addLayer(); // Track 3 (active)
    useEditorStore.getState().setActiveLayer(0);
    actions.createGroupWithActiveLayer();
    const song1 = useSongStore.getState().song;
    expect(song1.groups).toHaveLength(1);
    const groupId = song1.groups[0]!.id;
    expect(song1.layers[0]!.groupId).toBe(groupId);

    // Track 3 joins the group: lands right after the last member.
    actions.moveLayer(2, actions.groupJoinIndex(groupId, 2), groupId);
    const song2 = useSongStore.getState().song;
    expect(song2.layers.map((l) => [l.name, l.groupId ?? null])).toEqual([
      ['Track 1', groupId],
      ['Track 3', groupId],
      ['Track 2', null],
    ]);

    // Dragging a member onto an ungrouped row leaves the group.
    actions.moveLayer(1, 2, undefined);
    expect(useSongStore.getState().song.layers[2]!.groupId).toBeUndefined();

    actions.deleteGroup(groupId);
    const song3 = useSongStore.getState().song;
    expect(song3.groups).toHaveLength(0);
    expect(song3.layers.every((l) => l.groupId === undefined)).toBe(true);
  });

  it('group props update and undo like any other mutation', () => {
    actions.createGroupWithActiveLayer();
    const groupId = useSongStore.getState().song.groups[0]!.id;
    actions.setGroupProps(groupId, { muted: true, volume: 40 });
    const group = useSongStore.getState().song.groups[0]!;
    expect(group.muted).toBe(true);
    expect(group.volume).toBe(40);
    useSongStore.getState().undo();
    expect(useSongStore.getState().song.groups[0]!.muted).toBe(false);
    useSongStore.getState().undo();
    expect(useSongStore.getState().song.groups).toHaveLength(0);
  });

  it('each track remembers its current instrument across switches', () => {
    const editor = useEditorStore.getState();
    editor.setCurrentInstrument(0); // track 1: harp
    actions.addLayer(); // creates + activates track 2, inherits current inst
    expect(useEditorStore.getState().currentInstrument).toBe(0);
    useEditorStore.getState().setCurrentInstrument(1); // track 2: bass
    useEditorStore.getState().setActiveLayer(0);
    expect(useEditorStore.getState().currentInstrument).toBe(0); // back to harp
    useEditorStore.getState().setActiveLayer(1);
    expect(useEditorStore.getState().currentInstrument).toBe(1); // back to bass
  });

  it('fadeSelection ramps velocity across the selection tick span', () => {
    actions.addNote(0, 45);
    actions.addNote(5, 46);
    actions.addNote(10, 47);
    actions.selectAll();
    actions.fadeSelection('out');
    expect(activeNotes().map((n) => n.velocity)).toEqual([100, 50, 0]);

    useSongStore.getState().undo();
    actions.selectAll();
    actions.fadeSelection('in');
    expect(activeNotes().map((n) => n.velocity)).toEqual([0, 50, 100]);
  });

  it('tempo events: upsert replaces same (type,tick) and tick 0 is protected', () => {
    actions.upsertTempoEvent({ type: 'bpm', tick: 10, bpm: 200 });
    actions.upsertTempoEvent({ type: 'bpm', tick: 10, bpm: 90 });
    const events = useSongStore.getState().song.tempoTrack.events;
    expect(events.filter((e) => e.type === 'bpm' && e.tick === 10)).toHaveLength(1);
    actions.removeTempoEvent('bpm', 0);
    expect(events.some((e) => e.type === 'bpm' && e.tick === 0)).toBe(true);
  });
});
