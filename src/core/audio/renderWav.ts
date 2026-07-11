/**
 * Offline WAV export: renders the song through an OfflineAudioContext using
 * the same node graph as AudioEngine (source -> gain -> stereo panner), so
 * the file matches realtime playback, then encodes 16-bit PCM.
 */
import { TempoMap } from '../model/tempoMap';
import { keyToPlaybackRate } from './pitch';
import type { Instrument, Layer, Song } from '../model/types';

/** Silence appended after the last note so its sample can ring out. */
const TAIL_SEC = 1.0;

/** One note flattened to context-time scheduling parameters. */
export interface RenderNote {
  /** Index into Song.instruments. */
  instrument: number;
  whenSec: number;
  playbackRate: number;
  gain: number;
  pan: number;
}

/**
 * Flatten the given layers into schedulable notes. Unlike playback, mute and
 * solo flags are ignored — the caller's layer selection (the export modal
 * checkboxes) is the source of truth — but every volume and pan applies
 * exactly as in AudioEngine.start().
 */
export function flattenForRender(song: Song, layers: Layer[]): RenderNote[] {
  const tempoMap = new TempoMap(song.tempoTrack, song.tickPerQuarter);
  const groupById = new Map(song.groups.map((g) => [g.id, g]));
  const notes: RenderNote[] = [];
  for (const layer of layers) {
    const group = layer.groupId ? groupById.get(layer.groupId) : undefined;
    const groupGain = (group?.volume ?? 100) / 100;
    for (const note of layer.notes) {
      const instrument = song.instruments[note.instrument];
      if (!instrument) continue;
      notes.push({
        instrument: note.instrument,
        whenSec: tempoMap.tickToSeconds(note.tick),
        playbackRate: keyToPlaybackRate(note.key, instrument.pitchKey, note.pitch),
        gain: (note.velocity / 100) * (instrument.volume / 100) * (layer.volume / 100) * groupGain,
        pan: Math.max(-1, Math.min(1, note.pan + layer.pan)),
      });
    }
  }
  return notes;
}

/** Minimal slice of AudioBuffer needed by the encoder (keeps it testable). */
export interface PcmSource {
  numberOfChannels: number;
  /** Frame count. */
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export type WavBitDepth = 8 | 16 | 24 | 32;

export interface WavEncodeOptions {
  bitDepth: WavBitDepth;
  /** IEEE-float samples. Only valid with bitDepth 32. */
  float: boolean;
  /** Pre-multiplies every sample (pulls an over-unity mix below full scale). */
  scale?: number;
}

/**
 * Encode an interleaved WAV. Integer depths hard-clip anything outside
 * [-1, 1] after scaling; 8-bit is unsigned (silence = 128) per the WAV spec.
 * Float output keeps full headroom (no clipping) and carries the
 * spec-required extended fmt chunk (cbSize = 0) plus a fact chunk.
 */
export function encodeWav(pcm: PcmSource, { bitDepth, float, scale = 1 }: WavEncodeOptions): ArrayBuffer {
  if (float && bitDepth !== 32) throw new Error('Float samples require 32-bit depth.');
  const channels = pcm.numberOfChannels;
  const frames = pcm.length;
  const bytesPerSample = bitDepth / 8;
  const bytesPerFrame = channels * bytesPerSample;
  const dataSize = frames * bytesPerFrame;
  const fmtSize = float ? 18 : 16;
  const factSize = float ? 12 : 0;
  const headerSize = 20 + fmtSize + factSize + 8;
  const out = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(out);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, headerSize + dataSize - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, float ? 3 : 1, true); // 1 = PCM, 3 = IEEE_FLOAT
  view.setUint16(22, channels, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, bitDepth, true);
  let offset = 20 + fmtSize;
  if (float) {
    view.setUint16(36, 0, true); // cbSize
    ascii(offset, 'fact');
    view.setUint32(offset + 4, 4, true);
    view.setUint32(offset + 8, frames, true);
    offset += factSize;
  }
  ascii(offset, 'data');
  view.setUint32(offset + 4, dataSize, true);
  offset += 8;

  const channelData = Array.from({ length: channels }, (_, c) => pcm.getChannelData(c));
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channels; c++) {
      const raw = channelData[c]![frame]! * scale;
      if (float) {
        view.setFloat32(offset, raw, true);
      } else {
        const s = Math.max(-1, Math.min(1, raw));
        switch (bitDepth) {
          case 8:
            view.setUint8(offset, Math.round(s < 0 ? s * 128 : s * 127) + 128);
            break;
          case 16:
            view.setInt16(offset, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
            break;
          case 24: {
            const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff) & 0xffffff;
            view.setUint8(offset, v & 0xff);
            view.setUint8(offset + 1, (v >> 8) & 0xff);
            view.setUint8(offset + 2, (v >> 16) & 0xff);
            break;
          }
          case 32:
            view.setInt32(offset, Math.round(s < 0 ? s * 0x80000000 : s * 0x7fffffff), true);
            break;
        }
      }
      offset += bytesPerSample;
    }
  }
  return out;
}

export interface RenderWavOptions {
  sampleRate: number;
  bitDepth: WavBitDepth;
  /** IEEE-float samples. Only valid with bitDepth 32. */
  float: boolean;
  /** Returns the raw ogg for an instrument, or undefined if unavailable. */
  loadSample: (instrument: Instrument) => Promise<ArrayBuffer | undefined>;
}

export interface RenderWavResult {
  wav: ArrayBuffer;
  durationSec: number;
  /** dB the mix was attenuated by to keep the peak at 0 dBFS (0 = untouched). */
  normalizedDb: number;
  warnings: string[];
}

export async function renderSongToWav(
  song: Song,
  layers: Layer[],
  options: RenderWavOptions,
): Promise<RenderWavResult> {
  const notes = flattenForRender(song, layers);
  if (notes.length === 0) throw new Error('No notes to render.');

  const endSec = notes.reduce((max, n) => Math.max(max, n.whenSec), 0);
  const durationSec = endSec + TAIL_SEC;
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(durationSec * options.sampleRate),
    options.sampleRate,
  );

  const warnings: string[] = [];
  const buffers = new Map<number, AudioBuffer>();
  for (const index of new Set(notes.map((n) => n.instrument))) {
    const instrument = song.instruments[index]!;
    const ogg = await options.loadSample(instrument);
    if (!ogg) {
      const skipped = notes.filter((n) => n.instrument === index).length;
      warnings.push(
        `Sample for '${instrument.name}' not found; ${skipped} note${skipped === 1 ? '' : 's'} skipped.`,
      );
      continue;
    }
    // decodeAudioData detaches its input, so decode a copy and leave the
    // caller's buffer usable.
    buffers.set(index, await ctx.decodeAudioData(ogg.slice(0)));
  }

  for (const note of notes) {
    const buffer = buffers.get(note.instrument);
    if (!buffer) continue;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = note.playbackRate;
    const gainNode = ctx.createGain();
    gainNode.gain.value = note.gain;
    const panNode = ctx.createStereoPanner();
    panNode.pan.value = note.pan;
    source.connect(gainNode).connect(panNode).connect(ctx.destination);
    source.start(note.whenSec);
  }

  const rendered = await ctx.startRendering();

  // Realtime playback hard-clips at the DAC when the mix exceeds full scale;
  // for a file, attenuating the whole mix sounds better than clipping.
  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
    const data = rendered.getChannelData(channel);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
  }
  const overUnity = peak > 1;
  return {
    wav: encodeWav(rendered, {
      bitDepth: options.bitDepth,
      float: options.float,
      scale: overUnity ? 1 / peak : 1,
    }),
    durationSec,
    normalizedDb: overUnity ? 20 * Math.log10(peak) : 0,
    warnings,
  };
}
