/**
 * NBS file reader. Supports the classic format (version 0) and the new
 * format versions 1-5 (https://noteblock.studio/nbs).
 *
 * Import conventions:
 * - tickPerQuarter is fixed to 4, so the initial bpm becomes tps * 15.
 * - The ONBS "Tempo Changer" custom instrument is recognized: its notes are
 *   converted into bpm events on the tempo track (tps = note.pitch / 15)
 *   and removed from the layers.
 */
import {
  createLayer,
  createNote,
  createVanillaInstrument,
  DEFAULT_PITCH_KEY,
  newId,
} from '../model/song';
import type { Instrument, Layer, Note, Song, TempoEvent } from '../model/types';
import { VANILLA_INSTRUMENT_IDS } from '../model/types';
import { ByteReader } from './bytes';

export const TEMPO_CHANGER_NAME = 'Tempo Changer';
/** Import fixes tickPerQuarter to 4 (one Minecraft redstone tick = 1/4 quarter at 4 gt). */
const IMPORT_TICK_PER_QUARTER = 4;

interface RawNote {
  tick: number;
  layer: number;
  instrument: number;
  key: number;
  velocity: number;
  panning: number;
  pitch: number;
}

export function readNbs(buffer: ArrayBuffer): Song {
  const r = new ByteReader(buffer);

  // --- header ---
  const first = r.u16();
  const version = first === 0 ? r.u8() : 0;
  if (version > 5) throw new Error(`Unsupported NBS version ${version}`);
  const isNew = version > 0;
  let vanillaCount: number = VANILLA_INSTRUMENT_IDS.length;
  let songLength = 0;
  if (isNew) {
    vanillaCount = r.u8();
    if (version >= 3) songLength = r.u16();
  } else {
    songLength = first;
  }
  void songLength;
  const layerCount = r.u16();
  const name = r.string();
  const author = r.string();
  const originalAuthor = r.string();
  const description = r.string();
  const tempo = r.u16() / 100; // ticks per second
  r.u8(); // auto-saving
  r.u8(); // auto-saving duration
  const timeSigNumerator = Math.max(1, r.u8());
  r.i32(); // minutes spent
  r.i32(); // left clicks
  r.i32(); // right clicks
  r.i32(); // note blocks added
  r.i32(); // note blocks removed
  r.string(); // MIDI/schematic file name
  let loopEnabled = false;
  let loopCount = 0;
  let loopStart = 0;
  if (version >= 4) {
    loopEnabled = r.u8() === 1;
    loopCount = r.u8();
    loopStart = r.u16();
  }

  // --- note blocks (sparse double loop) ---
  const rawNotes: RawNote[] = [];
  let tick = -1;
  for (;;) {
    const tickJump = r.u16();
    if (tickJump === 0) break;
    tick += tickJump;
    let layer = -1;
    for (;;) {
      const layerJump = r.u16();
      if (layerJump === 0) break;
      layer += layerJump;
      const instrument = r.u8();
      const key = r.u8();
      let velocity = 100;
      let panning = 100;
      let pitch = 0;
      if (version >= 4) {
        velocity = r.u8();
        panning = r.u8();
        pitch = r.i16();
      }
      rawNotes.push({ tick, layer, instrument, key, velocity, panning, pitch });
    }
  }

  // --- layers (optional part) ---
  const usedLayers = rawNotes.reduce((max, n) => Math.max(max, n.layer), -1) + 1;
  const totalLayers = Math.max(layerCount, usedLayers, 1);
  const layers: Layer[] = [];
  for (let i = 0; i < totalLayers; i++) layers.push(createLayer(i));
  if (!r.eof) {
    for (let i = 0; i < layerCount && !r.eof; i++) {
      try {
        const layerName = r.string();
        const locked = version >= 4 ? r.u8() === 1 : false;
        const volume = r.u8();
        const stereo = version >= 2 ? r.u8() : 100;
        const layer = layers[i];
        if (layer) {
          if (layerName) layer.name = layerName;
          layer.locked = locked;
          layer.volume = Math.min(100, volume);
          layer.pan = (stereo - 100) / 100;
        }
      } catch {
        break; // tolerate truncated files
      }
    }
  }

  // --- custom instruments (optional part) ---
  const instruments: Instrument[] = VANILLA_INSTRUMENT_IDS.map(createVanillaInstrument);
  const customInstruments: Instrument[] = [];
  if (!r.eof) {
    try {
      const count = r.u8();
      for (let i = 0; i < count; i++) {
        const instName = r.string();
        const soundFile = r.string();
        const pitchKey = r.u8();
        const pressKey = r.u8() === 1;
        customInstruments.push({
          id: newId('inst'),
          name: instName,
          isVanilla: false,
          soundFile,
          pitchKey: pitchKey || DEFAULT_PITCH_KEY,
          volume: 100,
          pressKey,
        });
      }
    } catch {
      // tolerate truncated files
    }
  }
  instruments.push(...customInstruments);

  // --- map raw notes into layers, extracting Tempo Changer notes ---
  const tempoChangerIndexes = new Set<number>();
  customInstruments.forEach((inst, i) => {
    if (inst.name === TEMPO_CHANGER_NAME) tempoChangerIndexes.add(vanillaCount + i);
  });

  const tempoEvents: TempoEvent[] = [];
  for (const raw of rawNotes) {
    if (tempoChangerIndexes.has(raw.instrument)) {
      const tps = Math.abs(raw.pitch) / 15;
      if (tps > 0) {
        tempoEvents.push({
          type: 'bpm',
          tick: raw.tick,
          bpm: (tps * 60) / IMPORT_TICK_PER_QUARTER,
        });
      }
      continue;
    }
    // Map the NBS instrument index into our instruments array. Files saved
    // with fewer vanilla instruments (old Minecraft versions) still map 1:1
    // because the vanilla order is shared; customs start at vanillaCount.
    let instrument: number;
    if (raw.instrument < vanillaCount) {
      instrument = raw.instrument < VANILLA_INSTRUMENT_IDS.length ? raw.instrument : 0;
    } else {
      const customIndex = raw.instrument - vanillaCount;
      // Removed Tempo Changer entries shift later customs down.
      const removedBefore = [...tempoChangerIndexes].filter((t) => t < raw.instrument).length;
      instrument = VANILLA_INSTRUMENT_IDS.length + customIndex - removedBefore;
      if (!instruments[instrument]) instrument = 0;
    }
    const layer = layers[raw.layer]!;
    const note: Note = createNote({
      tick: raw.tick,
      instrument,
      key: Math.min(87, Math.max(0, raw.key)),
      velocity: Math.min(100, raw.velocity),
      pan: (raw.panning - 100) / 100,
      pitch: raw.pitch,
    });
    layer.notes.push(note);
  }
  for (const layer of layers) layer.notes.sort((a, b) => a.tick - b.tick);

  // Drop the placeholder layer our own writer creates for Tempo Changer notes.
  const finalLayers =
    tempoChangerIndexes.size > 0
      ? layers.filter((l, i) => !(l.name === 'Tempo' && l.notes.length === 0 && i >= usedLayers - 1))
      : layers;
  if (finalLayers.length === 0) finalLayers.push(createLayer(0));

  // Strip Tempo Changer instruments from the instrument list.
  const finalInstruments = instruments.filter(
    (inst) => inst.isVanilla || inst.name !== TEMPO_CHANGER_NAME,
  );

  const initialBpm = (tempo * 60) / IMPORT_TICK_PER_QUARTER;
  const events: TempoEvent[] = [
    { type: 'bpm', tick: 0, bpm: initialBpm },
    { type: 'timeSignature', tick: 0, numerator: timeSigNumerator, denominator: 4 },
    ...tempoEvents.filter((e) => e.tick !== 0),
  ];
  events.sort((a, b) => a.tick - b.tick);

  return {
    meta: { name, author, originalAuthor, description },
    tickPerQuarter: IMPORT_TICK_PER_QUARTER,
    tempoTrack: { events },
    loop: { enabled: loopEnabled, startTick: loopStart, count: loopCount },
    layers: finalLayers,
    groups: [],
    instruments: finalInstruments,
  };
}
