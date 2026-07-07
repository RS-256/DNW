import { describe, expect, it } from 'vitest';
import {
  createDefaultSong,
  createLayer,
  findNoteIndexAt,
  insertNoteSorted,
  lowerBoundByTick,
  songLength,
} from './song';
import type { Note } from './types';

let seq = 0;
function note(tick: number, key = 45): Note {
  return { id: `n${seq++}`, tick, instrument: 0, key, velocity: 100, pan: 0, pitch: 0 };
}

describe('createDefaultSong', () => {
  it('creates a song with the 16 vanilla instruments and one layer', () => {
    const song = createDefaultSong();
    expect(song.instruments).toHaveLength(16);
    expect(song.instruments[0]!.vanillaId).toBe('harp');
    expect(song.layers).toHaveLength(1);
  });

  it('has bpm and time signature events at tick 0', () => {
    const song = createDefaultSong();
    expect(song.tempoTrack.events.some((e) => e.type === 'bpm' && e.tick === 0)).toBe(true);
    expect(song.tempoTrack.events.some((e) => e.type === 'timeSignature' && e.tick === 0)).toBe(
      true,
    );
  });
});

describe('createLayer', () => {
  it('cycles colors and numbers names', () => {
    const a = createLayer(0);
    const b = createLayer(1);
    expect(a.name).toBe('Track 1');
    expect(b.name).toBe('Track 2');
    expect(a.color).not.toBe(b.color);
    expect(a.id).not.toBe(b.id);
  });
});

describe('note ordering helpers', () => {
  it('lowerBoundByTick finds the first note at or after a tick', () => {
    const notes = [note(0), note(2), note(2), note(5)];
    expect(lowerBoundByTick(notes, 0)).toBe(0);
    expect(lowerBoundByTick(notes, 1)).toBe(1);
    expect(lowerBoundByTick(notes, 2)).toBe(1);
    expect(lowerBoundByTick(notes, 3)).toBe(3);
    expect(lowerBoundByTick(notes, 6)).toBe(4);
  });

  it('insertNoteSorted keeps the array sorted by tick', () => {
    const notes: Note[] = [];
    for (const t of [5, 1, 3, 3, 0, 9]) insertNoteSorted(notes, note(t));
    expect(notes.map((n) => n.tick)).toEqual([0, 1, 3, 3, 5, 9]);
  });

  it('findNoteIndexAt matches tick and key', () => {
    const notes = [note(0, 40), note(2, 45), note(2, 50)];
    expect(findNoteIndexAt(notes, 2, 50)).toBe(2);
    expect(findNoteIndexAt(notes, 2, 41)).toBe(-1);
    expect(findNoteIndexAt(notes, 1, 45)).toBe(-1);
  });
});

describe('songLength', () => {
  it('returns the last tick with a note across layers', () => {
    const song = createDefaultSong();
    expect(songLength(song)).toBe(-1);
    insertNoteSorted(song.layers[0]!.notes, note(7));
    song.layers.push(createLayer(1));
    insertNoteSorted(song.layers[1]!.notes, note(12));
    expect(songLength(song)).toBe(12);
  });
});
