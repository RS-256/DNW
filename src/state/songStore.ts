/**
 * Song document store with patch-based undo/redo.
 *
 * Every mutation goes through `mutate(recipe)`, which records the immer
 * patches and their inverses. New kinds of edits are therefore undoable
 * without any extra code. Drag gestures preview on the overlay canvas and
 * commit once on mouse-up, so each gesture is a single history entry.
 *
 * View state (selection, scroll, active layer) lives in editorStore and is
 * deliberately not part of the undo history.
 */
import { create } from "zustand"
import { applyPatches, enablePatches, produceWithPatches } from "immer"
import type { Patch } from "immer"
import { createDefaultSong } from "../core/model/song"
import type { Song } from "../core/model/types"

enablePatches()

interface HistoryEntry {
  patches: Patch[]
  inverse: Patch[]
}

const MAX_HISTORY = 500
const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []

export interface SongState {
  song: Song
  canUndo: boolean
  canRedo: boolean
  /** Apply an undoable mutation. No-op (and no history entry) if nothing changed. */
  mutate: ( recipe: ( draft: Song ) => void ) => void
  undo: () => void
  redo: () => void
  /** Replace the whole song (new document / import). Clears history. */
  replaceSong: ( song: Song ) => void
}

export const useSongStore = create< SongState >()( ( set, get ) => ( {
  song: createDefaultSong(),
  canUndo: false,
  canRedo: false,

  mutate: ( recipe ) => {
    const [ next, patches, inverse ] = produceWithPatches( get().song, recipe )
    if ( patches.length === 0 ) return
    undoStack.push( { patches, inverse } )
    if ( undoStack.length > MAX_HISTORY ) undoStack.shift()
    redoStack.length = 0
    set( { song: next, canUndo: true, canRedo: false } )
  },

  undo: () => {
    const entry = undoStack.pop()
    if ( ! entry ) return
    redoStack.push( entry )
    set( {
      song: applyPatches( get().song, entry.inverse ),
      canUndo: undoStack.length > 0,
      canRedo: true
    } )
  },

  redo: () => {
    const entry = redoStack.pop()
    if ( ! entry ) return
    undoStack.push( entry )
    set( {
      song: applyPatches( get().song, entry.patches ),
      canUndo: true,
      canRedo: redoStack.length > 0
    } )
  },

  replaceSong: ( song ) => {
    undoStack.length = 0
    redoStack.length = 0
    set( { song, canUndo: false, canRedo: false } )
  }
} ) )

if ( import.meta.env.DEV && typeof window !== "undefined" ) {
  ;( window as unknown as Record< string, unknown > ).__dnwSongStore = useSongStore
}
