/**
 * Litematic structure generation: track regions + tempo (listener driver)
 * region + palette region (docs/litematic-export-spec.md §2, §3, §7).
 *
 * The schematic origin is the runner's position at tick 0: x = tick,
 * y = 0 = runner line, z = 0 = lateral center. tp commands use relative
 * coordinates (command blocks execute at their block center, hence the -0.5
 * correction), so the structure is position-independent.
 */
import type { Song } from '../model/types';
import { VANILLA_BASE_BLOCKS, songLength } from '../model/song';
import { bpmToTps } from '../model/tempoMap';
import type { NbtTag } from '../litematic/nbt';
import { nByte, nCompound, nInt, nList, nString } from '../litematic/nbt';
import type { LitematicRegion } from '../litematic/writer';
import { RegionBuilder, writeLitematic } from '../litematic/writer';
import type { AllocationState } from './allocation';
import type { PlacementOptions, PlacementResult } from './placement';
import { placeSong } from './placement';
import { collectSlots, normalizeId, slotKey, vanillaSoundId } from './slots';

export type PaletteRegionMode = 'song' | 'full' | 'none';

export interface GenerateOptions extends PlacementOptions {
  /** Fix the listener's facing in the tp commands (yaw -90 = +x). */
  includeRotation: boolean;
  paletteRegion: PaletteRegionMode;
  /** Depth of the tempo command-block row below the runner (> 48). */
  tempoDepth: number;
}

export const DEFAULT_TEMPO_DEPTH = 50;

export interface GenerateResult {
  file: Uint8Array;
  warnings: string[];
  /** Notes placed / notes exceeding the 1 dB error threshold. */
  notesPlaced: number;
  overThreshold: number;
  maxDbError: number;
  /** Full per-track placement details (consumed by the manifest). */
  placement: PlacementResult;
}

function commandBlockEntity(x: number, y: number, z: number, command: string): NbtTag {
  // Field set mirrors command blocks captured from the target instance.
  return nCompound({
    id: nString('minecraft:command_block'),
    x: nInt(x),
    y: nInt(y),
    z: nInt(z),
    Command: nString(command),
    CustomName: nString('@'),
    SuccessCount: nInt(0),
    TrackOutput: nByte(1),
    UpdateLastExecution: nByte(1),
    auto: nByte(0),
    powered: nByte(0),
    conditionMet: nByte(0),
    components: nCompound({}),
  });
}

function noteBlockState(instrument: string, note: number) {
  return {
    name: 'minecraft:note_block',
    properties: { instrument, note: String(note), powered: 'false' },
  };
}

/** Sign tile entity (1.21 format, mirrored from signs saved on the target instance). */
function signEntity(x: number, y: number, z: number, lines: string[]): NbtTag {
  const text = (messages: string[]) =>
    nCompound({
      color: nString('black'),
      has_glowing_text: nByte(0),
      messages: nList([0, 1, 2, 3].map((i) => nString(messages[i] ?? ''))),
    });
  return nCompound({
    id: nString('minecraft:sign'),
    x: nInt(x),
    y: nInt(y),
    z: nInt(z),
    is_waxed: nByte(0),
    components: nCompound({}),
    front_text: text(lines),
    back_text: text([]),
  });
}

/** Sign line 1: sound id tail, capped to the 15-char sign line limit. */
function soundLabel(soundId: string): string {
  const path = soundId.split(':')[1] ?? soundId;
  const tail = path.split('.').pop() ?? path;
  return tail.slice(0, 15);
}

/** Sign line 2: pitch shift, using the user's 'default' convention for 0. */
function shiftLabel(pitchShift: number): string {
  if (pitchShift === 0) return 'default';
  return pitchShift > 0 ? `+${pitchShift}` : String(pitchShift);
}

function formatTps(tps: number): string {
  return String(Math.round(tps * 1000) / 1000);
}

function buildTrackRegions(placement: PlacementResult, length: number): LitematicRegion[] {
  const regions: LitematicRegion[] = [];
  for (const track of placement.tracks) {
    if (track.placed.length === 0) continue;
    const half = track.maxAbsDz;
    const builder = new RegionBuilder(
      track.name,
      { x: 0, y: track.noteY - 1, z: -half },
      { x: length, y: 3, z: 2 * half + 1 },
    );
    for (const p of track.placed) {
      const lz = p.dz + half;
      builder.set(p.tick, 0, lz, { name: p.baseBlock });
      builder.set(p.tick, 1, lz, noteBlockState(p.instrumentProp, p.noteValue));
    }
    regions.push(builder.build());
  }
  return regions;
}

function buildTempoRegion(
  song: Song,
  length: number,
  lowestY: number,
  options: GenerateOptions,
): LitematicRegion {
  const y = Math.min(-options.tempoDepth, lowestY - 3);
  const builder = new RegionBuilder('tempo', { x: 0, y, z: 0 }, { x: length, y: 1, z: 2 });

  // Listener driver: one tp per tick. The command block executes at its
  // center, so ~ already matches the note lattice on x/z and y needs -0.5.
  const rotation = options.includeRotation ? ' -90 0' : '';
  const tpCommand = `tp @p ~ ~${-y - 0.5} ~${rotation}`;
  for (let t = 0; t < length; t++) {
    builder.set(t, 0, 0, { name: 'minecraft:command_block' });
    builder.addTileEntity(commandBlockEntity(t, 0, 0, tpCommand));
  }

  // Tempo: the server tick rate is the playback clock (infinote /bpm set
  // does the same); emit `tick rate` at tick 0 and at every bpm change.
  for (const ev of song.tempoTrack.events) {
    if (ev.type !== 'bpm' || ev.tick >= length) continue;
    const tps = bpmToTps(ev.bpm, song.tickPerQuarter);
    builder.set(ev.tick, 0, 1, { name: 'minecraft:command_block' });
    builder.addTileEntity(commandBlockEntity(ev.tick, 0, 1, `tick rate ${formatTps(tps)}`));
  }

  return builder.build();
}

interface PaletteColumn {
  soundId: string;
  /** (pitchShift, blockId) tiers, sorted by shift ascending (bottom→top). */
  tiers: { pitchShift: number; blockId: string }[];
}

function paletteColumns(
  song: Song,
  orderedLayerIds: readonly string[],
  allocation: AllocationState,
  mode: PaletteRegionMode,
): PaletteColumn[] {
  const bySound = new Map<string, Map<number, string>>();
  const add = (soundId: string, pitchShift: number, blockId: string) => {
    let tiers = bySound.get(soundId);
    if (!tiers) bySound.set(soundId, (tiers = new Map()));
    if (!tiers.has(pitchShift)) tiers.set(pitchShift, blockId);
  };

  if (mode === 'full') {
    for (const [key, blockId] of Object.entries(allocation.slots)) {
      const at = key.lastIndexOf('@');
      if (at > 0) add(key.slice(0, at), Number(key.slice(at + 1)), blockId);
    }
    for (const [inst, block] of Object.entries(VANILLA_BASE_BLOCKS)) {
      add(vanillaSoundId(inst), 0, block);
    }
  } else {
    const included = new Set(orderedLayerIds);
    for (const slot of collectSlots(song, included).values()) {
      const blockId = allocation.slots[slotKey(slot.soundId, slot.pitchShift)];
      if (blockId) add(slot.soundId, slot.pitchShift, blockId);
    }
    // Vanilla shift-0 tiers for every vanilla instrument the song uses.
    for (const layer of song.layers) {
      if (!included.has(layer.id)) continue;
      for (const note of layer.notes) {
        const inst = song.instruments[note.instrument];
        if (inst?.isVanilla && inst.vanillaId) {
          add(vanillaSoundId(inst.vanillaId), 0, VANILLA_BASE_BLOCKS[inst.vanillaId]);
        }
      }
    }
  }

  const columns: PaletteColumn[] = [...bySound.entries()].map(([soundId, tiers]) => ({
    soundId,
    tiers: [...tiers.entries()]
      .map(([pitchShift, blockId]) => ({ pitchShift, blockId }))
      .sort((a, b) => a.pitchShift - b.pitchShift),
  }));
  // Single-tier (percussion-like) columns first, then multi-tier, each
  // sorted by sound id; a glass column separates the two groups.
  columns.sort(
    (a, b) =>
      Number(a.tiers.length > 1) - Number(b.tiers.length > 1) ||
      (a.soundId < b.soundId ? -1 : 1),
  );
  return columns;
}

function buildPaletteRegion(columns: PaletteColumn[]): LitematicRegion | null {
  if (columns.length === 0) return null;
  const separatorAt = columns.findIndex((c) => c.tiers.length > 1);
  const hasSeparator = separatorAt > 0 && separatorAt < columns.length;
  const width = columns.length + (hasSeparator ? 1 : 0);
  const height = Math.max(...columns.map((c) => c.tiers.length)) * 3;

  // x = 0: base block + note block columns; x = 1: wall-sign labels.
  const builder = new RegionBuilder('palette', { x: -4, y: 0, z: 0 }, { x: 2, y: height, z: width });
  let z = 0;
  columns.forEach((column, i) => {
    if (hasSeparator && i === separatorAt) {
      for (let y = 0; y < height; y++) {
        builder.set(0, y, z, { name: 'minecraft:black_stained_glass' });
      }
      z++;
    }
    column.tiers.forEach((tier, level) => {
      const y = level * 3;
      builder.set(0, y, z, { name: normalizeId(tier.blockId) });
      builder.set(0, y + 1, z, noteBlockState('harp', 0));
      builder.set(1, y + 1, z, {
        name: 'minecraft:birch_wall_sign',
        properties: { facing: 'east' },
      });
      builder.addTileEntity(
        signEntity(1, y + 1, z, [soundLabel(column.soundId), shiftLabel(tier.pitchShift)]),
      );
    });
    z++;
  });
  return builder.build();
}

/** Generate the full .litematic. Throws when a used slot has no base block. */
export function generateLitematic(
  song: Song,
  orderedLayerIds: readonly string[],
  allocation: AllocationState,
  options: GenerateOptions,
): GenerateResult {
  const length = songLength(song) + 1;
  if (length <= 0) throw new Error('The song has no notes to export.');

  const placement = placeSong(song, orderedLayerIds, options, (soundId, pitchShift) => {
    const block = allocation.slots[slotKey(soundId, pitchShift)];
    return block ? normalizeId(block) : undefined;
  });
  const notesPlaced = placement.tracks.reduce((sum, t) => sum + t.placed.length, 0);
  if (notesPlaced === 0) throw new Error('The selected tracks have no notes to export.');

  const regions = buildTrackRegions(placement, length);
  const lowestY = Math.min(0, ...regions.map((r) => r.position.y));
  regions.push(buildTempoRegion(song, length, lowestY, options));

  if (options.paletteRegion !== 'none') {
    const palette = buildPaletteRegion(
      paletteColumns(song, orderedLayerIds, allocation, options.paletteRegion),
    );
    if (palette) regions.push(palette);
  }

  const file = writeLitematic(
    {
      name: song.meta.name.trim() || 'untitled',
      author: song.meta.author.trim() || 'DNW',
      description: song.meta.description,
    },
    regions,
  );

  return {
    file,
    warnings: placement.warnings,
    notesPlaced,
    overThreshold: placement.overThreshold,
    maxDbError: placement.maxDbError,
    placement,
  };
}
