import { useEffect, useState } from "react"
import InstrumentDialog from "./ui/instruments/InstrumentDialog"
import FileMenu from "./ui/layout/FileMenu"
import PianoRoll from "./ui/pianoroll/PianoRoll"
import NotePanel from "./ui/panels/NotePanel"
import TrackPanel from "./ui/tracks/TrackPanel"
import InstrumentSelect from "./ui/transport/InstrumentSelect"
import SkinControl from "./ui/transport/SkinControl"
import Transport from "./ui/transport/Transport"
import { useEditorStore } from "./state/editorStore"
import { loadAutosave, startAutosave } from "./state/persistence"
import { usePlaybackStore } from "./state/playbackStore"
import * as actions from "./state/songActions"
import { useSongStore } from "./state/songStore"

let restoredAutosave = false

function isTypingTarget( target: EventTarget | null ): boolean {
  const el = target as HTMLElement | null
  return !! el && [ "INPUT", "TEXTAREA", "SELECT" ].includes( el.tagName )
}

export default function App() {
  const [ showInstruments, setShowInstruments ] = useState( false )

  useEffect( () => {
    if ( ! restoredAutosave ) {
      restoredAutosave = true
      void loadAutosave().then( ( song ) => {
        if ( song ) useSongStore.getState().replaceSong( song )
      } )
    }
    return startAutosave()
  }, [] )

  useEffect( () => {
    const onKeyDown = ( e: KeyboardEvent ) => {
      if ( isTypingTarget( e.target ) ) return

      if ( e.code === "Space" ) {
        e.preventDefault()
        usePlaybackStore.getState().toggle()
        return
      }
      if ( e.key === "Delete" || e.key === "Backspace" ) {
        e.preventDefault()
        actions.deleteSelection()
        return
      }
      if ( e.key === "Escape" ) {
        useEditorStore.getState().clearSelection()
        return
      }
      if ( ! ( e.ctrlKey || e.metaKey ) ) return
      const key = e.key.toLowerCase()
      if ( key === "z" && e.shiftKey ) useSongStore.getState().redo()
      else if ( key === "z" ) useSongStore.getState().undo()
      else if ( key === "y" ) useSongStore.getState().redo()
      else if ( key === "a" ) actions.selectAll()
      else if ( key === "c" ) actions.copySelection()
      else if ( key === "x" ) actions.cutSelection()
      else if ( key === "v" ) actions.pasteClipboard()
      else return
      e.preventDefault()
    }
    window.addEventListener( "keydown", onKeyDown )
    return () => window.removeEventListener( "keydown", onKeyDown )
  }, [] )

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">DNW</span>
        <FileMenu />
        <Transport />
        <InstrumentSelect />
        <SkinControl />
        <button className="header-btn" onClick={ () => setShowInstruments( true ) }>
          Instruments…
        </button>
      </header>
      <main className="app-main">
        <TrackPanel />
        <PianoRoll />
        <NotePanel />
      </main>
      { showInstruments && <InstrumentDialog onClose={ () => setShowInstruments( false ) } /> }
    </div>
  )
}
