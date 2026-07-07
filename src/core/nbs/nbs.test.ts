import { describe, expect, it } from 'vitest';
import { createDefaultSong, createLayer, createNote, insertNoteSorted, newId } from '../model/song';
import type { Song } from '../model/types';
import { readNbs } from './reader';
import { writeNbs } from './writer';

function sampleSong(): Song {
  const song = createDefaultSong();
  song.meta = {
    name: 'Test Song',
    author: 'Alice',
    originalAuthor: 'Bob',
    description: 'Röundtrip テスト', // non-latin chars degrade to '?', see writer
  };
  song.tempoTrack.events = [
    { type: 'bpm', tick: 0, bpm: 150 },
    { type: 'timeSignature', tick: 0, numerator: 3, denominator: 4 },
  ];
  song.loop = { enabled: true, startTick: 4, count: 3 };
  song.layers = [createLayer(0, 'Lead'), createLayer(1, 'Bass')];
  song.layers[0]!.volume = 80;
  song.layers[0]!.pan = -0.5;
  song.layers[1]!.locked = true;
  insertNoteSorted(
    song.layers[0]!.notes,
    createNote({ tick: 0, instrument: 0, key: 45, velocity: 100, pan: 0, pitch: 0 }),
  );
  insertNoteSorted(
    song.layers[0]!.notes,
    createNote({ tick: 3, instrument: 5, key: 50, velocity: 60, pan: -1, pitch: -25 }),
  );
  insertNoteSorted(
    song.layers[1]!.notes,
    createNote({ tick: 0, instrument: 1, key: 33, velocity: 90, pan: 0.5, pitch: 100 }),
  );
  return song;
}

describe('NBS roundtrip', () => {
  it('preserves meta, layers, and notes', () => {
    const song = sampleSong();
    const back = readNbs(writeNbs(song));

    expect(back.meta.name).toBe('Test Song');
    expect(back.meta.author).toBe('Alice');
    expect(back.meta.originalAuthor).toBe('Bob');

    expect(back.layers).toHaveLength(2);
    expect(back.layers[0]!.name).toBe('Lead');
    expect(back.layers[0]!.volume).toBe(80);
    expect(back.layers[0]!.pan).toBeCloseTo(-0.5, 5);
    expect(back.layers[1]!.locked).toBe(true);

    const lead = back.layers[0]!.notes;
    expect(lead.map((n) => [n.tick, n.key, n.instrument])).toEqual([
      [0, 45, 0],
      [3, 50, 5],
    ]);
    expect(lead[1]!.velocity).toBe(60);
    expect(lead[1]!.pan).toBeCloseTo(-1, 5);
    expect(lead[1]!.pitch).toBe(-25);
    expect(back.layers[1]!.notes[0]!.pan).toBeCloseTo(0.5, 5);
  });

  it('preserves tempo and time signature', () => {
    const back = readNbs(writeNbs(sampleSong()));
    const bpm = back.tempoTrack.events.find((e) => e.type === 'bpm' && e.tick === 0);
    expect(bpm && bpm.type === 'bpm' ? bpm.bpm : 0).toBeCloseTo(150, 5);
    const sig = back.tempoTrack.events.find((e) => e.type === 'timeSignature');
    expect(sig && sig.type === 'timeSignature' ? sig.numerator : 0).toBe(3);
    expect(back.loop).toEqual({ enabled: true, startTick: 4, count: 3 });
  });

  it('roundtrips mid-song bpm changes via the Tempo Changer convention', () => {
    const song = sampleSong();
    song.tempoTrack.events.push({ type: 'bpm', tick: 8, bpm: 300 });
    const back = readNbs(writeNbs(song));

    const bpms = back.tempoTrack.events.filter((e) => e.type === 'bpm');
    expect(bpms).toHaveLength(2);
    expect(bpms[1]!.tick).toBe(8);
    expect(bpms[1]!.type === 'bpm' ? bpms[1]!.bpm : 0).toBeCloseTo(300, 5);
    // No Tempo Changer artifacts leak into the model.
    expect(back.layers).toHaveLength(2);
    expect(back.instruments.every((i) => i.name !== 'Tempo Changer')).toBe(true);
  });

  it('roundtrips custom instruments', () => {
    const song = sampleSong();
    song.instruments.push({
      id: newId('inst'),
      name: 'My Sound',
      isVanilla: false,
      soundFile: 'my_sound.ogg',
      pitchKey: 50,
      volume: 100,
      pressKey: true,
    });
    const customIndex = song.instruments.length - 1;
    insertNoteSorted(
      song.layers[0]!.notes,
      createNote({ tick: 5, instrument: customIndex, key: 40, velocity: 70, pan: 0, pitch: 0 }),
    );
    const back = readNbs(writeNbs(song));

    const custom = back.instruments.find((i) => !i.isVanilla);
    expect(custom).toBeDefined();
    expect(custom!.name).toBe('My Sound');
    expect(custom!.soundFile).toBe('my_sound.ogg');
    expect(custom!.pitchKey).toBe(50);
    expect(custom!.pressKey).toBe(true);
    const note = back.layers[0]!.notes.find((n) => n.tick === 5)!;
    expect(back.instruments[note.instrument]!.name).toBe('My Sound');
  });

  it('non-latin characters degrade to "?" instead of corrupting the file', () => {
    const back = readNbs(writeNbs(sampleSong()));
    // ö fits in one byte and survives; Japanese characters degrade to '?'.
    expect(back.meta.description).toBe('Röundtrip ???');
  });

  it('reads an empty song', () => {
    const back = readNbs(writeNbs(createDefaultSong()));
    expect(back.layers.length).toBeGreaterThanOrEqual(1);
    expect(back.layers.every((l) => l.notes.length === 0)).toBe(true);
  });
});
