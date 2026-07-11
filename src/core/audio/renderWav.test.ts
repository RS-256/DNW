import { describe, expect, it } from 'vitest';
import { createDefaultSong, createNote, createTrackGroup } from '../model/song';
import type { PcmSource } from './renderWav';
import { encodeWav, flattenForRender } from './renderWav';

function stubPcm(channels: Float32Array[], sampleRate = 48000): PcmSource {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (c) => channels[c]!,
  };
}

describe('encodeWav', () => {
  const int16 = { bitDepth: 16, float: false } as const;

  it('writes a valid RIFF header for 16-bit stereo', () => {
    const wav = encodeWav(
      stubPcm([new Float32Array([0, 0.5]), new Float32Array([1, -1])], 44100),
      int16,
    );
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(wav, offset, length));

    expect(wav.byteLength).toBe(44 + 2 * 2 * 2); // header + 2 frames * 2ch * int16
    expect(ascii(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4); // byte rate
    expect(view.getUint16(32, true)).toBe(4); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
  });

  it('interleaves channels and maps [-1, 1] to int16 with clipping', () => {
    const wav = encodeWav(
      stubPcm([new Float32Array([0, 1, 2]), new Float32Array([0.5, -1, -3])]),
      int16,
    );
    const view = new DataView(wav);
    // Frame-major: L0 R0 L1 R1 L2 R2.
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16384); // round(0.5 * 0x7fff)
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(-32768);
    expect(view.getInt16(52, true)).toBe(32767); // 2 clips to full scale
    expect(view.getInt16(54, true)).toBe(-32768); // -3 clips to full scale
  });

  it('applies the normalization scale before conversion', () => {
    const wav = encodeWav(stubPcm([new Float32Array([2])]), { ...int16, scale: 0.5 });
    expect(new DataView(wav).getInt16(44, true)).toBe(32767);
  });

  it('encodes 8-bit as unsigned with 128 as silence', () => {
    const wav = encodeWav(stubPcm([new Float32Array([0, 1, -1])]), { bitDepth: 8, float: false });
    const view = new DataView(wav);
    expect(view.getUint16(32, true)).toBe(1); // block align (1ch * 1 byte)
    expect(view.getUint16(34, true)).toBe(8);
    expect(view.getUint8(44)).toBe(128);
    expect(view.getUint8(45)).toBe(255);
    expect(view.getUint8(46)).toBe(0);
  });

  it('encodes 24-bit as little-endian 3-byte two’s complement', () => {
    const wav = encodeWav(stubPcm([new Float32Array([1, -1, -0.5])]), {
      bitDepth: 24,
      float: false,
    });
    const bytes = new Uint8Array(wav, 44);
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xff, 0x7f]); // 0x7fffff
    expect([...bytes.slice(3, 6)]).toEqual([0x00, 0x00, 0x80]); // -0x800000
    expect([...bytes.slice(6, 9)]).toEqual([0x00, 0x00, 0xc0]); // -0x400000
  });

  it('encodes 32-bit int at full scale', () => {
    const wav = encodeWav(stubPcm([new Float32Array([1, -1])]), { bitDepth: 32, float: false });
    const view = new DataView(wav);
    expect(view.getUint16(20, true)).toBe(1); // still integer PCM
    expect(view.getInt32(44, true)).toBe(0x7fffffff);
    expect(view.getInt32(48, true)).toBe(-0x80000000);
  });

  it('encodes 32-bit float with extended fmt, fact chunk and no clipping', () => {
    const wav = encodeWav(stubPcm([new Float32Array([0.5, 2, -1])], 48000), {
      bitDepth: 32,
      float: true,
    });
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(wav, offset, length));

    expect(view.getUint32(16, true)).toBe(18); // extended fmt size
    expect(view.getUint16(20, true)).toBe(3); // IEEE_FLOAT
    expect(view.getUint16(34, true)).toBe(32);
    expect(view.getUint16(36, true)).toBe(0); // cbSize
    expect(ascii(38, 4)).toBe('fact');
    expect(view.getUint32(46, true)).toBe(3); // frame count
    expect(ascii(50, 4)).toBe('data');
    expect(view.getUint32(54, true)).toBe(12);
    expect(wav.byteLength).toBe(58 + 12);
    expect(view.getFloat32(58, true)).toBeCloseTo(0.5);
    expect(view.getFloat32(62, true)).toBeCloseTo(2); // over-unity survives
    expect(view.getFloat32(66, true)).toBeCloseTo(-1);
  });

  it('rejects float at depths below 32-bit', () => {
    expect(() =>
      encodeWav(stubPcm([new Float32Array([0])]), { bitDepth: 16, float: true }),
    ).toThrow();
  });
});

describe('flattenForRender', () => {
  it('bakes velocity, instrument, layer and group gains in and clamps pan', () => {
    const song = createDefaultSong();
    const group = { ...createTrackGroup(0), volume: 50 };
    song.groups = [group];
    const layer = song.layers[0]!;
    layer.groupId = group.id;
    layer.volume = 80;
    layer.pan = 0.5;
    layer.notes = [
      createNote({ tick: 20, instrument: 0, key: 45, velocity: 100, pan: -1, pitch: 0 }),
    ];
    song.instruments[0]!.volume = 100;

    const notes = flattenForRender(song, [layer]);
    expect(notes).toHaveLength(1);
    // Default song: 150 bpm * 4 ticks/quarter = 10 tps, so tick 20 = 2 s.
    expect(notes[0]!.whenSec).toBeCloseTo(2);
    expect(notes[0]!.gain).toBeCloseTo(1 * 1 * 0.8 * 0.5);
    expect(notes[0]!.pan).toBeCloseTo(-0.5);
    expect(notes[0]!.playbackRate).toBeCloseTo(1); // key 45 = harp base pitch
  });

  it('ignores mute/solo flags but skips notes with unknown instruments', () => {
    const song = createDefaultSong();
    const layer = song.layers[0]!;
    layer.muted = true;
    layer.notes = [
      createNote({ tick: 0, instrument: 0, key: 45, velocity: 100, pan: 0, pitch: 0 }),
      createNote({ tick: 1, instrument: 999, key: 45, velocity: 100, pan: 0, pitch: 0 }),
    ];

    const notes = flattenForRender(song, [layer]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.whenSec).toBeCloseTo(0);
  });
});
