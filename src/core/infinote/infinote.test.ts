import { describe, expect, it } from 'vitest';
import { gunzipSync, unzipSync } from 'fflate';
import { createDefaultSong, createNote } from '../model/song';
import type { Song } from '../model/types';
import { decodeNbt } from '../litematic/nbt';
import type { NbtTag } from '../litematic/nbt';
import { emptyAllocation, buildInfinoteConfig, seedFromInfinoteJson } from './allocation';
import { generateLitematic } from './generate';
import { placeTrack, trackDepth, DEFAULT_PLACEMENT } from './placement';
import { collectSlots, decomposeKey, normalizeId, slotKey } from './slots';
import { buildResourcePack } from './resourcepack';

function compound(tag: NbtTag): Record<string, NbtTag> {
  if (tag.type !== 'compound') throw new Error(`expected compound, got ${tag.type}`);
  return tag.value;
}

function addNote(
  song: Song,
  layerIndex: number,
  tick: number,
  key: number,
  velocity = 100,
  pan = 0,
  instrument = 0,
): void {
  song.layers[layerIndex]!.notes.push(
    createNote({ tick, instrument, key, velocity, pan, pitch: 0 }),
  );
}

describe('slots', () => {
  it('normalizes ids', () => {
    expect(normalizeId('Dirt')).toBe('minecraft:dirt');
    expect(normalizeId('dnw:foo')).toBe('dnw:foo');
  });

  it('decomposes keys with ±24 tiling', () => {
    expect(decomposeKey(45, 45, 0)).toEqual({ note: 12, pitchShift: 0 });
    expect(decomposeKey(33, 45, 0)).toEqual({ note: 0, pitchShift: 0 });
    expect(decomposeKey(57, 45, 0)).toEqual({ note: 24, pitchShift: 0 });
    expect(decomposeKey(58, 45, 0)).toEqual({ note: 1, pitchShift: 24 });
    expect(decomposeKey(32, 45, 0)).toEqual({ note: 23, pitchShift: -24 });
    expect(decomposeKey(0, 45, 0)).toEqual({ note: 15, pitchShift: -48 });
    expect(decomposeKey(87, 45, 0)).toEqual({ note: 6, pitchShift: 48 });
  });

  it('keeps cents in the pitch shift', () => {
    expect(decomposeKey(45, 45, 50)).toEqual({ note: 12, pitchShift: 0.5 });
    expect(decomposeKey(58, 45, -25)).toEqual({ note: 1, pitchShift: 23.75 });
  });

  it('collects only non-vanilla-playable slots', () => {
    const song = createDefaultSong();
    addNote(song, 0, 0, 45); // vanilla harp, in range -> no slot
    addNote(song, 0, 1, 58); // harp +24 -> slot
    addNote(song, 0, 2, 58); // same slot
    const slots = collectSlots(song, new Set([song.layers[0]!.id]));
    expect(slots.size).toBe(1);
    const slot = [...slots.values()][0]!;
    expect(slot.soundId).toBe('minecraft:block.note_block.harp');
    expect(slot.pitchShift).toBe(24);
    expect(slot.count).toBe(2);
  });
});

describe('allocation', () => {
  const sample = JSON.stringify({
    schema: 1,
    mappings: {
      'minecraft:diamond_block': {
        sound: 'minecraft:harp',
        category: 'RECORDS',
        pitchShift: 24.0,
        volume: 3.0,
      },
      'minecraft:-memo-entry-': {
        sound: 'minecraft:xylophone',
        category: 'RECORDS',
        pitchShift: 0.0,
        volume: 3.0,
      },
    },
  });

  it('seeds slots and keeps raw mappings', () => {
    const state = emptyAllocation();
    expect(seedFromInfinoteJson(state, sample)).toBe(2);
    expect(state.slots[slotKey('minecraft:harp', 24)]).toBe('minecraft:diamond_block');
    expect(state.imported['minecraft:-memo-entry-']!.sound).toBe('minecraft:xylophone');
  });

  it('merges generated slots with imported mappings and reports conflicts', () => {
    const state = emptyAllocation();
    seedFromInfinoteJson(state, sample);
    const { json, conflicts } = buildInfinoteConfig(state, [
      { soundId: 'minecraft:block.note_block.bass', pitchShift: -24, blockId: 'birch_log' },
      // conflicting reuse of an imported block:
      { soundId: 'minecraft:flute', pitchShift: 12, blockId: 'minecraft:diamond_block' },
    ]);
    expect(conflicts).toHaveLength(1);
    const parsed = JSON.parse(json) as {
      schema: number;
      mappings: Record<string, { sound: string; pitchShift: number; volume: number }>;
    };
    expect(parsed.schema).toBe(1);
    // memo entry survives the round trip
    expect(parsed.mappings['minecraft:-memo-entry-']).toBeDefined();
    expect(parsed.mappings['minecraft:birch_log']).toEqual({
      sound: 'minecraft:block.note_block.bass',
      category: 'RECORDS',
      pitchShift: -24,
      volume: 3,
    });
    // conflicting slot did not overwrite the imported mapping
    expect(parsed.mappings['minecraft:diamond_block']!.sound).toBe('minecraft:harp');
  });
});

describe('placement', () => {
  const resolveNone = () => undefined;

  it('assigns depths by list order and side', () => {
    expect(trackDepth(0, { side: 'below', firstDepth: 2, spacing: 3 })).toEqual({
      sign: -1,
      depth: 2,
    });
    expect(trackDepth(2, { side: 'below', firstDepth: 2, spacing: 3 })).toEqual({
      sign: -1,
      depth: 8,
    });
    // above bumps the first depth to clear the player
    expect(trackDepth(0, { side: 'above', firstDepth: 2, spacing: 3 })).toEqual({
      sign: 1,
      depth: 3,
    });
    expect(trackDepth(1, { side: 'both', firstDepth: 2, spacing: 3 })).toEqual({
      sign: 1,
      depth: 3,
    });
  });

  it('maps velocity to lateral distance in dB space', () => {
    const song = createDefaultSong();
    addNote(song, 0, 0, 45, 100);
    addNote(song, 0, 1, 45, 50);
    const track = placeTrack(song, song.layers[0]!, 0, DEFAULT_PLACEMENT, resolveNone);
    expect(track.depth).toBe(2);
    expect(track.noteY).toBe(-2);
    expect(track.placed[0]!.dz).toBe(0); // full velocity sits under the runner
    // v=0.5, α=2: G = (1-2/48)*0.25, d = 48(1-G) = 36.5, dz = round(√(36.5²-2²)) = 36
    expect(Math.abs(track.placed[1]!.dz)).toBe(36);
  });

  it('mirrors pan-free conflicts and nudges the rest', () => {
    const song = createDefaultSong();
    addNote(song, 0, 0, 45, 80);
    addNote(song, 0, 0, 46, 80);
    addNote(song, 0, 0, 47, 80);
    const track = placeTrack(song, song.layers[0]!, 0, DEFAULT_PLACEMENT, resolveNone);
    const dzs = track.placed.map((p) => p.dz);
    expect(new Set(dzs).size).toBe(3);
    const mags = dzs.map(Math.abs).sort((a, b) => a - b);
    // first two mirror at the same magnitude, third nudges by one block
    expect(mags[0]).toBe(mags[1] === undefined ? mags[0] : Math.min(...mags));
    expect(new Set(dzs.map(Math.sign)).size).toBeGreaterThan(1);
    expect(Math.max(...mags) - Math.min(...mags)).toBeLessThanOrEqual(1);
    for (const p of track.placed) expect(p.dbError).toBeLessThanOrEqual(1);
  });

  it('honors pan sign', () => {
    const song = createDefaultSong();
    addNote(song, 0, 0, 45, 60, -1);
    const track = placeTrack(song, song.layers[0]!, 0, DEFAULT_PLACEMENT, resolveNone);
    expect(track.placed[0]!.dz).toBeLessThan(0);
  });

  it('throws when a slot has no base block', () => {
    const song = createDefaultSong();
    addNote(song, 0, 0, 58); // needs harp +24
    expect(() =>
      placeTrack(song, song.layers[0]!, 0, DEFAULT_PLACEMENT, resolveNone),
    ).toThrow(/No base block/);
  });
});

describe('generateLitematic', () => {
  it('produces a schematic with track, tempo and palette regions', () => {
    const song = createDefaultSong();
    song.meta.name = 'roundtrip';
    addNote(song, 0, 0, 45, 100); // vanilla harp
    addNote(song, 0, 3, 58, 100); // harp +24 via diamond_block
    song.tempoTrack.events.push({ type: 'bpm', tick: 2, bpm: 300 });

    const allocation = emptyAllocation();
    allocation.slots[slotKey('minecraft:block.note_block.harp', 24)] = 'minecraft:diamond_block';

    const result = generateLitematic(song, [song.layers[0]!.id], allocation, {
      ...DEFAULT_PLACEMENT,
      includeRotation: true,
      paletteRegion: 'song',
      tempoDepth: 50,
    });
    expect(result.notesPlaced).toBe(2);

    const { root } = decodeNbt(gunzipSync(result.file));
    const regions = compound(compound(root)['Regions']!);
    expect(Object.keys(regions).sort()).toEqual(['Track 1', 'palette', 'tempo']);

    const track = compound(regions['Track 1']!);
    expect(compound(track['Position']!)['y']).toEqual({ type: 'int', value: -3 });
    expect(compound(track['Size']!)['x']).toEqual({ type: 'int', value: 4 });

    const tempo = compound(regions['tempo']!);
    const tiles = tempo['TileEntities']!;
    if (tiles.type !== 'list') throw new Error('no tile entities');
    const commands = tiles.value.map((t) => {
      const c = compound(t)['Command']!;
      return c.type === 'string' ? c.value : '';
    });
    // 4 tp blocks (one per tick) + 2 tick-rate blocks (tick 0 and tick 2)
    expect(commands.filter((c) => c.startsWith('tp @p ~ ~49.5 ~ -90 0'))).toHaveLength(4);
    expect(commands.filter((c) => c.startsWith('tick rate'))).toHaveLength(2);
    expect(commands).toContain('tick rate 20'); // 300bpm * 4 / 60
    expect(commands).toContain('tick rate 10'); // 150bpm * 4 / 60
  });
});

describe('resourcepack', () => {
  it('builds pack.mcmeta, sounds.json and ogg entries', () => {
    const zip = buildResourcePack(
      [{ soundId: 'dnw:my_piano', data: new Uint8Array([1, 2, 3]) }],
      'test pack',
    );
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      'assets/dnw/sounds.json',
      'assets/dnw/sounds/my_piano.ogg',
      'pack.mcmeta',
    ]);
    const soundsJson = JSON.parse(new TextDecoder().decode(files['assets/dnw/sounds.json']!)) as {
      my_piano: { sounds: string[] };
    };
    expect(soundsJson.my_piano.sounds).toEqual(['dnw:my_piano']);
  });
});
