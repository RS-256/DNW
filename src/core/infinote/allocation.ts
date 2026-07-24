/**
 * Allocation table: (soundId, pitchShift) slot -> base block id, persisted in
 * localStorage so assignments stay stable across exports
 * (docs/litematic-export-spec.md §5).
 *
 * The table is seeded by importing the world's live `infinote.json`; the raw
 * imported mappings are kept alongside so the exported config is always the
 * full merge (infinote's import replaces the file wholesale). Inert entries
 * (memo keys pointing at nonexistent blocks) survive the round trip.
 */
import { normalizeId, roundShift, slotKey } from "./slots"

export interface MappingEntry {
  sound: string
  category: string
  pitchShift: number
  volume: number
}

export interface AllocationState {
  /** slotKey -> base block id. */
  slots: Record< string, string >
  /** Raw mappings from the imported infinote.json (blockId -> entry). */
  imported: Record< string, MappingEntry >
}

const STORAGE_KEY = "dnw.infinoteAllocation"

export function emptyAllocation(): AllocationState {
  return { slots: {}, imported: {} }
}

export function loadAllocation(): AllocationState {
  try {
    const raw = localStorage.getItem( STORAGE_KEY )
    if ( ! raw ) return emptyAllocation()
    const parsed = JSON.parse( raw ) as Partial< AllocationState >
    return { slots: parsed.slots ?? {}, imported: parsed.imported ?? {} }
  } catch {
    return emptyAllocation()
  }
}

export function saveAllocation( state: AllocationState ): void {
  localStorage.setItem( STORAGE_KEY, JSON.stringify( state ) )
}

/**
 * Seed the allocation table from an infinote.json text (schema 1, or the
 * schema-0 root-level mapping form). Existing slot assignments are
 * overwritten by the imported file; returns the number of mappings read.
 */
export function seedFromInfinoteJson( state: AllocationState, text: string ): number {
  const parsed: unknown = JSON.parse( text )
  if ( typeof parsed !== "object" || parsed === null ) {
    throw new Error( "infinote.json: root is not an object" )
  }
  const root = parsed as Record< string, unknown >
  const mappings = ( "mappings" in root ? root[ "mappings" ] : root ) as Record< string, Partial< MappingEntry > >
  if ( typeof mappings !== "object" || mappings === null ) {
    throw new Error( "infinote.json: no mappings found" )
  }

  let count = 0
  for ( const [ rawBlockId, entry ] of Object.entries( mappings ) ) {
    if ( ! entry || typeof entry.sound !== "string" ) continue
    const blockId = normalizeId( rawBlockId )
    const mapping: MappingEntry = {
      sound: normalizeId( entry.sound ),
      category: entry.category ?? "RECORDS",
      pitchShift: roundShift( Number( entry.pitchShift ?? 0 ) ),
      volume: Number( entry.volume ?? 3 )
    }
    state.imported[ blockId ] = mapping
    state.slots[ slotKey( mapping.sound, mapping.pitchShift ) ] = blockId
    count++
  }
  return count
}

export interface ResolvedSlot {
  soundId: string
  pitchShift: number
  blockId: string
}

/**
 * Build the merged infinote.json (imported ∪ generated slots). Generated
 * entries pin volume to 3.0 and category to RECORDS (spec §5). Returns the
 * pretty-printed JSON and any block-id conflicts with imported entries.
 */
export function buildInfinoteConfig(
  state: AllocationState,
  slots: ResolvedSlot[]
): { json: string; conflicts: string[] } {
  const mappings: Record< string, MappingEntry > = { ...state.imported }
  const conflicts: string[] = []

  for ( const slot of slots ) {
    const blockId = normalizeId( slot.blockId )
    const entry: MappingEntry = {
      sound: slot.soundId,
      category: "RECORDS",
      pitchShift: roundShift( slot.pitchShift ),
      volume: 3.0
    }
    const existing = mappings[ blockId ]
    if ( existing && ( existing.sound !== entry.sound || existing.pitchShift !== entry.pitchShift ) ) {
      conflicts.push(
        `${ blockId }: already mapped to ${ existing.sound }@${ existing.pitchShift }, ` +
          `wanted ${ entry.sound }@${ entry.pitchShift }`
      )
      continue
    }
    mappings[ blockId ] = existing ?? entry
  }

  const json = JSON.stringify( { schema: 1, mappings }, null, 2 )
  return { json, conflicts }
}
