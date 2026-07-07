/**
 * Popover for adding/editing a tempo track event, opened from the tempo lane.
 */
import { useState } from 'react';
import { removeTempoEvent, upsertTempoEvent } from '../../state/songActions';
import type { TempoEvent } from '../../core/model/types';

export interface TempoEditorTarget {
  /** Popover position within the piano roll container. */
  x: number;
  y: number;
  tick: number;
  /** Existing event when editing, undefined when adding. */
  event?: TempoEvent;
}

export default function TempoEventEditor({
  target,
  onClose,
}: {
  target: TempoEditorTarget;
  onClose: () => void;
}) {
  const editing = target.event;
  const [type, setType] = useState<TempoEvent['type']>(editing?.type ?? 'bpm');
  const [bpm, setBpm] = useState(editing?.type === 'bpm' ? editing.bpm : 150);
  const [numerator, setNumerator] = useState(
    editing?.type === 'timeSignature' ? editing.numerator : 4,
  );
  const [denominator, setDenominator] = useState(
    editing?.type === 'timeSignature' ? editing.denominator : 4,
  );

  const submit = () => {
    if (type === 'bpm') {
      upsertTempoEvent({ type: 'bpm', tick: target.tick, bpm });
    } else {
      upsertTempoEvent({ type: 'timeSignature', tick: target.tick, numerator, denominator });
    }
    onClose();
  };

  const remove = () => {
    if (editing) removeTempoEvent(editing.type, editing.tick);
    onClose();
  };

  return (
    <div className="tempo-editor" style={{ left: target.x, top: target.y }}>
      <div className="tempo-editor-row">
        <span className="tempo-editor-title">
          {editing ? 'Edit' : 'Add'} @ tick {target.tick}
        </span>
        <button className="tempo-editor-close" onClick={onClose}>
          ×
        </button>
      </div>
      {!editing && (
        <div className="tempo-editor-row">
          <label>
            <input type="radio" checked={type === 'bpm'} onChange={() => setType('bpm')} /> bpm
          </label>
          <label>
            <input
              type="radio"
              checked={type === 'timeSignature'}
              onChange={() => setType('timeSignature')}
            />{' '}
            time sig
          </label>
        </div>
      )}
      {type === 'bpm' ? (
        <div className="tempo-editor-row">
          <label>
            bpm
            <input
              type="number"
              min={1}
              max={999}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
            />
          </label>
        </div>
      ) : (
        <div className="tempo-editor-row">
          <input
            type="number"
            min={1}
            max={32}
            value={numerator}
            onChange={(e) => setNumerator(Number(e.target.value))}
          />
          <span>/</span>
          <select value={denominator} onChange={(e) => setDenominator(Number(e.target.value))}>
            {[1, 2, 4, 8, 16].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="tempo-editor-row">
        <button className="tempo-editor-primary" onClick={submit}>
          {editing ? 'Save' : 'Add'}
        </button>
        {editing && target.tick !== 0 && (
          <button className="tempo-editor-danger" onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
