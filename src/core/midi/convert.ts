/**
 * MIDI → Song conversion.
 *
 * Import conventions:
 * - The user chooses tickPerQuarter (game ticks per quarter note) in the
 *   import modal; a MIDI event at tick t lands on game tick
 *   round(t * tickPerQuarter / ppq). Events that fall off that grid are
 *   snapped to the nearest game tick (analyzeMidiTiming warns beforehand).
 * - Note lengths are ignored: a note block fires once, so each note-on
 *   becomes one single-tick note.
 * - Each MIDI track that contains notes becomes one layer. Melodic notes map
 *   to harp; GM percussion (channel 9) maps to basedrum/snare/hat & friends
 *   via a heuristic table.
 * - Set-tempo and time-signature meta events become tempo-track events.
 */
import { createLayer, createNote, createVanillaInstrument, KEY_MAX, KEY_MIN } from '../model/song';
import type { Layer, Note, Song, TempoEvent, VanillaInstrumentId } from '../model/types';
import { VANILLA_INSTRUMENT_IDS } from '../model/types';
import type { MidiFile } from './reader';

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/**
 * Above this, a "lossless" tickPerQuarter is useless in practice (the file is
 * humanized, or needs a tick rate no one would play at): don't suggest it.
 */
const LOSSLESS_CAP = 96;

export interface TimingAnalysis {
  /** Note-ons plus tempo/time-signature events. */
  totalEvents: number;
  /** Events that fall off the game-tick grid at the analyzed tickPerQuarter. */
  misalignedEvents: number;
  /**
   * Smallest tickPerQuarter that places every event exactly (any multiple
   * also works), or null when the file needs an absurdly fine grid.
   */
  losslessTickPerQuarter: number | null;
}

function eventTicks(midi: MidiFile): number[] {
  return [
    ...midi.notes.map((n) => n.tick),
    ...midi.tempos.map((t) => t.tick),
    ...midi.timeSignatures.map((t) => t.tick),
  ];
}

/**
 * Check how well the MIDI fits the game-tick grid of a given tickPerQuarter.
 * An event at MIDI tick t is exact iff (t * tickPerQuarter) % ppq === 0,
 * i.e. iff tickPerQuarter is a multiple of ppq / gcd(t, ppq).
 */
export function analyzeMidiTiming(midi: MidiFile, tickPerQuarter: number): TimingAnalysis {
  let misaligned = 0;
  let lcm = 1;
  let overflow = false;
  const ticks = eventTicks(midi);
  for (const t of ticks) {
    if ((t * tickPerQuarter) % midi.ppq !== 0) misaligned++;
    if (!overflow) {
      const d = midi.ppq / gcd(t === 0 ? midi.ppq : t, midi.ppq);
      lcm = (lcm / gcd(lcm, d)) * d;
      if (lcm > LOSSLESS_CAP) overflow = true;
    }
  }
  return {
    totalEvents: ticks.length,
    misalignedEvents: misaligned,
    losslessTickPerQuarter: overflow ? null : lcm,
  };
}

/**
 * GM percussion (channel 9) → note block mapping. Heuristic: kicks and toms
 * on basedrum, snares/claps/crashes on snare, hi-hats and metallic clicks on
 * hat. Keys stay inside the native 33-57 range.
 */
const DRUM_MAP: Record<number, { instrument: VanillaInstrumentId; key: number }> = {
  35: { instrument: 'basedrum', key: 33 }, // acoustic bass drum
  36: { instrument: 'basedrum', key: 34 }, // bass drum 1
  41: { instrument: 'basedrum', key: 37 }, // low floor tom
  43: { instrument: 'basedrum', key: 39 }, // high floor tom
  45: { instrument: 'basedrum', key: 41 }, // low tom
  47: { instrument: 'basedrum', key: 43 }, // low-mid tom
  48: { instrument: 'basedrum', key: 45 }, // hi-mid tom
  50: { instrument: 'basedrum', key: 47 }, // high tom
  37: { instrument: 'snare', key: 39 }, // side stick
  38: { instrument: 'snare', key: 41 }, // acoustic snare
  39: { instrument: 'snare', key: 45 }, // hand clap
  40: { instrument: 'snare', key: 43 }, // electric snare
  49: { instrument: 'snare', key: 55 }, // crash cymbal 1
  52: { instrument: 'snare', key: 52 }, // chinese cymbal
  55: { instrument: 'snare', key: 51 }, // splash cymbal
  57: { instrument: 'snare', key: 53 }, // crash cymbal 2
  42: { instrument: 'hat', key: 42 }, // closed hi-hat
  44: { instrument: 'hat', key: 40 }, // pedal hi-hat
  46: { instrument: 'hat', key: 46 }, // open hi-hat
  51: { instrument: 'hat', key: 50 }, // ride cymbal 1
  53: { instrument: 'hat', key: 52 }, // ride bell
  54: { instrument: 'hat', key: 55 }, // tambourine
  59: { instrument: 'hat', key: 48 }, // ride cymbal 2
  56: { instrument: 'cow_bell', key: 45 }, // cowbell
};
const DRUM_FALLBACK: { instrument: VanillaInstrumentId; key: number } = {
  instrument: 'hat',
  key: 45,
};

/** MIDI note 21 = A0 = model key 0. */
const MIDI_KEY_OFFSET = 21;

export function midiToSong(midi: MidiFile, tickPerQuarter: number, name: string): Song {
  const toTick = (t: number) => Math.round((t * tickPerQuarter) / midi.ppq);
  const instrumentIndex = (id: VanillaInstrumentId) => VANILLA_INSTRUMENT_IDS.indexOf(id);

  // One layer per MIDI track that has notes, in file order.
  const layerByTrack = new Map<number, Layer>();
  for (const raw of midi.notes) {
    let layer = layerByTrack.get(raw.track);
    if (!layer) {
      layer = createLayer(
        layerByTrack.size,
        midi.trackNames[raw.track] || `Track ${raw.track + 1}`,
      );
      layerByTrack.set(raw.track, layer);
    }
    let instrument: number;
    let key: number;
    if (raw.channel === 9) {
      const drum = DRUM_MAP[raw.key] ?? DRUM_FALLBACK;
      instrument = instrumentIndex(drum.instrument);
      key = drum.key;
    } else {
      instrument = 0; // harp
      key = Math.max(KEY_MIN, Math.min(KEY_MAX, raw.key - MIDI_KEY_OFFSET));
    }
    layer.notes.push(
      createNote({
        tick: toTick(raw.tick),
        instrument,
        key,
        velocity: Math.max(1, Math.round((raw.velocity / 127) * 100)),
        pan: 0,
        pitch: 0,
      }),
    );
  }

  // Snapping can land two notes on the same (tick, key); keep the loudest.
  const layers: Layer[] = [];
  for (const layer of layerByTrack.values()) {
    layer.notes.sort((a, b) => a.tick - b.tick);
    const byCell = new Map<string, Note>();
    for (const note of layer.notes) {
      const cell = `${note.tick}:${note.key}:${note.instrument}`;
      const existing = byCell.get(cell);
      if (!existing || note.velocity > existing.velocity) byCell.set(cell, note);
    }
    layer.notes = layer.notes.filter((n) => byCell.get(`${n.tick}:${n.key}:${n.instrument}`) === n);
    layers.push(layer);
  }
  if (layers.length === 0) layers.push(createLayer(0));

  // Tempo track: convert ticks, keep the last event landing on each tick.
  const bpmByTick = new Map<number, number>();
  for (const t of midi.tempos) bpmByTick.set(toTick(t.tick), t.bpm);
  const sigByTick = new Map<number, { numerator: number; denominator: number }>();
  for (const s of midi.timeSignatures) {
    sigByTick.set(toTick(s.tick), { numerator: s.numerator, denominator: s.denominator });
  }
  if (!bpmByTick.has(0)) bpmByTick.set(0, midi.tempos[0]?.bpm ?? 120); // SMF default: 120 bpm
  if (!sigByTick.has(0)) sigByTick.set(0, { numerator: 4, denominator: 4 });
  const events: TempoEvent[] = [
    ...[...bpmByTick].map(([tick, bpm]): TempoEvent => ({ type: 'bpm', tick, bpm })),
    ...[...sigByTick].map(
      ([tick, sig]): TempoEvent => ({ type: 'timeSignature', tick, ...sig }),
    ),
  ];
  events.sort((a, b) => a.tick - b.tick);

  return {
    meta: { name, author: '', originalAuthor: '', description: '' },
    tickPerQuarter,
    tempoTrack: { events },
    loop: { enabled: false, startTick: 0, count: 0 },
    layers,
    groups: [],
    instruments: VANILLA_INSTRUMENT_IDS.map(createVanillaInstrument),
  };
}
