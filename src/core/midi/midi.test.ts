import { describe, expect, it } from 'vitest';
import { createDefaultSong, createNote } from '../model/song';
import type { Song } from '../model/types';
import { analyzeMidiTiming, midiToSong } from './convert';
import { GM_PROGRAM_NAMES, midiVoiceFor } from './gm';
import type { MidiFile } from './reader';
import { readMidi } from './reader';
import { writeMidi } from './writer';

// --- tiny SMF builder for tests ---

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}

function chunk(id: string, data: number[]): number[] {
  return [
    ...[...id].map((c) => c.charCodeAt(0)),
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
    ...data,
  ];
}

/** Assemble an SMF; an end-of-track meta is appended to every track. */
function smf(ppq: number, tracks: number[][], format = 1): ArrayBuffer {
  const header = [0, format, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (ppq >> 8) & 0xff, ppq & 0xff];
  const bytes = [
    ...chunk('MThd', header),
    ...tracks.flatMap((t) => chunk('MTrk', [...t, 0x00, 0xff, 0x2f, 0x00])),
  ];
  return new Uint8Array(bytes).buffer;
}

function bareMidi(ppq: number, noteTicks: number[]): MidiFile {
  return {
    format: 1,
    ppq,
    trackCount: 1,
    notes: noteTicks.map((tick) => ({ tick, key: 69, velocity: 100, channel: 0, track: 0 })),
    tempos: [],
    timeSignatures: [],
    trackNames: [],
  };
}

describe('readMidi', () => {
  it('reads notes, tempo, time signature, track names and running status', () => {
    const track0 = [
      ...vlq(0), 0xff, 0x03, 0x04, 0x4c, 0x65, 0x61, 0x64, // track name "Lead"
      ...vlq(0), 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 500000 µs = 120 bpm
      ...vlq(0), 0xff, 0x58, 0x04, 0x03, 0x03, 0x24, 0x08, // time signature 3/8
      ...vlq(0), 0x90, 0x45, 0x64, // note-on A4 (69) vel 100
      ...vlq(240), 0x45, 0x00, // running status, vel 0 = note-off → dropped
      ...vlq(0), 0x40, 0x50, // running status note-on E4 (64) vel 80
    ];
    const track1 = [
      ...vlq(0), 0x99, 0x26, 0x7f, // percussion channel, note 38, vel 127
    ];
    const midi = readMidi(smf(480, [track0, track1]));

    expect(midi.format).toBe(1);
    expect(midi.ppq).toBe(480);
    expect(midi.trackCount).toBe(2);
    expect(midi.trackNames[0]).toBe('Lead');
    expect(midi.tempos).toEqual([{ tick: 0, bpm: 120 }]);
    expect(midi.timeSignatures).toEqual([{ tick: 0, numerator: 3, denominator: 8 }]);
    expect(midi.notes).toHaveLength(3);
    expect(midi.notes.map((n) => [n.tick, n.key, n.velocity, n.channel, n.track])).toEqual([
      [0, 0x45, 100, 0, 0],
      [0, 0x26, 127, 9, 1],
      [240, 0x40, 80, 0, 0],
    ]);
  });

  it('rejects non-MIDI data and SMPTE division', () => {
    expect(() => readMidi(new Uint8Array(20).buffer)).toThrow(/MThd/);
    const smpte = new Uint8Array(smf(480, [[]]));
    smpte[12] = 0xe8; // division high byte with the SMPTE flag set
    expect(() => readMidi(smpte.buffer.slice(0))).toThrow(/SMPTE/);
  });
});

describe('analyzeMidiTiming', () => {
  // ppq 480: ticks 0 (exact), 240 (8th), 60 (32nd), 160 (8th-note triplet)
  const midi = bareMidi(480, [0, 240, 60, 160]);

  it('flags events that fall off the game-tick grid', () => {
    // gt/quarter 8 resolves 1/32 notes, so only the triplet misaligns.
    expect(analyzeMidiTiming(midi, 8)).toEqual({
      totalEvents: 4,
      misalignedEvents: 1,
      losslessTickPerQuarter: 24,
    });
    // gt/quarter 4 resolves only 1/16 notes: the 32nd also misaligns.
    expect(analyzeMidiTiming(midi, 4).misalignedEvents).toBe(2);
    // the suggested lossless value really is lossless
    expect(analyzeMidiTiming(midi, 24).misalignedEvents).toBe(0);
  });

  it('gives up on absurdly fine grids', () => {
    const humanized = bareMidi(480, [0, 241, 379]);
    expect(analyzeMidiTiming(humanized, 8).losslessTickPerQuarter).toBeNull();
  });
});

describe('midiToSong', () => {
  it('snaps off-grid events to the nearest game tick', () => {
    const midi = bareMidi(480, [30, 100]); // 0.5 gt and 1.67 gt at gt/quarter 8
    const song = midiToSong(midi, 8, 'test');
    expect(song.tickPerQuarter).toBe(8);
    expect(song.layers[0]!.notes.map((n) => n.tick)).toEqual([1, 2]);
  });

  it('maps keys, velocities, drums and layers', () => {
    const midi: MidiFile = {
      format: 1,
      ppq: 4,
      trackCount: 2,
      notes: [
        { tick: 0, key: 69, velocity: 127, channel: 0, track: 0 }, // A4
        { tick: 4, key: 10, velocity: 64, channel: 0, track: 0 }, // below A0 → clamped
        { tick: 0, key: 38, velocity: 127, channel: 9, track: 1 }, // GM snare
      ],
      tempos: [],
      timeSignatures: [],
      trackNames: ['Melody', 'Drums'],
    };
    const song = midiToSong(midi, 4, 'test');
    expect(song.layers.map((l) => l.name)).toEqual(['Melody', 'Drums']);

    const [a4, low] = song.layers[0]!.notes;
    expect(a4).toMatchObject({ tick: 0, key: 48, instrument: 0, velocity: 100 });
    expect(low).toMatchObject({ tick: 4, key: 0, velocity: 50 });

    const snare = song.layers[1]!.notes[0]!;
    expect(snare.instrument).toBe(3); // 'snare'
    expect(snare.key).toBe(41);
  });

  it('deduplicates notes that snapping lands on the same cell, keeping the loudest', () => {
    const midi = bareMidi(480, [0, 30]); // both snap near tick 0/1 at gt/quarter 8
    midi.notes[0]!.velocity = 40;
    midi.notes[1]!.velocity = 90;
    midi.notes[1]!.tick = 20; // 0.33 gt → also snaps to tick 0
    const song = midiToSong(midi, 8, 'test');
    expect(song.layers[0]!.notes).toHaveLength(1);
    expect(song.layers[0]!.notes[0]!.velocity).toBe(Math.round((90 / 127) * 100));
  });

  it('imports the tempo map and guarantees tick-0 events', () => {
    const midi = bareMidi(480, [0]);
    midi.tempos = [{ tick: 960, bpm: 90 }];
    midi.timeSignatures = [{ tick: 0, numerator: 6, denominator: 8 }];
    const song = midiToSong(midi, 4, 'test');
    expect(song.tempoTrack.events).toEqual([
      { type: 'bpm', tick: 0, bpm: 90 }, // seeded from the first tempo
      { type: 'timeSignature', tick: 0, numerator: 6, denominator: 8 },
      { type: 'bpm', tick: 8, bpm: 90 },
    ]);

    const empty = midiToSong(bareMidi(480, []), 8, 'test');
    expect(empty.tempoTrack.events).toEqual([
      { type: 'bpm', tick: 0, bpm: 120 },
      { type: 'timeSignature', tick: 0, numerator: 4, denominator: 4 },
    ]);
    expect(empty.layers).toHaveLength(1);
  });
});

// --- export ---

/**
 * Raw event scan for the writer tests (readMidi drops note-offs and control
 * events). The writer never uses running status, so every event is explicit.
 */
interface RawEvent {
  track: number;
  tick: number;
  status: number;
  data: number[];
}

function scanEvents(buffer: ArrayBuffer): RawEvent[] {
  const bytes = new Uint8Array(buffer);
  const events: RawEvent[] = [];
  let pos = 14; // past MThd
  let track = 0;
  while (pos < bytes.length) {
    const size = (bytes[pos + 4]! << 24) | (bytes[pos + 5]! << 16) | (bytes[pos + 6]! << 8) | bytes[pos + 7]!;
    const end = pos + 8 + size;
    pos += 8;
    let tick = 0;
    while (pos < end) {
      let delta = 0;
      while (bytes[pos]! & 0x80) delta = (delta << 7) | (bytes[pos++]! & 0x7f);
      delta = (delta << 7) | bytes[pos++]!;
      tick += delta;
      const status = bytes[pos++]!;
      if (status === 0xff) {
        const metaType = bytes[pos++]!;
        const len = bytes[pos++]!; // writer meta payloads stay under 128 bytes
        events.push({ track, tick, status, data: [metaType, ...bytes.subarray(pos, pos + len)] });
        pos += len;
      } else {
        const len = (status & 0xf0) === 0xc0 ? 1 : 2;
        events.push({ track, tick, status, data: [...bytes.subarray(pos, pos + len)] });
        pos += len;
      }
    }
    track++;
  }
  return events;
}

function songWithNotes(notes: Parameters<typeof createNote>[0][]): Song {
  const song = createDefaultSong();
  song.meta.name = 'test song';
  song.layers[0]!.notes = notes.map(createNote);
  return song;
}

const HARP = 0;
const BASS = 1;
const BASEDRUM = 2;

describe('writeMidi', () => {
  it('roundtrips header, names, tempo map and notes through readMidi', () => {
    const song = songWithNotes([
      { tick: 2, instrument: HARP, key: 45, velocity: 100, pan: 0, pitch: 0 },
    ]);
    song.tempoTrack.events.push({ type: 'bpm', tick: 8, bpm: 120 });
    const result = writeMidi(song, song.layers, { noteLength: 'oneTick' });
    expect(result.ppq).toBe(480); // tickPerQuarter 4 x 120
    expect(result.warnings).toEqual([]);

    const midi = readMidi(result.data);
    expect(midi.format).toBe(1);
    expect(midi.trackCount).toBe(2); // meta + one layer
    expect(midi.ppq).toBe(480);
    expect(midi.trackNames[0]).toBe('test song');
    expect(midi.trackNames[1]).toBe('Track 1');
    expect(midi.tempos).toEqual([
      { tick: 0, bpm: 150 },
      { tick: 960, bpm: 120 },
    ]);
    expect(midi.timeSignatures).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(midi.notes).toEqual([{ tick: 240, key: 66, velocity: 127, channel: 0, track: 1 }]);
  });

  it('writes program, channel volume and pan at track start', () => {
    const song = songWithNotes([
      { tick: 0, instrument: HARP, key: 45, velocity: 50, pan: 0, pitch: 0 },
    ]);
    song.instruments[HARP]!.volume = 50;
    song.layers[0]!.volume = 50;
    song.layers[0]!.pan = 1;
    const events = scanEvents(writeMidi(song, song.layers, { noteLength: 'oneTick' }).data);
    const setup = events.filter((e) => e.track === 1 && e.tick === 0);
    expect(setup.find((e) => e.status === 0xc0)!.data).toEqual([0]); // piano
    expect(setup.find((e) => e.status === 0xb0 && e.data[0] === 7)!.data[1]).toBe(64);
    expect(setup.find((e) => e.status === 0xb0 && e.data[0] === 10)!.data[1]).toBe(127);
    // Velocity bakes note x layer (not instrument, which went to CC7).
    expect(setup.find((e) => e.status === 0x90)!.data[1]).toBe(1 + Math.round(0.25 * 126));
  });

  it('sustains until the next same-key note, capped at one quarter', () => {
    const song = songWithNotes([
      { tick: 0, instrument: HARP, key: 45, velocity: 100, pan: 0, pitch: 0 },
      { tick: 2, instrument: HARP, key: 45, velocity: 100, pan: 0, pitch: 0 },
      { tick: 2, instrument: HARP, key: 47, velocity: 100, pan: 0, pitch: 0 },
    ]);
    const events = scanEvents(writeMidi(song, song.layers, { noteLength: 'sustain' }).data);
    const offs = events.filter((e) => e.status === 0x80);
    expect(offs.map((e) => ({ tick: e.tick, key: e.data[0] }))).toEqual([
      { tick: 240, key: 66 }, // cut by the next key-45 note at tick 2
      { tick: 240 + 480, key: 66 }, // no successor: one quarter
      { tick: 240 + 480, key: 68 },
    ]);
  });

  it('applies the vanilla transpose table and midiProgram overrides', () => {
    const song = songWithNotes([
      { tick: 0, instrument: BASS, key: 45, velocity: 100, pan: 0, pitch: 0 },
    ]);
    song.instruments[BASS]!.midiProgram = 35; // fretless bass
    const events = scanEvents(writeMidi(song, song.layers, { noteLength: 'oneTick' }).data);
    expect(events.find((e) => e.status === 0xc0)!.data).toEqual([35]);
    expect(events.find((e) => e.status === 0x90)!.data[0]).toBe(45 + 21 - 24);
  });

  it('sends percussion to channel 10 with fixed keys and no program change', () => {
    const song = songWithNotes([
      { tick: 0, instrument: BASEDRUM, key: 50, velocity: 100, pan: 0, pitch: 0 },
    ]);
    song.instruments[BASEDRUM]!.volume = 50;
    const events = scanEvents(writeMidi(song, song.layers, { noteLength: 'sustain' }).data);
    const on = events.find((e) => (e.status & 0xf0) === 0x90)!;
    expect(on.status & 0x0f).toBe(9);
    expect(on.data[0]).toBe(35); // acoustic bass drum, regardless of key
    expect(on.data[1]).toBe(1 + Math.round(0.5 * 126)); // volume folded into velocity
    expect(events.some((e) => (e.status & 0xf0) === 0xc0)).toBe(false);
  });

  it('warns about dropped cents, per-note pan and channel pan conflicts', () => {
    const song = songWithNotes([
      { tick: 0, instrument: HARP, key: 45, velocity: 100, pan: 0.5, pitch: 20 },
      { tick: 1, instrument: HARP, key: 45, velocity: 100, pan: 0, pitch: -5 },
    ]);
    const second = structuredClone(song.layers[0]!);
    second.id = 'layer2';
    second.pan = -1;
    song.layers.push(second);
    const { warnings } = writeMidi(song, song.layers, { noteLength: 'oneTick' });
    // Both layers carry the cloned notes: 2 x 2 cents, 2 x 1 note-pan.
    expect(warnings.some((w) => w.includes('4 note(s) have fine pitch'))).toBe(true);
    expect(warnings.some((w) => w.includes('per-note pan'))).toBe(true);
    expect(warnings.some((w) => w.includes('share a MIDI channel'))).toBe(true);
  });
});

describe('gm', () => {
  it('has 128 distinct program names', () => {
    expect(GM_PROGRAM_NAMES).toHaveLength(128);
    expect(new Set(GM_PROGRAM_NAMES).size).toBe(128);
  });

  it('defaults custom instruments to piano with no transpose', () => {
    const voice = midiVoiceFor({
      id: 'c',
      name: 'custom',
      isVanilla: false,
      pitchKey: 45,
      volume: 100,
      pressKey: false,
    });
    expect(voice).toEqual({ program: 0, transpose: 0 });
  });
});
