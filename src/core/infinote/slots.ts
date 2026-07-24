/**
 * Slot computation for infinote config generation
 * (docs/litematic-export-spec.md §5).
 *
 * A "slot" is a (soundId, pitchShift) pair that needs a dedicated base block
 * in infinote's mappings. Vanilla instruments at shift 0 with no cent offset
 * play through the vanilla block and need no slot.
 *
 * infinote plays `pitch = 2^((note + pitchShift - 12) / 12)`, so a note with
 * model key `k`, instrument pitch anchor `pitchKey` and cent offset `c`
 * needs `note + pitchShift = k - pitchKey + 12 + c/100`. The integer part is
 * tiled in ±24 (2-octave) steps, matching the user's world convention: the
 * 25-value note range makes consecutive tiles contiguous.
 */
import type { Instrument, Song } from "../model/types"

export interface NotePlacementSound {
  /** note_block state value 0-24. */
  note: number
  /** Total pitch shift for the config entry (24k + cents/100). 0 = vanilla. */
  pitchShift: number
}

export interface Slot {
  soundId: string
  pitchShift: number
  /** How many notes in the song use this slot. */
  count: number
  /** Display name of the first instrument that produced the slot. */
  instrumentName: string
  /** Prefill for unassigned slots (a custom instrument's own baseBlock). */
  suggestedBlock?: string
}

/** Round to 4 decimals to keep float noise out of slot keys / config JSON. */
export function roundShift( shift: number ): number {
  return Math.round( shift * 10000 ) / 10000
}

export function slotKey( soundId: string, pitchShift: number ): string {
  return `${ soundId }@${ roundShift( pitchShift ) }`
}

/** Lower-case and default the namespace to `minecraft:`. */
export function normalizeId( id: string ): string {
  const trimmed = id.trim().toLowerCase()
  if ( trimmed === "" ) return ""
  return trimmed.includes( ":" ) ? trimmed : `minecraft:${ trimmed }`
}

export function vanillaSoundId( vanillaId: string ): string {
  return `minecraft:block.note_block.${ vanillaId }`
}

/**
 * The infinote sound id used for an instrument: the explicit `soundId` field
 * when set, the vanilla sound event for vanilla instruments, or a generated
 * `dnw:` id for custom instruments that never got one.
 */
export function effectiveSoundId( inst: Instrument ): string {
  if ( inst.soundId && inst.soundId.trim() !== "" ) return normalizeId( inst.soundId )
  if ( inst.isVanilla ) return vanillaSoundId( inst.vanillaId ?? "harp" )
  const slug = inst.name.toLowerCase().replace( /[^a-z0-9_.-]+/g, "_" ) || "custom"
  return `dnw:${ slug }`
}

/** Decompose a model key + cent offset into (note value, pitchShift). */
export function decomposeKey( key: number, pitchKey: number, cents: number ): NotePlacementSound {
  const semitone = key - pitchKey + 12
  // Candidate 2-octave tiles that put the note value in [0, 24]; prefer the
  // smallest |shift|, and shift 0 outright when the key fits natively.
  const kMin = Math.ceil( ( semitone - 24 ) / 24 )
  const kMax = Math.floor( semitone / 24 )
  let best = kMin
  for ( let k = kMin; k <= kMax; k++ ) {
    if ( Math.abs( k ) < Math.abs( best ) ) best = k
  }
  return {
    note: semitone - best * 24,
    pitchShift: roundShift( best * 24 + cents / 100 )
  }
}

/** True when the note can play on an unmapped vanilla note block. */
export function isVanillaPlayable( inst: Instrument, sound: NotePlacementSound ): boolean {
  return inst.isVanilla && sound.pitchShift === 0
}

/** Collect every config slot used by the given layers (by layer id). */
export function collectSlots( song: Song, layerIds: ReadonlySet< string > ): Map< string, Slot > {
  const slots = new Map< string, Slot >()
  for ( const layer of song.layers ) {
    if ( ! layerIds.has( layer.id ) ) continue
    for ( const note of layer.notes ) {
      const inst = song.instruments[ note.instrument ]
      if ( ! inst ) continue
      const sound = decomposeKey( note.key, inst.pitchKey, note.pitch )
      if ( isVanillaPlayable( inst, sound ) ) continue
      const soundId = effectiveSoundId( inst )
      const key = slotKey( soundId, sound.pitchShift )
      const existing = slots.get( key )
      if ( existing ) existing.count++
      else
        slots.set( key, {
          soundId,
          pitchShift: sound.pitchShift,
          count: 1,
          instrumentName: inst.name,
          suggestedBlock:
            ! inst.isVanilla && sound.pitchShift === 0 && inst.baseBlock ? normalizeId( inst.baseBlock ) : undefined
        } )
    }
  }
  return slots
}
