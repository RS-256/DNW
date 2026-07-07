/**
 * Playback state + the singleton AudioEngine.
 *
 * The engine itself lives outside React; this store only mirrors the bits
 * the UI needs (playing flag) and exposes imperative controls.
 */
import { create } from 'zustand';
import { AudioEngine } from '../core/audio/engine';
import { fetchVanillaSound } from '../core/assets/vanillaSounds';
import { getSound } from './persistence';
import { useSongStore } from './songStore';
import type { Note, Song } from '../core/model/types';

export const audioEngine = new AudioEngine();

async function loadInstrument(song: Song, index: number): Promise<void> {
  const instrument = song.instruments[index];
  if (!instrument || audioEngine.hasInstrument(instrument.id)) return;
  if (instrument.isVanilla && instrument.vanillaId) {
    await audioEngine.loadInstrument(instrument.id, await fetchVanillaSound(instrument.vanillaId));
  } else if (instrument.soundSourceId) {
    const data = await getSound(instrument.soundSourceId);
    if (!data) throw new Error(`Sample for "${instrument.name}" not found in local storage`);
    await audioEngine.loadInstrument(instrument.id, data);
  }
  // Custom instruments without a stored sample stay silent.
}

/** Load every instrument sample used by the song that is not cached yet. */
async function loadInstrumentsFor(song: Song): Promise<void> {
  const used = new Set<number>();
  for (const layer of song.layers) for (const note of layer.notes) used.add(note.instrument);
  await Promise.all([...used].map((index) => loadInstrument(song, index)));
}

export interface PlaybackState {
  playing: boolean;
  loadError: string | null;
  /** Playhead position (in ticks) used when playback starts. */
  positionTick: number;
  play: (fromTick?: number) => Promise<void>;
  playFromStart: () => void;
  stop: () => void;
  toggle: () => void;
  /** Seek. While playing, playback restarts from the new position. */
  setPosition: (tick: number) => void;
  previewNote: (note: Pick<Note, 'instrument' | 'key' | 'velocity' | 'pan' | 'pitch'>) => void;
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => {
  audioEngine.onStopped = () => set({ playing: false });

  return {
    playing: false,
    loadError: null,
    positionTick: 0,

    play: async (fromTick) => {
      if (get().playing) return;
      const song = useSongStore.getState().song;
      audioEngine.ensureContext();
      try {
        await loadInstrumentsFor(song);
        set({ loadError: null });
      } catch (err) {
        set({ loadError: err instanceof Error ? err.message : String(err) });
        return;
      }
      audioEngine.start(song, fromTick ?? get().positionTick);
      set({ playing: true });
    },

    playFromStart: () => {
      if (get().playing) get().stop();
      void get().play(0);
    },

    stop: () => {
      audioEngine.stop();
    },

    toggle: () => {
      if (get().playing) get().stop();
      else void get().play();
    },

    setPosition: (tick) => {
      const position = Math.max(0, tick);
      set({ positionTick: position });
      if (get().playing) {
        audioEngine.start(useSongStore.getState().song, position);
      }
    },

    previewNote: (note) => {
      const song = useSongStore.getState().song;
      const instrument = song.instruments[note.instrument];
      if (!instrument) return;
      const playIt = () => audioEngine.playNote(song, note);
      if (audioEngine.hasInstrument(instrument.id)) playIt();
      else void loadInstrument(song, note.instrument).then(playIt, () => {});
    },
  };
});
