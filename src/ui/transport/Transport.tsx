import { usePlaybackStore } from '../../state/playbackStore';
import { useSongStore } from '../../state/songStore';
import { setInitialBpm, setTickPerQuarter } from '../../state/songActions';
import { bpmToTps } from '../../core/model/tempoMap';
import type { BpmEvent } from '../../core/model/types';

export default function Transport() {
  const playing = usePlaybackStore((s) => s.playing);
  const loadError = usePlaybackStore((s) => s.loadError);
  const toggle = usePlaybackStore((s) => s.toggle);
  const playFromStart = usePlaybackStore((s) => s.playFromStart);

  const bpm = useSongStore(
    (s) =>
      (s.song.tempoTrack.events.find((e) => e.type === 'bpm' && e.tick === 0) as BpmEvent).bpm,
  );
  const tickPerQuarter = useSongStore((s) => s.song.tickPerQuarter);
  const canUndo = useSongStore((s) => s.canUndo);
  const canRedo = useSongStore((s) => s.canRedo);
  const undo = useSongStore((s) => s.undo);
  const redo = useSongStore((s) => s.redo);

  return (
    <div className="transport">
      <button
        className="transport-btn"
        onClick={playFromStart}
        title="Play from the beginning (ignores the parked playhead)"
      >
        ⏮
      </button>
      <button
        className="transport-play"
        onClick={toggle}
        title="Play from the playhead / Stop (Space). Middle-click the roll to move the playhead."
      >
        {playing ? '■' : '▶'}
      </button>
      <button className="transport-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        ↩
      </button>
      <button className="transport-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
        ↪
      </button>
      <label className="transport-field">
        bpm
        <input
          type="number"
          min={1}
          max={999}
          value={bpm}
          onChange={(e) => setInitialBpm(Number(e.target.value))}
        />
      </label>
      <label className="transport-field" title="Game ticks per quarter note (infinote's bpm unit)">
        gt/quarter
        <input
          type="number"
          min={1}
          max={32}
          value={tickPerQuarter}
          onChange={(e) => setTickPerQuarter(Number(e.target.value))}
        />
      </label>
      <span className="transport-tps">{bpmToTps(bpm, tickPerQuarter).toFixed(2)} tps</span>
      {loadError && <span className="transport-error">{loadError}</span>}
    </div>
  );
}
