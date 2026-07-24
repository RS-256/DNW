/**
 * Properties panel for the selected notes (velocity / pan / fine pitch).
 * Shows the first selected note's values; edits apply to the whole selection.
 */
import { useEditorStore } from "../../state/editorStore"
import {
  copySelection,
  deleteSelection,
  fadeSelection,
  moveSelectionToLayer,
  setSelectedNoteProps
} from "../../state/songActions"
import { useSongStore } from "../../state/songStore"

export default function NotePanel() {
  const selection = useEditorStore( ( s ) => s.selection )
  const activeLayer = useEditorStore( ( s ) => s.activeLayer )
  const song = useSongStore( ( s ) => s.song )

  if ( selection.size === 0 ) return null
  const layer = song.layers[ activeLayer ]
  const note = layer?.notes.find( ( n ) => selection.has( n.id ) )
  if ( ! note ) return null

  return (
    <aside className="note-panel">
      <div className="note-panel-title">
        { selection.size } note{ selection.size > 1 ? "s" : "" } selected
      </div>

      <div className="note-panel-actions">
        <button onClick={ copySelection } title="Copy (Ctrl+C)">
          Copy
        </button>
        <button onClick={ deleteSelection } title="Delete (Del)">
          Delete
        </button>
        <button onClick={ () => fadeSelection( "in" ) } title="Velocity ramp from 0% up to current over the selection">
          Fade in
        </button>
        <button
          onClick={ () => fadeSelection( "out" ) }
          title="Velocity ramp from current down to 0% over the selection"
        >
          Fade out
        </button>
      </div>

      <label className="note-panel-field">
        <span>
          velocity <b>{ note.velocity }</b>
        </span>
        <input
          type="range"
          min={ 0 }
          max={ 100 }
          value={ note.velocity }
          onChange={ ( e ) => setSelectedNoteProps( { velocity: Number( e.target.value ) } ) }
        />
      </label>

      <label className="note-panel-field">
        <span>
          pan <b>{ note.pan.toFixed( 2 ) }</b>
        </span>
        <input
          type="range"
          min={ -100 }
          max={ 100 }
          value={ Math.round( note.pan * 100 ) }
          onChange={ ( e ) => setSelectedNoteProps( { pan: Number( e.target.value ) / 100 } ) }
        />
      </label>

      <label className="note-panel-field">
        <span>fine pitch (cents)</span>
        <input
          type="number"
          min={ -1200 }
          max={ 1200 }
          step={ 5 }
          value={ note.pitch }
          onChange={ ( e ) => setSelectedNoteProps( { pitch: Number( e.target.value ) } ) }
        />
      </label>

      <label className="note-panel-field">
        <span>instrument</span>
        <select
          value={ note.instrument }
          onChange={ ( e ) => setSelectedNoteProps( { instrument: Number( e.target.value ) } ) }
        >
          { song.instruments.map( ( inst, i ) => (
            <option key={ inst.id } value={ i }>
              { inst.name }
            </option>
          ) ) }
        </select>
      </label>

      { song.layers.length > 1 && (
        <label className="note-panel-field">
          <span>move to track</span>
          <select value={ activeLayer } onChange={ ( e ) => moveSelectionToLayer( Number( e.target.value ) ) }>
            { song.layers.map( ( l, i ) => (
              <option key={ l.id } value={ i }>
                { l.name }
              </option>
            ) ) }
          </select>
        </label>
      ) }
    </aside>
  )
}
