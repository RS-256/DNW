/**
 * Skin (textured notes) setting + block texture acquisition.
 * Textures come from the Minecraft client jar: downloaded through the dev
 * proxy, or provided by dropping a version jar onto the button.
 */
import { useEffect, useState } from "react"
import type { DragEvent } from "react"
import { downloadTextures, extractJar } from "../../core/assets/blockTextures"
import { textureStore } from "../../state/persistence"
import { useSettingsStore } from "../../state/settingsStore"
import type { SkinMode } from "../../state/settingsStore"
import { skinTileCache } from "../pianoroll/skinTiles"

type TextureState = "unknown" | "missing" | "downloading" | "ready" | "error"

export default function SkinControl() {
  const skinMode = useSettingsStore( ( s ) => s.skinMode )
  const setSkinMode = useSettingsStore( ( s ) => s.setSkinMode )
  const [ texState, setTexState ] = useState< TextureState >( "unknown" )
  const [ progress, setProgress ] = useState( 0 )

  useEffect( () => {
    void textureStore.has().then( ( has ) => setTexState( has ? "ready" : "missing" ) )
  }, [] )

  const download = () => {
    setTexState( "downloading" )
    setProgress( 0 )
    void downloadTextures( textureStore, setProgress )
      .then( () => {
        skinTileCache.invalidate()
        setTexState( "ready" )
        // Nudge a repaint.
        setSkinMode( useSettingsStore.getState().skinMode )
      } )
      .catch( () => setTexState( "error" ) )
  }

  const onJarDrop = ( e: DragEvent ) => {
    e.preventDefault()
    const file = [ ...e.dataTransfer.files ].find( ( f ) => f.name.toLowerCase().endsWith( ".jar" ) )
    if ( ! file ) return
    setTexState( "downloading" )
    setProgress( 50 )
    void file
      .arrayBuffer()
      .then( ( buf ) => extractJar( buf, textureStore ) )
      .then( () => {
        skinTileCache.invalidate()
        setTexState( "ready" )
        setSkinMode( useSettingsStore.getState().skinMode )
      } )
      .catch( () => setTexState( "error" ) )
  }

  return (
    <label className="transport-field" title="Textured note rendering" onDrop={ onJarDrop }>
      skin
      <select value={ skinMode } onChange={ ( e ) => setSkinMode( e.target.value as SkinMode ) }>
        <option value="disabled">disabled</option>
        <option value="activated">activated</option>
        <option value="enabled">enabled</option>
      </select>
      { skinMode !== "disabled" && texState === "missing" && (
        <button
          className="skin-download"
          onClick={ download }
          onDragOver={ ( e ) => e.preventDefault() }
          title="Download block textures from Mojang (~25MB, cached locally). You can also drop a Minecraft client .jar here."
        >
          Get textures
        </button>
      ) }
      { texState === "downloading" && <span className="skin-progress">{ progress }%</span> }
      { texState === "error" && <span className="transport-error">texture load failed</span> }
    </label>
  )
}
