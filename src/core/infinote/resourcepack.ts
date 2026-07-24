/**
 * Resource pack emission for DNW-managed custom sounds
 * (docs/litematic-export-spec.md §6).
 *
 * An instrument is "DNW-managed" when its sample lives in the app
 * (`soundSourceId` set); instruments with only a `soundId` reference an
 * externally installed pack and are not emitted.
 *
 * Spec deviation: stereo samples are detected and reported as a warning but
 * NOT down-mixed — re-encoding OGG in the browser needs an encoder we don't
 * ship yet. Stereo sounds play non-positionally in Minecraft, which defeats
 * the runner geometry, so the warning must not be ignored.
 */
import { zipSync } from "fflate"
import type { Instrument, Song } from "../model/types"
import { effectiveSoundId } from "./slots"

/**
 * Resource pack format for MC 1.21.x. Sound-only packs still load when the
 * format is off by a few versions (Minecraft only shows a warning), so this
 * does not need to track every patch release.
 */
export const PACK_FORMAT = 64

/** Custom instruments with app-managed samples used by the included layers. */
export function collectManagedInstruments( song: Song, layerIds: ReadonlySet< string > ): Instrument[] {
  const used = new Set< number >()
  for ( const layer of song.layers ) {
    if ( ! layerIds.has( layer.id ) ) continue
    for ( const note of layer.notes ) used.add( note.instrument )
  }
  return song.instruments.filter( ( inst, i ) => used.has( i ) && ! inst.isVanilla && !! inst.soundSourceId )
}

export interface PackSound {
  /** Normalized sound id, e.g. 'dnw:my_piano'. */
  soundId: string
  data: Uint8Array
}

/** Build the resource pack zip: pack.mcmeta + per-namespace sounds.json + oggs. */
export function buildResourcePack( sounds: PackSound[], description: string ): Uint8Array {
  const files: Record< string, Uint8Array > = {}
  const encoder = new TextEncoder()

  files[ "pack.mcmeta" ] = encoder.encode(
    JSON.stringify( { pack: { pack_format: PACK_FORMAT, description } }, null, 2 )
  )

  const byNamespace = new Map< string, PackSound[] >()
  for ( const sound of sounds ) {
    const [ ns = "dnw" ] = sound.soundId.split( ":" )
    const list = byNamespace.get( ns ) ?? []
    list.push( sound )
    byNamespace.set( ns, list )
  }

  for ( const [ ns, list ] of byNamespace ) {
    const soundsJson: Record< string, { sounds: string[] } > = {}
    for ( const sound of list ) {
      const path = sound.soundId.split( ":" )[ 1 ] ?? sound.soundId
      soundsJson[ path ] = { sounds: [ `${ ns }:${ path }` ] }
      files[ `assets/${ ns }/sounds/${ path }.ogg` ] = sound.data
    }
    files[ `assets/${ ns }/sounds.json` ] = encoder.encode( JSON.stringify( soundsJson, null, 2 ) )
  }

  return zipSync( files )
}

/**
 * Best-effort stereo detection via WebAudio. Returns warning strings for
 * samples with more than one channel; silently skips when decoding is
 * unavailable (tests, non-audio data).
 */
export async function detectStereoSounds( sounds: { name: string; data: ArrayBuffer }[] ): Promise< string[] > {
  if ( typeof AudioContext === "undefined" ) return []
  const warnings: string[] = []
  const ctx = new AudioContext()
  try {
    for ( const sound of sounds ) {
      try {
        const decoded = await ctx.decodeAudioData( sound.data.slice( 0 ) )
        if ( decoded.numberOfChannels > 1 ) {
          warnings.push(
            `'${ sound.name }' is stereo (${ decoded.numberOfChannels }ch): Minecraft plays stereo ` +
              "sounds non-positionally, so volume/pan placement will NOT apply. Convert it to mono."
          )
        }
      } catch {
        // Undecodable data: let Minecraft complain instead.
      }
    }
  } finally {
    void ctx.close()
  }
  return warnings
}

export { effectiveSoundId }
