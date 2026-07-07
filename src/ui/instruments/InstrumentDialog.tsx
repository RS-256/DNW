/**
 * Instrument manager: import .ogg samples as custom instruments and edit
 * their properties (base pitch, volume, infinote sound id, base block).
 */
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { DEFAULT_PITCH_KEY, newId } from '../../core/model/song';
import { putSound } from '../../state/persistence';
import { usePlaybackStore } from '../../state/playbackStore';
import { addCustomInstrument, removeInstrument, updateInstrument } from '../../state/songActions';
import { useSongStore } from '../../state/songStore';
import { keyName } from '../pianoroll/render';

async function importOggFiles(files: FileList | File[]): Promise<void> {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.ogg')) continue;
    const soundSourceId = newId('sound');
    await putSound(soundSourceId, await file.arrayBuffer());
    addCustomInstrument(file.name.replace(/\.ogg$/i, ''), soundSourceId);
  }
}

export default function InstrumentDialog({ onClose }: { onClose: () => void }) {
  const instruments = useSongStore((s) => s.song.instruments);
  const previewNote = usePlaybackStore((s) => s.previewNote);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void importOggFiles(e.dataTransfer.files);
  };

  const customs = instruments
    .map((inst, index) => ({ inst, index }))
    .filter(({ inst }) => !inst.isVanilla);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span>Instruments</span>
          <button className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div
          className={`inst-dropzone${dragOver ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
        >
          Drop .ogg files here (or click to browse)
          <input
            ref={fileInput}
            type="file"
            accept=".ogg"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void importOggFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {customs.length === 0 ? (
          <p className="inst-empty">No custom instruments yet.</p>
        ) : (
          <table className="inst-table">
            <thead>
              <tr>
                <th>name</th>
                <th title="Key at which the sample plays unshifted">base key</th>
                <th>vol</th>
                <th title="infinote sound id (namespace:path)">sound id</th>
                <th title="Block under the note block (skin border)">base block</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customs.map(({ inst, index }) => (
                <tr key={inst.id}>
                  <td>
                    <input
                      value={inst.name}
                      onChange={(e) => updateInstrument(index, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={87}
                      value={inst.pitchKey}
                      onChange={(e) =>
                        updateInstrument(index, {
                          pitchKey: Number(e.target.value) || DEFAULT_PITCH_KEY,
                        })
                      }
                      title={keyName(inst.pitchKey)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={inst.volume}
                      onChange={(e) => updateInstrument(index, { volume: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      placeholder="namespace:path"
                      value={inst.soundId ?? ''}
                      onChange={(e) =>
                        updateInstrument(index, { soundId: e.target.value || undefined })
                      }
                    />
                  </td>
                  <td>
                    <input
                      placeholder="minecraft:stone"
                      value={inst.baseBlock ?? ''}
                      onChange={(e) =>
                        updateInstrument(index, { baseBlock: e.target.value || undefined })
                      }
                    />
                  </td>
                  <td className="inst-actions">
                    <button
                      onClick={() =>
                        previewNote({
                          instrument: index,
                          key: inst.pitchKey,
                          velocity: 100,
                          pan: 0,
                          pitch: 0,
                        })
                      }
                      title="Preview"
                    >
                      ▶
                    </button>
                    <button
                      onClick={() => removeInstrument(index)}
                      title="Remove (notes fall back to harp)"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
