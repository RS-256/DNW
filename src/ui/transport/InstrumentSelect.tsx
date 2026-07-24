/** Dropdown choosing the instrument used for newly placed notes. */
import { useEditorStore } from "../../state/editorStore"
import { useSongStore } from "../../state/songStore"

export default function InstrumentSelect() {
  const instruments = useSongStore( ( s ) => s.song.instruments )
  const currentInstrument = useEditorStore( ( s ) => s.currentInstrument )
  const setCurrentInstrument = useEditorStore( ( s ) => s.setCurrentInstrument )

  return (
    <label className="transport-field" title="Instrument for new notes">
      inst
      <select
        value={ Math.min( currentInstrument, instruments.length - 1 ) }
        onChange={ ( e ) => setCurrentInstrument( Number( e.target.value ) ) }
      >
        { instruments.map( ( inst, i ) => (
          <option key={ inst.id } value={ i }>
            { inst.name }
          </option>
        ) ) }
      </select>
    </label>
  )
}
