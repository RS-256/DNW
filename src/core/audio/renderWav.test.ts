import { describe, expect, it } from 'vitest';
import { createDefaultSong, createNote, createTrackGroup } from '../model/song';
import type { PcmSource } from './renderWav';
import { encodeWavPcm16, flattenForRender } from './renderWav';

function stubPcm(channels: Float32Array[], sampleRate = 48000): PcmSource {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (c) => channels[c]!,
  };
}

describe('encodeWavPcm16', () => {
  it('writes a valid RIFF header for 16-bit stereo', () => {
    const wav = encodeWavPcm16(
      stubPcm([new Float32Array([0, 0.5]), new Float32Array([1, -1])], 44100),
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
    const wav = encodeWavPcm16(
      stubPcm([new Float32Array([0, 1, 2]), new Float32Array([0.5, -1, -3])]),
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
    const wav = encodeWavPcm16(stubPcm([new Float32Array([2])]), 0.5);
    expect(new DataView(wav).getInt16(44, true)).toBe(32767);
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
