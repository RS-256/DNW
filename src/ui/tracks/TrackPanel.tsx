/**
 * Track (layer) list: add/remove/reorder/rename tracks, set the active track,
 * and control per-track color / volume / mute / solo. Row order = priority
 * order used by the onion-skin overlay.
 */
import { useState } from 'react';
import type { DragEvent } from 'react';
import { useEditorStore } from '../../state/editorStore';
import {
  addLayer,
  moveLayer,
  removeLayer,
  renameLayer,
  setLayerProps,
} from '../../state/songActions';
import { useSongStore } from '../../state/songStore';

export default function TrackPanel() {
  const layers = useSongStore((s) => s.song.layers);
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const [editing, setEditing] = useState<{ index: number; name: string } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== to) moveLayer(dragIndex, to);
    setDragIndex(null);
  };

  return (
    <aside className="track-panel">
      <div className="track-panel-head">
        <span>Tracks</span>
        <button className="track-add" onClick={addLayer} title="Add track">
          +
        </button>
      </div>
      <div className="track-list">
        {layers.map((layer, i) => (
          <div
            key={layer.id}
            className={`track-row${i === activeLayer ? ' active' : ''}`}
            onClick={() => setActiveLayer(i)}
            draggable={editing?.index !== i}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, i)}
          >
            <input
              className="track-color"
              type="color"
              value={layer.color}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setLayerProps(i, { color: e.target.value })}
              title="Track color"
            />
            {editing?.index === i ? (
              <input
                className="track-name-input"
                value={editing.name}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditing({ index: i, name: e.target.value })}
                onBlur={() => {
                  renameLayer(i, editing.name || layer.name);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span
                className="track-name"
                onDoubleClick={() => setEditing({ index: i, name: layer.name })}
                title="Double-click to rename"
              >
                {layer.name}
              </span>
            )}
            <button
              className={`track-toggle${layer.muted ? ' on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setLayerProps(i, { muted: !layer.muted });
              }}
              title="Mute"
            >
              M
            </button>
            <button
              className={`track-toggle solo${layer.solo ? ' on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setLayerProps(i, { solo: !layer.solo });
              }}
              title="Solo"
            >
              S
            </button>
            <input
              className="track-volume"
              type="range"
              min={0}
              max={100}
              value={layer.volume}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setLayerProps(i, { volume: Number(e.target.value) })}
              title={`Volume ${layer.volume}`}
            />
            <button
              className="track-remove"
              onClick={(e) => {
                e.stopPropagation();
                removeLayer(i);
              }}
              disabled={layers.length <= 1}
              title="Remove track"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
