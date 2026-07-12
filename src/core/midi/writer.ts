/**
 * Standard MIDI File (SMF format 1) writer.
 *
 * Layout: track 0 carries the metadata (song name, tempo map, time
 * signatures); each exported DNW track becomes one MIDI track, in the
 * caller's order. Song ticks are multiplied by an integer factor so the PPQ
 * lands near 480 losslessly (game ticks are the atomic unit, so every event
 * time stays an integer).
 *
 * Lossy corners are reported as warnings instead of failing: fine pitch and
 * per-note pan have no per-note MIDI equivalent and are dropped, keys outside
 * 0-127 are clamped, non-power-of-two time-signature denominators are
 * rounded, and more than 15 melodic instruments overflow onto a shared
 * channel driven by per-note program changes.
 */
import { DRUM_CHANNEL, isDrumInstrument, midiVoiceFor } from './gm';
import type { Layer, Song } from '../model/types';

export type MidiNoteLength = 'sustain' | 'oneTick';

export interface MidiOptions {
  /**
   * 'sustain': a note rings until the next same-key note on its track,
   * capped at one quarter note. 'oneTick': every note is one game tick.
   */
  noteLength: MidiNoteLength;
}

export interface MidiResult {
  data: ArrayBuffer;
  ppq: number;
  warnings: string[];
}

/** Melodic channel pool; 9 is reserved for GM percussion. */
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/** Event sort keys within a tick: releases, then setup, then attacks. */
const ORDER_NOTE_OFF = 0;
const ORDER_CONTROL = 1;
const ORDER_NOTE_ON = 2;

interface TrackEvent {
  tick: number;
  order: number;
  bytes: number[];
}

const encoder = new TextEncoder();

function vlq(value: number): number[] {
  const out = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return out;
}

function meta(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data];
}

function metaText(type: number, text: string): number[] {
  return meta(type, [...encoder.encode(text)]);
}

/** Sort events, delta-encode, and wrap in an MTrk chunk. */
function buildTrack(events: TrackEvent[]): Uint8Array {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let lastTick = 0;
  for (const event of events) {
    // Per-event pushes stay tiny; never spread a whole track at once.
    for (const b of vlq(event.tick - lastTick)) body.push(b);
    for (const b of event.bytes) body.push(b);
    lastTick = event.tick;
  }
  body.push(0, 0xff, 0x2f, 0); // delta 0 + end of track
  const size = body.length;
  const chunk = new Uint8Array(8 + size);
  chunk.set([0x4d, 0x54, 0x72, 0x6b]); // MTrk
  chunk.set([(size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff], 4);
  chunk.set(body, 8);
  return chunk;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function writeMidi(song: Song, layers: Layer[], options: MidiOptions): MidiResult {
  const tpq = song.tickPerQuarter;
  const k = Math.max(1, Math.round(480 / tpq));
  const ppq = tpq * k;
  const warnings: string[] = [];

  // --- Channel allocation: one channel per instrument, in first-use order.
  const used: number[] = [];
  for (const layer of layers) {
    for (const note of layer.notes) {
      if (song.instruments[note.instrument] && !used.includes(note.instrument)) {
        used.push(note.instrument);
      }
    }
  }
  const channelOf = new Map<number, number>();
  const shared = new Set<number>();
  let nextMelodic = 0;
  for (const index of used) {
    if (isDrumInstrument(song.instruments[index]!)) {
      channelOf.set(index, DRUM_CHANNEL);
    } else if (nextMelodic < MELODIC_CHANNELS.length) {
      channelOf.set(index, MELODIC_CHANNELS[nextMelodic++]!);
    } else {
      channelOf.set(index, MELODIC_CHANNELS[MELODIC_CHANNELS.length - 1]!);
      shared.add(index);
    }
  }
  if (shared.size > 0) {
    const names = [...shared].map((i) => `'${song.instruments[i]!.name}'`).join(', ');
    warnings.push(
      `More than ${MELODIC_CHANNELS.length} melodic instruments; ${names} share the last ` +
        'MIDI channel with per-note program changes.',
    );
  }

  // --- Track 0: metadata.
  const metaEvents: TrackEvent[] = [];
  if (song.meta.name.trim()) {
    metaEvents.push({ tick: 0, order: ORDER_CONTROL, bytes: metaText(0x03, song.meta.name) });
  }
  const credit = [song.meta.author, song.meta.originalAuthor].filter((s) => s.trim()).join(' / ');
  if (credit) {
    metaEvents.push({ tick: 0, order: ORDER_CONTROL, bytes: metaText(0x01, credit) });
  }
  let denominatorRounds = 0;
  for (const event of song.tempoTrack.events) {
    if (event.type === 'bpm') {
      const usPerQuarter = clamp(Math.round(60_000_000 / event.bpm), 1, 0xffffff);
      metaEvents.push({
        tick: event.tick * k,
        order: ORDER_CONTROL,
        bytes: meta(0x51, [(usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff]),
      });
    } else {
      const dd = clamp(Math.round(Math.log2(event.denominator)), 0, 7);
      if (2 ** dd !== event.denominator) denominatorRounds++;
      metaEvents.push({
        tick: event.tick * k,
        order: ORDER_CONTROL,
        bytes: meta(0x58, [clamp(event.numerator, 1, 255), dd, 24, 8]),
      });
    }
  }
  if (denominatorRounds > 0) {
    warnings.push(
      `${denominatorRounds} time-signature denominator(s) are not powers of two and were rounded.`,
    );
  }

  // --- Note tracks.
  const groupById = new Map(song.groups.map((g) => [g.id, g]));
  // channel -> pan value written at track start, to detect conflicts.
  const panWritten = new Map<number, number>();
  let panConflict = false;
  let centsDropped = 0;
  let notePanDropped = 0;
  let keysClamped = 0;

  const tracks: Uint8Array[] = [];
  for (const layer of layers) {
    const events: TrackEvent[] = [];
    events.push({ tick: 0, order: ORDER_CONTROL, bytes: metaText(0x03, layer.name) });

    const group = layer.groupId ? groupById.get(layer.groupId) : undefined;
    const groupGain = (group?.volume ?? 100) / 100;
    const pan = clamp(Math.round(((clamp(layer.pan, -1, 1) + 1) / 2) * 127), 0, 127);

    // Per-channel setup for the instruments this track uses. Program and CC7
    // repeat identically across tracks sharing an instrument (harmless); CC10
    // is per-layer and can genuinely conflict, which we warn about.
    const layerInstruments = new Set(layer.notes.map((n) => n.instrument));
    for (const index of layerInstruments) {
      const instrument = song.instruments[index];
      const channel = channelOf.get(index);
      if (!instrument || channel === undefined) continue;
      const voice = midiVoiceFor(instrument);
      if (channel !== DRUM_CHANNEL && !shared.has(index)) {
        events.push({ tick: 0, order: ORDER_CONTROL, bytes: [0xc0 | channel, voice.program] });
        // Instrument volume as channel volume; percussion instruments share
        // channel 10, so theirs is baked into velocity instead.
        events.push({
          tick: 0,
          order: ORDER_CONTROL,
          bytes: [0xb0 | channel, 7, clamp(Math.round((instrument.volume / 100) * 127), 0, 127)],
        });
      }
      const previous = panWritten.get(channel);
      if (previous !== undefined && previous !== pan) panConflict = true;
      panWritten.set(channel, pan);
      events.push({ tick: 0, order: ORDER_CONTROL, bytes: [0xb0 | channel, 10, pan] });
    }

    // Next same-key tick per note, for 'sustain' duration.
    const ticksByKey = new Map<number, number[]>();
    for (const note of layer.notes) {
      let list = ticksByKey.get(note.key);
      if (!list) ticksByKey.set(note.key, (list = []));
      list.push(note.tick);
    }

    for (const note of layer.notes) {
      const instrument = song.instruments[note.instrument];
      const channel = channelOf.get(note.instrument);
      if (!instrument || channel === undefined) continue;
      const voice = midiVoiceFor(instrument);

      let key: number;
      if (voice.drumKey !== undefined) {
        key = voice.drumKey;
      } else {
        key = note.key + 21 + voice.transpose;
        if (key < 0 || key > 127) {
          keysClamped++;
          key = clamp(key, 0, 127);
        }
      }
      if (note.pitch !== 0) centsDropped++;
      if (note.pan !== 0) notePanDropped++;

      let gain = (note.velocity / 100) * (layer.volume / 100) * groupGain;
      // Drums have no CC7 of their own (channel 10 is shared), so the
      // instrument volume folds into velocity.
      if (voice.drumKey !== undefined) gain *= instrument.volume / 100;
      const velocity = 1 + Math.round(clamp(gain, 0, 1) * 126);

      let durationTicks = 1;
      if (options.noteLength === 'sustain' && voice.drumKey === undefined) {
        const siblings = ticksByKey.get(note.key)!;
        const nextIndex = siblings.findIndex((t) => t > note.tick);
        const next = nextIndex === -1 ? Infinity : siblings[nextIndex]!;
        durationTicks = Math.min(next - note.tick, tpq);
      }

      if (shared.has(note.instrument)) {
        events.push({
          tick: note.tick * k,
          order: ORDER_CONTROL,
          bytes: [0xc0 | channel, voice.program],
        });
      }
      events.push({ tick: note.tick * k, order: ORDER_NOTE_ON, bytes: [0x90 | channel, key, velocity] });
      events.push({
        tick: (note.tick + durationTicks) * k,
        order: ORDER_NOTE_OFF,
        bytes: [0x80 | channel, key, 0x40],
      });
    }
    tracks.push(buildTrack(events));
  }

  if (panConflict) {
    warnings.push(
      'Tracks with different pans share a MIDI channel (same instrument); the last pan wins.',
    );
  }
  if (centsDropped > 0) {
    warnings.push(`${centsDropped} note(s) have fine pitch, which MIDI cannot store; dropped.`);
  }
  if (notePanDropped > 0) {
    warnings.push(
      `${notePanDropped} note(s) have per-note pan; MIDI pan is per-channel, so only track pan was written.`,
    );
  }
  if (keysClamped > 0) {
    warnings.push(`${keysClamped} note(s) fell outside the MIDI key range and were clamped.`);
  }

  const trackChunks = [buildTrack(metaEvents), ...tracks];
  const header = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, // MThd
    0, 0, 0, 6,
    0, 1, // format 1
    (trackChunks.length >> 8) & 0xff, trackChunks.length & 0xff,
    (ppq >> 8) & 0x7f, ppq & 0xff,
  ]);
  const out = new Uint8Array(
    header.length + trackChunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  out.set(header);
  let offset = header.length;
  for (const chunk of trackChunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return { data: out.buffer, ppq, warnings };
}
