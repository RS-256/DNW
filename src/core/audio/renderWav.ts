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

/**
 * Encode interleaved 16-bit PCM WAV. `scale` pre-multiplies every sample
 * (used to pull an over-unity mix below full scale); anything still outside
 * [-1, 1] hard-clips.
 */
export function encodeWavPcm16(pcm: PcmSource, scale = 1): ArrayBuffer {
  const channels = pcm.numberOfChannels;
  const frames = pcm.length;
  const bytesPerFrame = channels * 2;
  const dataSize = frames * bytesPerFrame;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channels }, (_, c) => pcm.getChannelData(c));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c]![frame]! * scale));
      view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
      offset += 2;
    }
  }
  return out;
}

export interface RenderWavOptions {
  sampleRate: number;
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
    wav: encodeWavPcm16(rendered, overUnity ? 1 / peak : 1),
    durationSec,
    normalizedDb: overUnity ? 20 * Math.log10(peak) : 0,
    warnings,
  };
}
