/**
 * AudioEngine: Web Audio playback with a lookahead scheduler
 * ("A Tale of Two Clocks" pattern).
 *
 * A coarse setInterval wakes up every SCHEDULER_INTERVAL_MS and schedules
 * every note that falls within the next LOOKAHEAD_SEC on the AudioContext
 * clock, which does the sample-accurate timing.
 *
 * Tick <-> seconds conversion always goes through the song's TempoMap so the
 * scheduler and the playhead can never drift apart.
 */
import { TempoMap } from '../model/tempoMap';
import { keyToPlaybackRate } from './pitch';
import type { Note, Song } from '../model/types';

const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_INTERVAL_MS = 25;
/** Silence appended after the last note before auto-stop. */
const TAIL_SEC = 1.0;

interface FlatNote extends Note {
  layerIndex: number;
  gain: number;
  pan: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  private notes: FlatNote[] = [];
  private noteIdx = 0;
  private song: Song | null = null;
  private tempoMap: TempoMap | null = null;
  private startCtxTime = 0;
  private startSongSec = 0;
  private endSongSec = 0;

  /** Called when playback stops for any reason (end of song or stop()). */
  onStopped: (() => void) | null = null;

  /** Must be called from a user gesture the first time. */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  hasInstrument(instrumentId: string): boolean {
    return this.buffers.has(instrumentId);
  }

  async loadInstrument(instrumentId: string, ogg: ArrayBuffer): Promise<void> {
    const ctx = this.ensureContext();
    this.buffers.set(instrumentId, await ctx.decodeAudioData(ogg));
  }

  /** One-shot preview (also used when placing notes). */
  playNote(song: Song, note: Pick<Note, 'instrument' | 'key' | 'velocity' | 'pan' | 'pitch'>): void {
    const instrument = song.instruments[note.instrument];
    if (!instrument) return;
    this.scheduleNote(
      instrument.id,
      instrument.pitchKey,
      note.key,
      note.pitch,
      (note.velocity / 100) * (instrument.volume / 100),
      note.pan,
      this.ensureContext().currentTime,
    );
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  start(song: Song, fromTick: number): void {
    this.stop();
    const ctx = this.ensureContext();
    this.song = song;
    this.tempoMap = new TempoMap(song.tempoTrack, song.tickPerQuarter);

    // Flatten the layers into one tick-ordered list with the per-layer gain
    // baked in. Playback works on this snapshot; edits apply on next start.
    // Group mute/solo combine with layer flags; group volume multiplies in.
    const groupById = new Map(song.groups.map((g) => [g.id, g]));
    const groupOf = (layer: Song['layers'][number]) =>
      layer.groupId ? groupById.get(layer.groupId) : undefined;
    const anySolo = song.layers.some((l) => l.solo || groupOf(l)?.solo);
    const flat: FlatNote[] = [];
    song.layers.forEach((layer, layerIndex) => {
      const group = groupOf(layer);
      if (layer.muted || group?.muted) return;
      if (anySolo && !(layer.solo || group?.solo)) return;
      const groupGain = (group?.volume ?? 100) / 100;
      for (const note of layer.notes) {
        if (note.tick < fromTick) continue;
        const instrument = song.instruments[note.instrument];
        if (!instrument) continue;
        flat.push({
          ...note,
          layerIndex,
          gain:
            (note.velocity / 100) * (instrument.volume / 100) * (layer.volume / 100) * groupGain,
          pan: Math.max(-1, Math.min(1, note.pan + layer.pan)),
        });
      }
    });
    flat.sort((a, b) => a.tick - b.tick);

    this.notes = flat;
    this.noteIdx = 0;
    this.startCtxTime = ctx.currentTime + 0.05;
    this.startSongSec = this.tempoMap.tickToSeconds(fromTick);
    const lastNote = flat[flat.length - 1];
    this.endSongSec = lastNote ? this.tempoMap.tickToSeconds(lastNote.tick) : this.startSongSec;
    this.playing = true;
    this.timer = setInterval(this.schedulerTick, SCHEDULER_INTERVAL_MS);
    this.schedulerTick();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    // Already-scheduled sources are one-tick blips; letting them ring out is fine.
    this.onStopped?.();
  }

  /** Current playback position in (fractional) ticks. */
  currentTick(): number {
    if (!this.playing || !this.ctx || !this.tempoMap) return 0;
    const songSec = this.startSongSec + (this.ctx.currentTime - this.startCtxTime);
    return this.tempoMap.secondsToTick(Math.max(this.startSongSec, songSec));
  }

  private schedulerTick = (): void => {
    const ctx = this.ctx;
    const song = this.song;
    const tempoMap = this.tempoMap;
    if (!ctx || !song || !tempoMap || !this.playing) return;

    const horizon = ctx.currentTime - this.startCtxTime + LOOKAHEAD_SEC;
    while (this.noteIdx < this.notes.length) {
      const note = this.notes[this.noteIdx]!;
      const offset = tempoMap.tickToSeconds(note.tick) - this.startSongSec;
      if (offset > horizon) break;
      const instrument = song.instruments[note.instrument]!;
      this.scheduleNote(
        instrument.id,
        instrument.pitchKey,
        note.key,
        note.pitch,
        note.gain,
        note.pan,
        this.startCtxTime + offset,
      );
      this.noteIdx++;
    }

    if (
      this.noteIdx >= this.notes.length &&
      ctx.currentTime - this.startCtxTime > this.endSongSec - this.startSongSec + TAIL_SEC
    ) {
      this.stop();
    }
  };

  private scheduleNote(
    instrumentId: string,
    pitchKey: number,
    key: number,
    fineCents: number,
    gain: number,
    pan: number,
    when: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    const buffer = this.buffers.get(instrumentId);
    if (!ctx || !master || !buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = keyToPlaybackRate(key, pitchKey, fineCents);

    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    const panNode = ctx.createStereoPanner();
    panNode.pan.value = pan;

    source.connect(gainNode).connect(panNode).connect(master);
    source.start(when);
  }
}
