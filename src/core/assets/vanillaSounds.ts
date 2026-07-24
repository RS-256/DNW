/**
 * Vanilla note block sample acquisition.
 *
 * Mojang assets are not redistributable, so nothing is bundled. Samples are
 * fetched on demand from the community asset mirror
 * (github.com/InventivetalentDev/minecraft-assets) served over jsDelivr, which
 * sends `Access-Control-Allow-Origin: *`. That means no proxy is needed in dev
 * or on static hosting (GitHub Pages). Note block samples are essentially
 * unchanged across versions, so the mirror's latest tag is used; override the
 * base with `VITE_MC_SOUND_BASE` to pin a version or self-host.
 */
import type { VanillaInstrumentId } from "../model/types"

const SOUND_BASE =
  import.meta.env.VITE_MC_SOUND_BASE ||
  "https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@latest/assets/minecraft/sounds/note"

/** Instruments whose sample file name differs from the instrument id. */
const ASSET_NAME_OVERRIDES: Partial< Record< VanillaInstrumentId, string > > = {
  basedrum: "bd",
  chime: "icechime",
  xylophone: "xylobone"
}

/** Sample file-name candidates for each vanilla instrument. */
function fileNameCandidates( id: VanillaInstrumentId ): string[] {
  const override = ASSET_NAME_OVERRIDES[ id ]
  return override ? [ override, id ] : [ id ]
}

const soundPromises = new Map< VanillaInstrumentId, Promise< ArrayBuffer > >()

export function fetchVanillaSound( id: VanillaInstrumentId ): Promise< ArrayBuffer > {
  let promise = soundPromises.get( id )
  if ( ! promise ) {
    promise = ( async () => {
      let lastStatus = 0
      for ( const name of fileNameCandidates( id ) ) {
        const res = await fetch( `${ SOUND_BASE }/${ name }.ogg` )
        if ( res.ok ) return res.arrayBuffer()
        lastStatus = res.status
      }
      throw new Error( `No asset found for instrument "${ id }" (last status ${ lastStatus })` )
    } )()
    // Allow retrying after a failure (e.g. transient network error).
    promise.catch( () => soundPromises.delete( id ) )
    soundPromises.set( id, promise )
  }
  // Hand out a copy: decodeAudioData detaches the buffer it is given, and
  // there are multiple consumers (realtime playback, WAV export).
  return promise.then( ( data ) => data.slice( 0 ) )
}
