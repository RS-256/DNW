/**
 * Domain-level edit operations. Each function is one undoable action built
 * on songStore.mutate, reading view state (active layer, selection) from
 * editorStore where needed.
 */
import {
  createLayer,
  createNote,
  createTrackGroup,
  DEFAULT_PITCH_KEY,
  findNoteIndexAt,
  insertNoteSorted,
  KEY_MAX,
  KEY_MIN,
  newId,
} from '../core/model/song';
import type {
  BpmEvent,
  Instrument,
  Layer,
  Note,
  TempoEvent,
  TrackGroup,
} from '../core/model/types';
import { useEditorStore } from './editorStore';
import { useSongStore } from './songStore';

function activeLayerOf(draftOrSong: { layers: Layer[] }): Layer | null {
  return draftOrSong.layers[useEditorStore.getState().activeLayer] ?? null;
}

/** Remove any note occupying (tick,key), then insert `note`. */
function placeNote(layer: Layer, note: Note): void {
  const existing = findNoteIndexAt(layer.notes, note.tick, note.key);
  if (existing !== -1) layer.notes.splice(existing, 1);
  insertNoteSorted(layer.notes, note);
}

export function addNote(tick: number, key: number, instrument?: number): Note | null {
  if (tick < 0 || key < KEY_MIN || key > KEY_MAX) return null;
  instrument ??= useEditorStore.getState().currentInstrument;
  if (!useSongStore.getState().song.instruments[instrument]) instrument = 0;
  const layer = activeLayerOf(useSongStore.getState().song);
  if (!layer || layer.locked) return null;
  if (findNoteIndexAt(layer.notes, tick, key) !== -1) return null;
  const note = createNote({ tick, instrument, key, velocity: 100, pan: 0, pitch: 0 });
  useSongStore.getState().mutate((draft) => {
    insertNoteSorted(activeLayerOf(draft)!.notes, note);
  });
  useEditorStore.getState().setSelection([note.id]);
  return note;
}

export function removeNoteAt(tick: number, key: number): boolean {
  const layer = activeLayerOf(useSongStore.getState().song);
  if (!layer || layer.locked) return false;
  const index = findNoteIndexAt(layer.notes, tick, key);
  if (index === -1) return false;
  const id = layer.notes[index]!.id;
  useSongStore.getState().mutate((draft) => {
    activeLayerOf(draft)!.notes.splice(index, 1);
  });
  const editor = useEditorStore.getState();
  if (editor.selection.has(id)) {
    editor.setSelection([...editor.selection].filter((s) => s !== id));
  }
  return true;
}

export function deleteSelection(): void {
  const { selection, clearSelection } = useEditorStore.getState();
  if (selection.size === 0) return;
  useSongStore.getState().mutate((draft) => {
    const layer = activeLayerOf(draft);
    if (!layer || layer.locked) return;
    layer.notes = layer.notes.filter((n) => !selection.has(n.id));
  });
  clearSelection();
}

/** Move the selected notes by a tick/key delta. Destination collisions are overwritten. */
export function moveSelection(dTick: number, dKey: number): void {
  const { selection } = useEditorStore.getState();
  if (selection.size === 0 || (dTick === 0 && dKey === 0)) return;
  useSongStore.getState().mutate((draft) => {
    const layer = activeLayerOf(draft);
    if (!layer || layer.locked) return;
    const moving = layer.notes.filter((n) => selection.has(n.id));
    if (moving.length === 0) return;
    // Reject moves that would push any note out of bounds.
    for (const n of moving) {
      const tick = n.tick + dTick;
      const key = n.key + dKey;
      if (tick < 0 || key < KEY_MIN || key > KEY_MAX) return;
    }
    layer.notes = layer.notes.filter((n) => !selection.has(n.id));
    for (const n of moving) {
      n.tick += dTick;
      n.key += dKey;
      placeNote(layer, n);
    }
  });
}

export function setSelectedNoteProps(
  props: Partial<Pick<Note, 'velocity' | 'pan' | 'pitch' | 'instrument'>>,
): void {
  const { selection } = useEditorStore.getState();
  if (selection.size === 0) return;
  useSongStore.getState().mutate((draft) => {
    const layer = activeLayerOf(draft);
    if (!layer || layer.locked) return;
    for (const n of layer.notes) {
      if (!selection.has(n.id)) continue;
      Object.assign(n, props);
    }
  });
}

/**
 * Apply a linear velocity ramp across the selection's tick span:
 * fade-out scales from 100% at the first tick down to 0% at the last,
 * fade-in the other way around.
 */
export function fadeSelection(direction: 'in' | 'out'): void {
  const { selection } = useEditorStore.getState();
  if (selection.size === 0) return;
  useSongStore.getState().mutate((draft) => {
    const layer = activeLayerOf(draft);
    if (!layer || layer.locked) return;
    const selected = layer.notes.filter((n) => selection.has(n.id));
    if (selected.length < 2) return;
    const minTick = selected[0]!.tick;
    const maxTick = selected[selected.length - 1]!.tick;
    if (maxTick === minTick) return;
    for (const note of selected) {
      const t = (note.tick - minTick) / (maxTick - minTick);
      const factor = direction === 'in' ? t : 1 - t;
      note.velocity = Math.round(Math.max(0, Math.min(100, note.velocity * factor)));
    }
  });
}

export function selectAll(): void {
  const layer = activeLayerOf(useSongStore.getState().song);
  if (!layer) return;
  useEditorStore.getState().setSelection(layer.notes.map((n) => n.id));
}

/**
 * Select all notes inside a tick/key box (inclusive). When `base` is given
 * (Ctrl held), the box adds to that selection instead of replacing it.
 */
export function selectBox(
  tick0: number,
  tick1: number,
  key0: number,
  key1: number,
  base?: ReadonlySet<string>,
): void {
  const layer = activeLayerOf(useSongStore.getState().song);
  if (!layer) return;
  const [tMin, tMax] = tick0 <= tick1 ? [tick0, tick1] : [tick1, tick0];
  const [kMin, kMax] = key0 <= key1 ? [key0, key1] : [key1, key0];
  const ids = layer.notes
    .filter((n) => n.tick >= tMin && n.tick <= tMax && n.key >= kMin && n.key <= kMax)
    .map((n) => n.id);
  useEditorStore.getState().setSelection(base ? [...base, ...ids] : ids);
}

export function copySelection(): void {
  const editor = useEditorStore.getState();
  const layer = activeLayerOf(useSongStore.getState().song);
  if (!layer || editor.selection.size === 0) return;
  editor.setClipboard(
    layer.notes
      .filter((n) => editor.selection.has(n.id))
      .map((n) => ({
        tick: n.tick,
        instrument: n.instrument,
        key: n.key,
        velocity: n.velocity,
        pan: n.pan,
        pitch: n.pitch,
      })),
  );
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

/** Paste at the original position; the pasted notes become the new selection. */
export function pasteClipboard(atTick?: number): void {
  const editor = useEditorStore.getState();
  if (editor.clipboard.length === 0) return;
  const baseTick = Math.min(...editor.clipboard.map((n) => n.tick));
  const offset = atTick !== undefined ? Math.max(0, Math.round(atTick)) - baseTick : 0;
  const pasted = editor.clipboard.map((n) => createNote({ ...n, tick: n.tick + offset }));
  useSongStore.getState().mutate((draft) => {
    const layer = activeLayerOf(draft);
    if (!layer || layer.locked) return;
    for (const note of pasted) placeNote(layer, note);
  });
  editor.setSelection(pasted.map((n) => n.id));
}

// --- layers (tracks) ---

export function addLayer(): void {
  const count = useSongStore.getState().song.layers.length;
  const layer = createLayer(count);
  useSongStore.getState().mutate((draft) => {
    draft.layers.push(layer);
  });
  useEditorStore.getState().setActiveLayer(count);
}

/** Remove a layer. The last remaining layer cannot be removed. */
export function removeLayer(index: number): void {
  const { song } = useSongStore.getState();
  if (song.layers.length <= 1 || !song.layers[index]) return;
  useSongStore.getState().mutate((draft) => {
    draft.layers.splice(index, 1);
  });
  const editor = useEditorStore.getState();
  const next = Math.min(
    editor.activeLayer > index ? editor.activeLayer - 1 : editor.activeLayer,
    useSongStore.getState().song.layers.length - 1,
  );
  editor.setActiveLayer(next);
}

/**
 * Reorder layers (priority order) and assign group membership: the moved
 * layer adopts `groupId` (undefined = ungrouped). Keeps the same layer
 * active.
 */
export function moveLayer(from: number, to: number, groupId?: string): void {
  const layers = useSongStore.getState().song.layers;
  if (!layers[from] || to < 0 || to >= layers.length) return;
  if (from === to && layers[from].groupId === groupId) return;
  const activeId = layers[useEditorStore.getState().activeLayer]?.id;
  useSongStore.getState().mutate((draft) => {
    const [layer] = draft.layers.splice(from, 1);
    layer!.groupId = groupId;
    draft.layers.splice(to, 0, layer!);
  });
  if (activeId) {
    const newIndex = useSongStore.getState().song.layers.findIndex((l) => l.id === activeId);
    if (newIndex !== -1) useEditorStore.setState({ activeLayer: newIndex });
  }
}

// --- track groups ---

/** Create a group containing the active track. */
export function createGroupWithActiveLayer(): void {
  const { activeLayer } = useEditorStore.getState();
  const song = useSongStore.getState().song;
  if (!song.layers[activeLayer]) return;
  const group = createTrackGroup(song.groups.length);
  useSongStore.getState().mutate((draft) => {
    draft.groups.push(group);
    draft.layers[activeLayer]!.groupId = group.id;
  });
}

export function setGroupProps(
  groupId: string,
  props: Partial<Pick<TrackGroup, 'name' | 'collapsed' | 'muted' | 'solo' | 'volume'>>,
): void {
  useSongStore.getState().mutate((draft) => {
    const group = draft.groups.find((g) => g.id === groupId);
    if (group) Object.assign(group, props);
  });
}

/** Dissolve a group. Member tracks stay, just ungrouped. */
export function deleteGroup(groupId: string): void {
  useSongStore.getState().mutate((draft) => {
    const index = draft.groups.findIndex((g) => g.id === groupId);
    if (index === -1) return;
    draft.groups.splice(index, 1);
    for (const layer of draft.layers) {
      if (layer.groupId === groupId) delete layer.groupId;
    }
  });
}

/**
 * The `to` index to pass to moveLayer so the layer at `from` lands right
 * after the group's last member (accounts for the removal shifting indexes).
 */
export function groupJoinIndex(groupId: string, from: number): number {
  const layers = useSongStore.getState().song.layers;
  let last = -1;
  layers.forEach((layer, i) => {
    if (layer.groupId === groupId) last = i;
  });
  if (last === -1) return Math.max(0, layers.length - 1);
  return from <= last ? last : last + 1;
}

export function renameLayer(index: number, name: string): void {
  useSongStore.getState().mutate((draft) => {
    const layer = draft.layers[index];
    if (layer) layer.name = name;
  });
}

export function setLayerProps(
  index: number,
  props: Partial<Pick<Layer, 'volume' | 'pan' | 'muted' | 'solo' | 'locked' | 'color'>>,
): void {
  useSongStore.getState().mutate((draft) => {
    const layer = draft.layers[index];
    if (layer) Object.assign(layer, props);
  });
}

/** Move the selected notes from the active layer to another layer. */
export function moveSelectionToLayer(targetIndex: number): void {
  const editor = useEditorStore.getState();
  const { selection, activeLayer } = editor;
  if (selection.size === 0 || targetIndex === activeLayer) return;
  const song = useSongStore.getState().song;
  if (!song.layers[targetIndex] || song.layers[targetIndex].locked) return;
  useSongStore.getState().mutate((draft) => {
    const source = draft.layers[activeLayer];
    const target = draft.layers[targetIndex]!;
    if (!source || source.locked) return;
    const moving = source.notes.filter((n) => selection.has(n.id));
    source.notes = source.notes.filter((n) => !selection.has(n.id));
    for (const note of moving) placeNote(target, note);
  });
  // Go through setActiveLayer so the target track's instrument is restored.
  editor.setActiveLayer(targetIndex);
  editor.setSelection(selection);
}

// --- instruments ---

/** Register an imported sample as a custom instrument. Returns its index. */
export function addCustomInstrument(name: string, soundSourceId: string): number {
  const instrument: Instrument = {
    id: newId('inst'),
    name,
    isVanilla: false,
    soundSourceId,
    soundFile: `${name}.ogg`,
    pitchKey: DEFAULT_PITCH_KEY,
    volume: 100,
    pressKey: false,
  };
  useSongStore.getState().mutate((draft) => {
    draft.instruments.push(instrument);
  });
  return useSongStore.getState().song.instruments.length - 1;
}

export function updateInstrument(
  index: number,
  props: Partial<
    Pick<Instrument, 'name' | 'pitchKey' | 'volume' | 'soundId' | 'baseBlock' | 'midiProgram'>
  >,
): void {
  useSongStore.getState().mutate((draft) => {
    const inst = draft.instruments[index];
    if (inst) Object.assign(inst, props);
  });
}

/**
 * Remove a custom instrument. Notes using it fall back to harp (0); notes
 * using later instruments shift down by one.
 */
export function removeInstrument(index: number): void {
  const inst = useSongStore.getState().song.instruments[index];
  if (!inst || inst.isVanilla) return;
  useSongStore.getState().mutate((draft) => {
    draft.instruments.splice(index, 1);
    for (const layer of draft.layers) {
      for (const note of layer.notes) {
        if (note.instrument === index) note.instrument = 0;
        else if (note.instrument > index) note.instrument -= 1;
      }
    }
  });
  const editor = useEditorStore.getState();
  if (editor.currentInstrument >= useSongStore.getState().song.instruments.length) {
    editor.setCurrentInstrument(0);
  }
}

// --- tempo track ---

/** Add or update a tempo event. Events are unique per (type, tick). */
export function upsertTempoEvent(event: TempoEvent): void {
  if (event.tick < 0) return;
  if (event.type === 'bpm' && (!Number.isFinite(event.bpm) || event.bpm <= 0)) return;
  useSongStore.getState().mutate((draft) => {
    const events = draft.tempoTrack.events;
    const existing = events.findIndex((e) => e.type === event.type && e.tick === event.tick);
    if (existing !== -1) events.splice(existing, 1);
    events.push(event);
    events.sort((a, b) => a.tick - b.tick);
  });
}

/** Remove a tempo event. The tick-0 events are non-deletable. */
export function removeTempoEvent(type: TempoEvent['type'], tick: number): void {
  if (tick === 0) return;
  useSongStore.getState().mutate((draft) => {
    const events = draft.tempoTrack.events;
    const index = events.findIndex((e) => e.type === type && e.tick === tick);
    if (index !== -1) events.splice(index, 1);
  });
}

export function setInitialBpm(bpm: number): void {
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  useSongStore.getState().mutate((draft) => {
    const ev = draft.tempoTrack.events.find(
      (e): e is BpmEvent => e.type === 'bpm' && e.tick === 0,
    );
    if (ev) ev.bpm = bpm;
  });
}

export function setTickPerQuarter(value: number): void {
  if (!Number.isInteger(value) || value < 1) return;
  useSongStore.getState().mutate((draft) => {
    draft.tickPerQuarter = value;
  });
}
