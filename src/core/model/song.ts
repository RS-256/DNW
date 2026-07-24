/**
 * Factory and query helpers for the Song model.
 * Everything here is a pure function over plain data.
 */
import type { Instrument, Layer, Note, Song, TrackGroup, VanillaInstrumentId } from "./types"
import { VANILLA_INSTRUMENT_IDS } from "./types"

/** Note block native playable range (F#3-F#5) expressed in model keys (A0 = 0). */
export const NOTEBLOCK_KEY_MIN = 33
export const NOTEBLOCK_KEY_MAX = 57
/** Key at which vanilla note block samples play unshifted (F#4). */
export const DEFAULT_PITCH_KEY = 45

export const KEY_MIN = 0
export const KEY_MAX = 87

/** Default palette cycled through when new tracks are created. */
export const TRACK_COLORS = [
  "#e5484d",
  "#f76b15",
  "#ffc53d",
  "#46a758",
  "#00a2c7",
  "#3e63dd",
  "#8e4ec6",
  "#e93d82"
] as const

let idCounter = 0
/** Session-unique id. Persisted ids only need to be unique within one song. */
export function newId( prefix: string ): string {
  idCounter += 1
  return `${ prefix }_${ Date.now().toString( 36 ) }_${ idCounter.toString( 36 ) }`
}

/** Canonical block placed under a note block to select each vanilla instrument. */
export const VANILLA_BASE_BLOCKS: Record< VanillaInstrumentId, string > = {
  harp: "minecraft:dirt",
  bass: "minecraft:oak_planks",
  basedrum: "minecraft:stone",
  snare: "minecraft:sand",
  hat: "minecraft:glass",
  guitar: "minecraft:white_wool",
  flute: "minecraft:clay",
  bell: "minecraft:gold_block",
  chime: "minecraft:packed_ice",
  xylophone: "minecraft:bone_block",
  iron_xylophone: "minecraft:iron_block",
  cow_bell: "minecraft:soul_sand",
  didgeridoo: "minecraft:pumpkin",
  bit: "minecraft:emerald_block",
  banjo: "minecraft:hay_block",
  pling: "minecraft:glowstone"
}

export function createVanillaInstrument( vanillaId: VanillaInstrumentId ): Instrument {
  return {
    id: `vanilla_${ vanillaId }`,
    name: vanillaId,
    isVanilla: true,
    vanillaId,
    pitchKey: DEFAULT_PITCH_KEY,
    volume: 100,
    baseBlock: VANILLA_BASE_BLOCKS[ vanillaId ],
    pressKey: false
  }
}

export function createNote( partial: Omit< Note, "id" > ): Note {
  return { id: newId( "note" ), ...partial }
}

export function createLayer( index: number, name?: string ): Layer {
  return {
    id: newId( "layer" ),
    name: name ?? `Track ${ index + 1 }`,
    color: TRACK_COLORS[ index % TRACK_COLORS.length ] ?? TRACK_COLORS[ 0 ],
    volume: 100,
    pan: 0,
    muted: false,
    solo: false,
    locked: false,
    notes: []
  }
}

export function createTrackGroup( index: number, name?: string ): TrackGroup {
  return {
    id: newId( "group" ),
    name: name ?? `Group ${ index + 1 }`,
    collapsed: false,
    muted: false,
    solo: false,
    volume: 100
  }
}

export function createDefaultSong(): Song {
  return {
    meta: { name: "", author: "", originalAuthor: "", description: "" },
    tickPerQuarter: 4,
    tempoTrack: {
      events: [
        { type: "bpm", tick: 0, bpm: 150 },
        { type: "timeSignature", tick: 0, numerator: 4, denominator: 4 }
      ]
    },
    loop: { enabled: false, startTick: 0, count: 0 },
    layers: [ createLayer( 0 ) ],
    groups: [],
    instruments: VANILLA_INSTRUMENT_IDS.map( createVanillaInstrument )
  }
}

/** Index of the first note with note.tick >= tick (binary search on the sorted array). */
export function lowerBoundByTick( notes: readonly Note[], tick: number ): number {
  let lo = 0
  let hi = notes.length
  while ( lo < hi ) {
    const mid = ( lo + hi ) >> 1
    if ( notes[ mid ]!.tick < tick ) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Insert keeping the tick order. Returns the insertion index. Mutates `notes` (use inside immer). */
export function insertNoteSorted( notes: Note[], note: Note ): number {
  const i = lowerBoundByTick( notes, note.tick + 1 )
  notes.splice( i, 0, note )
  return i
}

export function findNoteIndexAt( notes: readonly Note[], tick: number, key: number ): number {
  for ( let i = lowerBoundByTick( notes, tick ); i < notes.length && notes[ i ]!.tick === tick; i++ ) {
    if ( notes[ i ]!.key === key ) return i
  }
  return -1
}

/** Last tick that has any note, or -1 for an empty song. */
export function songLength( song: Song ): number {
  let last = -1
  for ( const layer of song.layers ) {
    const n = layer.notes[ layer.notes.length - 1 ]
    if ( n && n.tick > last ) last = n.tick
  }
  return last
}
