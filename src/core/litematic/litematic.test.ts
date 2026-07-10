import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'fflate';
import { bitsForPalette, packBitArray, unpackBitArray } from './bitarray';
import { decodeNbt, encodeNbt, nCompound, nInt, nList, nString } from './nbt';
import type { NbtTag } from './nbt';
import { RegionBuilder, writeLitematic } from './writer';

function compound(tag: NbtTag): Record<string, NbtTag> {
  if (tag.type !== 'compound') throw new Error(`expected compound, got ${tag.type}`);
  return tag.value;
}

function intOf(tag: NbtTag | undefined): number {
  if (!tag || (tag.type !== 'int' && tag.type !== 'byte' && tag.type !== 'short')) {
    throw new Error('expected int-like tag');
  }
  return tag.value;
}

describe('bitarray', () => {
  it('computes litematica bit widths', () => {
    expect(bitsForPalette(1)).toBe(2);
    expect(bitsForPalette(4)).toBe(2);
    expect(bitsForPalette(5)).toBe(3);
    expect(bitsForPalette(33)).toBe(6);
    expect(bitsForPalette(76)).toBe(7);
  });

  it('round-trips entries across long boundaries', () => {
    for (const bits of [2, 5, 7, 12]) {
      const max = (1 << bits) - 1;
      const indices = Array.from({ length: 1000 }, (_, i) => (i * 2654435761) % (max + 1));
      const longs = packBitArray(indices, bits);
      expect(longs.length).toBe(Math.ceil((1000 * bits) / 64));
      const back = unpackBitArray(longs, bits, 1000);
      expect([...back]).toEqual(indices);
    }
  });
});

describe('nbt', () => {
  it('round-trips nested structures', () => {
    const root = nCompound({
      num: nInt(-12345),
      text: nString('こんにちは'),
      list: nList([nCompound({ a: nInt(1) }), nCompound({ a: nInt(2) })]),
      empty: nList([]),
    });
    const decoded = decodeNbt(encodeNbt('root', root));
    expect(decoded.name).toBe('root');
    const value = compound(decoded.root);
    expect(intOf(value['num'])).toBe(-12345);
    expect(value['text']).toEqual(nString('こんにちは'));
    expect(value['list']!.type === 'list' && value['list'].value.length).toBe(2);
    expect(value['empty']).toEqual(nList([]));
  });
});

describe('litematic writer', () => {
  it('writes a parseable schematic with correct blocks and metadata', () => {
    const builder = new RegionBuilder('main', { x: 0, y: -3, z: -2 }, { x: 4, y: 3, z: 5 });
    builder.set(0, 0, 0, { name: 'minecraft:dirt' });
    builder.set(0, 1, 0, {
      name: 'minecraft:note_block',
      properties: { instrument: 'harp', note: '12', powered: 'false' },
    });
    builder.set(3, 0, 4, { name: 'minecraft:dirt' });

    const file = writeLitematic({ name: 'test', author: 'DNW', description: '' }, [
      builder.build(),
    ]);
    const { root } = decodeNbt(gunzipSync(file));
    const top = compound(root);

    expect(intOf(top['Version'])).toBe(7);
    expect(intOf(top['SubVersion'])).toBe(1);
    expect(intOf(top['MinecraftDataVersion'])).toBe(4671);

    const meta = compound(top['Metadata']!);
    expect(intOf(meta['TotalBlocks'])).toBe(3);
    expect(intOf(meta['TotalVolume'])).toBe(60);
    expect(intOf(meta['RegionCount'])).toBe(1);
    expect(compound(meta['EnclosingSize']!)['x']).toEqual(nInt(4));

    const region = compound(compound(top['Regions']!)['main']!);
    expect(compound(region['Position']!)['y']).toEqual(nInt(-3));
    const paletteTag = region['BlockStatePalette']!;
    if (paletteTag.type !== 'list') throw new Error('palette not a list');
    expect(compound(paletteTag.value[0]!)['Name']).toEqual(nString('minecraft:air'));

    const statesTag = region['BlockStates']!;
    if (statesTag.type !== 'longArray') throw new Error('states not a longArray');
    const bits = bitsForPalette(paletteTag.value.length);
    const blocks = unpackBitArray(statesTag.value, bits, 60);

    const index = (x: number, y: number, z: number) => (y * 5 + z) * 4 + x;
    const nameAt = (x: number, y: number, z: number) => {
      const state = compound(paletteTag.value[blocks[index(x, y, z)]!]!);
      return state['Name']!.type === 'string' ? state['Name'].value : '';
    };
    expect(nameAt(0, 0, 0)).toBe('minecraft:dirt');
    expect(nameAt(0, 1, 0)).toBe('minecraft:note_block');
    expect(nameAt(3, 0, 4)).toBe('minecraft:dirt');
    expect(nameAt(1, 1, 1)).toBe('minecraft:air');
    const noteState = compound(paletteTag.value[blocks[index(0, 1, 0)]!]!);
    expect(compound(noteState['Properties']!)['note']).toEqual(nString('12'));
  });

  it('rejects a palette whose first entry is not air', () => {
    expect(() =>
      writeLitematic({ name: 'x', author: '', description: '' }, [
        {
          name: 'bad',
          position: { x: 0, y: 0, z: 0 },
          size: { x: 1, y: 1, z: 1 },
          palette: [{ name: 'minecraft:stone' }],
          blocks: new Uint32Array(1),
        },
      ]),
    ).toThrow(/air/);
  });
});
