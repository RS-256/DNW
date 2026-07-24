/**
 * IndexedDB persistence: debounced autosave of the current song plus a
 * `sounds` store for imported sample binaries (custom instruments).
 */
import { openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import { deserializeProject, serializeProject } from "../core/project/serialize"
import type { Song } from "../core/model/types"
import { useSongStore } from "./songStore"

interface DnwDB extends DBSchema {
  kv: { key: string; value: string }
  sounds: { key: string; value: ArrayBuffer }
  textures: { key: string; value: ArrayBuffer }
}

const AUTOSAVE_KEY = "autosave"
const AUTOSAVE_DELAY_MS = 1500

let dbPromise: Promise< IDBPDatabase< DnwDB > > | null = null

function db(): Promise< IDBPDatabase< DnwDB > > {
  dbPromise ??= openDB< DnwDB >( "dnw", 2, {
    upgrade( database, oldVersion ) {
      if ( oldVersion < 1 ) {
        database.createObjectStore( "kv" )
        database.createObjectStore( "sounds" )
      }
      if ( oldVersion < 2 ) {
        database.createObjectStore( "textures" )
      }
    }
  } )
  return dbPromise
}

export async function loadAutosave(): Promise< Song | null > {
  try {
    const json = await ( await db() ).get( "kv", AUTOSAVE_KEY )
    return json ? deserializeProject( json ) : null
  } catch {
    return null
  }
}

/** Subscribe to the song store and autosave (debounced). Call once at startup. */
export function startAutosave(): () => void {
  let timer: ReturnType< typeof setTimeout > | null = null
  const unsubscribe = useSongStore.subscribe( ( state ) => {
    if ( timer !== null ) clearTimeout( timer )
    timer = setTimeout( () => {
      void db().then( ( d ) => d.put( "kv", serializeProject( state.song ), AUTOSAVE_KEY ) )
    }, AUTOSAVE_DELAY_MS )
  } )
  return () => {
    if ( timer !== null ) clearTimeout( timer )
    unsubscribe()
  }
}

export async function clearAutosave(): Promise< void > {
  await ( await db() ).delete( "kv", AUTOSAVE_KEY )
}

// --- sample binaries (custom instruments) ---

export async function putSound( id: string, data: ArrayBuffer ): Promise< void > {
  await ( await db() ).put( "sounds", data, id )
}

export async function getSound( id: string ): Promise< ArrayBuffer | undefined > {
  return ( await db() ).get( "sounds", id )
}

export async function deleteSound( id: string ): Promise< void > {
  await ( await db() ).delete( "sounds", id )
}

// --- block textures (skin feature) ---

import type { TextureStore } from "../core/assets/blockTextures"

export const textureStore: TextureStore = {
  async get( name ) {
    return ( await db() ).get( "textures", name )
  },
  async put( name, data ) {
    await ( await db() ).put( "textures", data, name )
  },
  async has() {
    return ( await ( await db() ).count( "textures" ) ) > 0
  }
}
