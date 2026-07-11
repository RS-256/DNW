import { describe, expect, it } from 'vitest';
import { analyzeMidiTiming, midiToSong } from './convert';
import type { MidiFile } from './reader';
import { readMidi } from './reader';

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
