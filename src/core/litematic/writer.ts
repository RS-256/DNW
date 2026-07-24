/**
 * .litematic file writer (litematica schematic, format Version 7).
 *
 * Version constants were extracted from schematics saved by litematica on
 * the target instance (MC 1.21.11). Regions are written with positive sizes
 * and Position at the minimum corner, which litematica accepts (files saved
 * in-game may use negative sizes instead; both are equivalent).
 */
import { gzipSync } from "fflate"
import type { NbtTag } from "./nbt"
import { encodeNbt, nCompound, nInt, nList, nLong, nLongArray, nString } from "./nbt"
import { bitsForPalette, packBitArray } from "./bitarray"

export const LITEMATIC_VERSION = 7
export const LITEMATIC_SUB_VERSION = 1
/** MC 1.21.11 data version. */
export const MINECRAFT_DATA_VERSION = 4671

export interface BlockState {
  /** Full block id, e.g. 'minecraft:note_block'. */
  name: string
  properties?: Record< string, string >
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface LitematicRegion {
  name: string
  /** Minimum corner in the schematic's coordinate space. */
  position: Vec3
  /** Positive extents. */
  size: Vec3
  /** palette[0] must be minecraft:air. */
  palette: BlockState[]
  /** Palette indices; length = x*y*z; index = (y * sizeZ + z) * sizeX + x. */
  blocks: Uint32Array
  /** Tile entity compounds with region-local x/y/z int tags included. */
  tileEntities?: NbtTag[]
}

export interface LitematicMeta {
  name: string
  author: string
  description: string
}

function vec3Tag( v: Vec3 ): NbtTag {
  return nCompound( { x: nInt( v.x ), y: nInt( v.y ), z: nInt( v.z ) } )
}

function blockStateTag( state: BlockState ): NbtTag {
  const tag: Record< string, NbtTag > = { Name: nString( state.name ) }
  if ( state.properties && Object.keys( state.properties ).length > 0 ) {
    const props: Record< string, NbtTag > = {}
    for ( const [ k, v ] of Object.entries( state.properties ) ) props[ k ] = nString( v )
    tag[ "Properties" ] = nCompound( props )
  }
  return nCompound( tag )
}

function regionTag( region: LitematicRegion ): NbtTag {
  const volume = region.size.x * region.size.y * region.size.z
  if ( region.blocks.length !== volume ) {
    throw new Error( `Region '${ region.name }': blocks length ${ region.blocks.length } != volume ${ volume }` )
  }
  if ( region.palette.length === 0 || region.palette[ 0 ]!.name !== "minecraft:air" ) {
    throw new Error( `Region '${ region.name }': palette[0] must be minecraft:air` )
  }
  const bits = bitsForPalette( region.palette.length )
  return nCompound( {
    Position: vec3Tag( region.position ),
    Size: vec3Tag( region.size ),
    BlockStatePalette: nList( region.palette.map( blockStateTag ) ),
    BlockStates: nLongArray( packBitArray( region.blocks, bits ) ),
    TileEntities: nList( region.tileEntities ?? [] ),
    Entities: nList( [] ),
    PendingBlockTicks: nList( [] ),
    PendingFluidTicks: nList( [] )
  } )
}

/** Serialize regions into a gzipped .litematic file. */
export function writeLitematic( meta: LitematicMeta, regions: LitematicRegion[] ): Uint8Array {
  if ( regions.length === 0 ) throw new Error( "At least one region is required" )

  let totalBlocks = 0
  let totalVolume = 0
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for ( const region of regions ) {
    totalVolume += region.size.x * region.size.y * region.size.z
    for ( const idx of region.blocks ) if ( idx !== 0 ) totalBlocks++
    min.x = Math.min( min.x, region.position.x )
    min.y = Math.min( min.y, region.position.y )
    min.z = Math.min( min.z, region.position.z )
    max.x = Math.max( max.x, region.position.x + region.size.x )
    max.y = Math.max( max.y, region.position.y + region.size.y )
    max.z = Math.max( max.z, region.position.z + region.size.z )
  }

  const now = BigInt( Date.now() )
  const regionsTag: Record< string, NbtTag > = {}
  const usedNames = new Set< string >()
  for ( const region of regions ) {
    let name = region.name || "region"
    for ( let i = 2; usedNames.has( name ); i++ ) name = `${ region.name } (${ i })`
    usedNames.add( name )
    regionsTag[ name ] = regionTag( region )
  }

  const root = nCompound( {
    MinecraftDataVersion: nInt( MINECRAFT_DATA_VERSION ),
    Version: nInt( LITEMATIC_VERSION ),
    SubVersion: nInt( LITEMATIC_SUB_VERSION ),
    Metadata: nCompound( {
      Name: nString( meta.name ),
      Author: nString( meta.author ),
      Description: nString( meta.description ),
      TimeCreated: nLong( now ),
      TimeModified: nLong( now ),
      RegionCount: nInt( regions.length ),
      TotalBlocks: nInt( totalBlocks ),
      TotalVolume: nInt( totalVolume ),
      EnclosingSize: vec3Tag( { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } )
    } ),
    Regions: nCompound( regionsTag )
  } )

  return gzipSync( encodeNbt( "", root ) )
}

/** Mutable region builder: sparse block placement over a fixed-size box. */
export class RegionBuilder {
  readonly palette: BlockState[] = [ { name: "minecraft:air" } ]
  readonly blocks: Uint32Array
  readonly tileEntities: NbtTag[] = []
  private paletteIndex = new Map< string, number >( [ [ "minecraft:air|", 0 ] ] )

  constructor(
    public readonly name: string,
    public readonly position: Vec3,
    public readonly size: Vec3
  ) {
    this.blocks = new Uint32Array( size.x * size.y * size.z )
  }

  private stateIndex( state: BlockState ): number {
    const key = `${ state.name }|${ Object.entries( state.properties ?? {} )
      .sort( ( [ a ], [ b ] ) => ( a < b ? -1 : 1 ) )
      .map( ( [ k, v ] ) => `${ k }=${ v }` )
      .join( "," ) }`
    let idx = this.paletteIndex.get( key )
    if ( idx === undefined ) {
      idx = this.palette.length
      this.palette.push( state )
      this.paletteIndex.set( key, idx )
    }
    return idx
  }

  /** Set a block at region-local coordinates. */
  set( x: number, y: number, z: number, state: BlockState ): void {
    const { x: sx, y: sy, z: sz } = this.size
    if ( x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ) {
      throw new Error( `Block out of region '${ this.name }' bounds: ${ x },${ y },${ z }` )
    }
    this.blocks[ ( y * sz + z ) * sx + x ] = this.stateIndex( state )
  }

  addTileEntity( tag: NbtTag ): void {
    this.tileEntities.push( tag )
  }

  build(): LitematicRegion {
    return {
      name: this.name,
      position: this.position,
      size: this.size,
      palette: this.palette,
      blocks: this.blocks,
      tileEntities: this.tileEntities
    }
  }
}
