/**
 * Editor view state: active track, selection, clipboard.
 * Not part of the undo history.
 */
import { create } from 'zustand';
import type { Note } from '../core/model/types';
import { useSongStore } from './songStore';

/** Clipboard entry: note payload without id, ticks kept absolute. */
export type ClipboardNote = Omit<Note, 'id'>;

export interface EditorState {
  activeLayer: number;
  /** Ids of selected notes. Selection always lives on the active layer. */
  selection: ReadonlySet<string>;
  clipboard: ClipboardNote[];
  /** Instrument index used for newly placed notes. */
  currentInstrument: number;
  /**
   * Each track remembers the instrument that was current while it was
   * active (keyed by layer id, so reordering tracks is safe). Switching
   * back to a track restores its instrument; tracks without a memory
   * inherit whatever is current.
   */
  instrumentByLayer: Readonly<Record<string, number>>;
  setActiveLayer: (index: number) => void;
  setSelection: (ids: Iterable<string>) => void;
  clearSelection: () => void;
  setClipboard: (notes: ClipboardNote[]) => void;
  setCurrentInstrument: (index: number) => void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  activeLayer: 0,
  selection: new Set<string>(),
  clipboard: [],
  currentInstrument: 0,
  instrumentByLayer: {},

  setActiveLayer: (index) => {
    const layers = useSongStore.getState().song.layers;
    const oldId = layers[get().activeLayer]?.id;
    const newId = layers[index]?.id;
    const map: Record<string, number> = { ...get().instrumentByLayer };
    if (oldId && oldId !== newId) map[oldId] = get().currentInstrument;
    const remembered = newId !== undefined ? map[newId] : undefined;
    set({
      activeLayer: index,
      selection: new Set(),
      instrumentByLayer: map,
      currentInstrument: remembered ?? get().currentInstrument,
    });
  },
  setSelection: (ids) => set({ selection: new Set(ids) }),
  clearSelection: () => set({ selection: new Set() }),
  setClipboard: (notes) => set({ clipboard: notes }),
  setCurrentInstrument: (index) => {
    const layerId = useSongStore.getState().song.layers[get().activeLayer]?.id;
    set({
      currentInstrument: index,
      instrumentByLayer: layerId
        ? { ...get().instrumentByLayer, [layerId]: index }
        : get().instrumentByLayer,
    });
  },
}));
