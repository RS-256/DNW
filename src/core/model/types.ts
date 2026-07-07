/**
 * Core data model of DNW.
 *
 * Time units:
 * - `tick` is the atomic time unit of a song. One tick corresponds to one
 *   Minecraft game tick (gt) so that in-game conversion never drifts.
 *   Notes have no duration: a note block just fires once, so every note
 *   occupies exactly one tick.
 * - Playback speed is expressed as tps (ticks per second):
 *   tps = bpm / 60 * tickPerQuarter
 *   where `tickPerQuarter` is the number of game ticks per quarter note
 *   (the same concept infinote uses for its bpm setting).
 */

export interface SongMeta {
  name: string;
  author: string;
  originalAuthor: string;
  description: string;
}

export interface LoopSettings {
  enabled: boolean;
  startTick: number;
  /** 0 = infinite */
  count: number;
}

/** A bpm change taking effect at `tick`. */
export interface BpmEvent {
  type: 'bpm';
  tick: number;
  bpm: number;
}

/** A time-signature change taking effect at `tick`. Affects bar/beat lines only. */
export interface TimeSignatureEvent {
  type: 'timeSignature';
  tick: number;
  numerator: number;
  denominator: number;
}

export type TempoEvent = BpmEvent | TimeSignatureEvent;

/**
 * The non-deletable special track holding every bpm / time-signature change.
 * Events are kept sorted by tick. A bpm event and a time-signature event
 * must exist at tick 0 at all times.
 */
export interface TempoTrack {
  events: TempoEvent[];
}

export const VANILLA_INSTRUMENT_IDS = [
  'harp',
  'bass',
  'basedrum',
  'snare',
  'hat',
  'guitar',
  'flute',
  'bell',
  'chime',
  'xylophone',
  'iron_xylophone',
  'cow_bell',
  'didgeridoo',
  'bit',
  'banjo',
  'pling',
] as const;

export type VanillaInstrumentId = (typeof VANILLA_INSTRUMENT_IDS)[number];

export interface Instrument {
  id: string;
  name: string;
  isVanilla: boolean;
  vanillaId?: VanillaInstrumentId;
  /** Reference to an imported .ogg stored in IndexedDB (custom instruments). */
  soundSourceId?: string;
  /** NBS-compatible sound file path (custom instruments, for .nbs roundtrip). */
  soundFile?: string;
  /** Key at which the sample plays back unshifted. 45 = F#4, the note block default. */
  pitchKey: number;
  /** 0-100 */
  volume: number;
  /** infinote sound id, "namespace:path" (used by future in-game export). */
  soundId?: string;
  /** Block placed under the note block for this instrument (skin border texture source). */
  baseBlock?: string;
  /** NBS custom-instrument compatibility: press the piano key when played. */
  pressKey: boolean;
}

export interface Note {
  /** Unique within a song. Used for selection and clipboard references. */
  id: string;
  /** Start tick. Notes are always exactly one tick wide. */
  tick: number;
  /** Index into Song.instruments. */
  instrument: number;
  /** 0-87 (A0-C8). The note block native range is 33-57 (F#3-F#5). */
  key: number;
  /** 0-100 */
  velocity: number;
  /** -1 = full left, 0 = center, +1 = full right. */
  pan: number;
  /** Fine pitch offset in cents. */
  pitch: number;
}

export interface Layer {
  id: string;
  name: string;
  /** Track color, used for note rendering and onion skin outlines. */
  color: string;
  /** 0-100 */
  volume: number;
  /** -1..+1 */
  pan: number;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  /** Kept sorted by tick (stable within a tick). */
  notes: Note[];
}

export interface Song {
  meta: SongMeta;
  /** Game ticks per quarter note (shared concept with infinote). */
  tickPerQuarter: number;
  tempoTrack: TempoTrack;
  loop: LoopSettings;
  /** Order = priority (index 0 is drawn on top of other inactive layers). */
  layers: Layer[];
  instruments: Instrument[];
}
