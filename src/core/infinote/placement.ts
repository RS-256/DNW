/**
 * Spatial note placement for the runner structure
 * (docs/litematic-export-spec.md §2-§4).
 *
 * Coordinate frame: +x = time (1 block per tick), y = 0 is the runner line,
 * z = 0 is the runner's lateral center. A note placed at (tick, noteY, dz)
 * is heard at distance d = sqrt(depth² + dz²) when the listener passes.
 *
 * Gain model: linear falloff g(d) = max(0, 1 - d/48) (note block range 48 =
 * 16 × the pinned config volume 3.0). Velocity maps to a target gain
 * relative to the track's depth-capped maximum, then the falloff is
 * inverted to get the lateral offset. All error reporting is in dB.
 */
import type { Instrument, Layer, Note, Song } from "../model/types"
import { VANILLA_BASE_BLOCKS } from "../model/song"
import type { VanillaInstrumentId } from "../model/types"
import { decomposeKey, effectiveSoundId, isVanillaPlayable, slotKey } from "./slots"

export const NOTE_RANGE = 48
/**
 * Hard cap on the listener→block distance. At exactly 48 blocks a note is
 * silent (and lattice rounding could even push it past the range), so every
 * note is kept strictly inside; the 1-block margin also absorbs the
 * listener's ear-height offset that the block-grid distance model ignores.
 */
export const MAX_PLACEMENT_DISTANCE = 47
/** Give up nudging a conflicting note beyond this lateral distance. */
const MAX_NUDGE = 96

export type PlacementSide = "below" | "above" | "both"

export interface PlacementOptions {
  side: PlacementSide
  /** Multiply velocity by instrument/layer/group volumes (like playback). */
  applyMixerVolumes: boolean
  /** Velocity -> gain curve exponent. */
  alpha: number
  /** Runner line to the first track's note-block row, in blocks. */
  firstDepth: number
  /** Vertical distance between consecutive track tiers. */
  spacing: number
}

export const DEFAULT_PLACEMENT: PlacementOptions = {
  side: "below",
  applyMixerVolumes: true,
  alpha: 2,
  firstDepth: 2,
  spacing: 3
}

export interface PlacedNote {
  tick: number
  /** Global y of the note block (base sits at noteY-1, air at noteY+1). */
  noteY: number
  /** Signed lateral offset from the runner center. */
  dz: number
  baseBlock: string
  /** note_block state value 0-24. */
  noteValue: number
  /** note_block 'instrument' state property. */
  instrumentProp: string
  /** |realized - target| in dB after lattice rounding / conflict nudges. */
  dbError: number
}

export interface TrackPlacement {
  layerId: string
  name: string
  /** Depth of the note-block row below/above the runner line. */
  depth: number
  /** Global y of the note-block row. */
  noteY: number
  placed: PlacedNote[]
  maxAbsDz: number
}

export interface PlacementResult {
  tracks: TrackPlacement[]
  warnings: string[]
  /** Notes whose dB error exceeds 1 dB. */
  overThreshold: number
  maxDbError: number
}

const gain = ( d: number ): number => Math.max( 0, 1 - d / NOTE_RANGE )

function dbError( target: number, real: number ): number {
  const eps = 1e-6
  if ( target <= eps && real <= eps ) return 0
  if ( target <= eps || real <= eps ) return Infinity
  return Math.abs( 20 * Math.log10( real / target ) )
}

/** Vertical (sign, depth) per included track index. */
export function trackDepth(
  index: number,
  options: Pick< PlacementOptions, "side" | "firstDepth" | "spacing" >
): { sign: 1 | -1; depth: number } {
  // Above the runner the base block of the first tier must clear the
  // player's head, so the minimum first depth is one block larger.
  const firstAbove = Math.max( options.firstDepth, 3 )
  switch ( options.side ) {
    case "below":
      return { sign: -1, depth: options.firstDepth + index * options.spacing }
    case "above":
      return { sign: 1, depth: firstAbove + index * options.spacing }
    case "both": {
      const sign = index % 2 === 0 ? -1 : 1
      const row = Math.floor( index / 2 )
      return {
        sign,
        depth: ( sign < 0 ? options.firstDepth : firstAbove ) + row * options.spacing
      }
    }
  }
}

/** Vanilla instrument for a base block (note_block state property). */
const INSTRUMENT_BY_BLOCK = new Map< string, string >(
  ( Object.entries( VANILLA_BASE_BLOCKS ) as [ VanillaInstrumentId, string ][] ).map( ( [ inst, block ] ) => [
    block,
    inst
  ] )
)

function instrumentProp( baseBlock: string ): string {
  return INSTRUMENT_BY_BLOCK.get( baseBlock ) ?? "harp"
}

export interface ResolveBlock {
  ( soundId: string, pitchShift: number ): string | undefined
}

interface EffectiveNote {
  note: Note
  vEff: number
  effPan: number
  inst: Instrument
}

function effective( song: Song, layer: Layer, note: Note, applyMixerVolumes: boolean ): EffectiveNote | null {
  const inst = song.instruments[ note.instrument ]
  if ( ! inst ) return null
  let vEff = note.velocity / 100
  if ( applyMixerVolumes ) {
    const group = layer.groupId ? song.groups.find( ( g ) => g.id === layer.groupId ) : undefined
    vEff *= ( inst.volume / 100 ) * ( layer.volume / 100 ) * ( ( group?.volume ?? 100 ) / 100 )
  }
  const effPan = Math.max( -1, Math.min( 1, note.pan + layer.pan ) )
  return { note, vEff: Math.max( 0, Math.min( 1, vEff ) ), effPan, inst }
}

/** Place one track's notes. Throws if a needed slot has no base block. */
export function placeTrack(
  song: Song,
  layer: Layer,
  index: number,
  options: PlacementOptions,
  resolveBlock: ResolveBlock
): TrackPlacement {
  const { sign, depth } = trackDepth( index, options )
  const noteY = sign * depth
  const gLayer = gain( depth )
  const maxMagnitude =
    depth >= MAX_PLACEMENT_DISTANCE ? 0 : Math.floor( Math.sqrt( MAX_PLACEMENT_DISTANCE ** 2 - depth * depth ) )
  const occupied = new Map< number, Set< number > >()
  const placed: PlacedNote[] = []
  let balance = 0 // (#right - #left) among pan-free notes, for the balancer
  let maxAbsDz = 0

  for ( const raw of layer.notes ) {
    const eff = effective( song, layer, raw, options.applyMixerVolumes )
    if ( ! eff ) continue
    const { note, vEff, effPan, inst } = eff

    const sound = decomposeKey( note.key, inst.pitchKey, note.pitch )
    const baseBlock = isVanillaPlayable( inst, sound )
      ? VANILLA_BASE_BLOCKS[ inst.vanillaId ?? "harp" ]
      : resolveBlock( effectiveSoundId( inst ), sound.pitchShift )
    if ( ! baseBlock ) {
      throw new Error( `No base block assigned for slot ${ slotKey( effectiveSoundId( inst ), sound.pitchShift ) }` )
    }

    // Target gain and ideal lateral magnitude (spec §4). The distance is
    // clamped inside the audible range (and to the track's reachable lateral
    // extent); the error target follows the clamp, since anything quieter is
    // simply not representable on this track.
    const idealGain = gLayer * Math.pow( vEff, options.alpha )
    const d = Math.min( NOTE_RANGE * ( 1 - idealGain ), MAX_PLACEMENT_DISTANCE )
    const idealMagnitude = Math.min( Math.sqrt( Math.max( 0, d * d - depth * depth ) ), maxMagnitude )
    const targetGain = gain( Math.hypot( depth, idealMagnitude ) )
    const magnitude = Math.round( idealMagnitude )

    const panFree = Math.abs( effPan ) < 1e-9
    const wantedSign = panFree ? (balance <= 0 ? 1 : -1) : effPan > 0 ? 1 : -1

    const cells = occupied.get( note.tick ) ?? new Set< number >()
    occupied.set( note.tick, cells )

    let dz: number | null = null
    outer: for ( let delta = 0; delta <= MAX_NUDGE && dz === null; delta++ ) {
      const magnitudes = delta === 0 ? [ magnitude ] : [ magnitude + delta, magnitude - delta ]
      // At equal nudge distance, prefer the magnitude with the smaller dB error.
      magnitudes.sort(
        ( a, b ) =>
          dbError( targetGain, gain( Math.hypot( depth, a ) ) ) - dbError( targetGain, gain( Math.hypot( depth, b ) ) )
      )
      for ( const m of magnitudes ) {
        if ( m < 0 || m > maxMagnitude ) continue
        for ( const s of panFree ? [ wantedSign, -wantedSign ] : [ wantedSign ] ) {
          const candidate = s * m
          if ( ! cells.has( candidate ) ) {
            dz = candidate
            break outer
          }
          if ( m === 0 ) break // dz 0 has no mirror
        }
      }
    }
    if ( dz === null ) {
      throw new Error( `Could not place note at tick ${ note.tick } in track '${ layer.name }'` )
    }

    cells.add( dz )
    if ( panFree && dz !== 0 ) balance += Math.sign( dz )
    maxAbsDz = Math.max( maxAbsDz, Math.abs( dz ) )

    placed.push( {
      tick: note.tick,
      noteY,
      dz,
      baseBlock,
      noteValue: sound.note,
      instrumentProp: instrumentProp( baseBlock ),
      dbError: dbError( targetGain, gain( Math.hypot( depth, dz ) ) )
    } )
  }

  return { layerId: layer.id, name: layer.name, depth, noteY, placed, maxAbsDz }
}

/** Place every included track (in export-list order). */
export function placeSong(
  song: Song,
  orderedLayerIds: readonly string[],
  options: PlacementOptions,
  resolveBlock: ResolveBlock
): PlacementResult {
  const byId = new Map( song.layers.map( ( l ) => [ l.id, l ] ) )
  const tracks: TrackPlacement[] = []
  const warnings: string[] = []
  let overThreshold = 0
  let maxDbError = 0

  orderedLayerIds.forEach( ( id, index ) => {
    const layer = byId.get( id )
    if ( ! layer ) return
    const track = placeTrack( song, layer, index, options, resolveBlock )
    if ( track.depth >= MAX_PLACEMENT_DISTANCE && track.placed.length > 0 ) {
      warnings.push(
        `Track '${ track.name }' sits at depth ${ track.depth }, at/beyond the audible range — ` +
          "its notes are pinned to the runner line and will be near-silent."
      )
    }
    for ( const p of track.placed ) {
      if ( p.dbError > 1 ) overThreshold++
      if ( Number.isFinite( p.dbError ) ) maxDbError = Math.max( maxDbError, p.dbError )
    }
    tracks.push( track )
  } )

  if ( overThreshold > 0 ) {
    warnings.push( `${ overThreshold } note(s) exceed 1 dB placement error (max ${ maxDbError.toFixed( 2 ) } dB)` )
  }
  return { tracks, warnings, overThreshold, maxDbError }
}
