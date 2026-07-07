/**
 * Track (layer) list: add/remove/reorder/rename tracks, set the active track,
 * per-track color / volume / mute / solo, and track groups (folders with
 * group-level collapse / mute / solo / volume).
 *
 * Row order = priority order used by the onion-skin overlay. Group members
 * are contiguous; dragging a track's grip onto a group header joins the
 * group, dropping on any row adopts that row's group (or ungroups).
 */
import { useState } from 'react';
import type { DragEvent } from 'react';
import type { Layer, TrackGroup } from '../../core/model/types';
import ConfirmDialog from '../common/ConfirmDialog';
import { useEditorStore } from '../../state/editorStore';
import {
  addLayer,
  createGroupWithActiveLayer,
  deleteGroup,
  groupJoinIndex,
  moveLayer,
  removeLayer,
  renameLayer,
  setGroupProps,
  setLayerProps,
} from '../../state/songActions';
import { useSongStore } from '../../state/songStore';

type DisplayItem =
  | { type: 'group'; group: TrackGroup }
  | { type: 'layer'; layer: Layer; index: number; grouped: boolean };

function buildDisplayList(layers: Layer[], groups: TrackGroup[]): DisplayItem[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const items: DisplayItem[] = [];
  let prevGroupId: string | undefined;
  layers.forEach((layer, index) => {
    const group = layer.groupId ? byId.get(layer.groupId) : undefined;
    if (group && layer.groupId !== prevGroupId) items.push({ type: 'group', group });
    if (!group?.collapsed) items.push({ type: 'layer', layer, index, grouped: !!group });
    prevGroupId = layer.groupId;
  });
  return items;
}

export default function TrackPanel() {
  const layers = useSongStore((s) => s.song.layers);
  const groups = useSongStore((s) => s.song.groups);
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const [editing, setEditing] = useState<{ kind: 'layer' | 'group'; id: string; name: string } | null>(
    null,
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ index: number; layer: Layer } | null>(null);

  const dropOnLayer = (e: DragEvent, item: Extract<DisplayItem, { type: 'layer' }>) => {
    e.preventDefault();
    if (dragIndex !== null) moveLayer(dragIndex, item.index, item.layer.groupId);
    setDragIndex(null);
  };

  const dropOnGroup = (e: DragEvent, group: TrackGroup) => {
    e.preventDefault();
    if (dragIndex !== null) moveLayer(dragIndex, groupJoinIndex(group.id, dragIndex), group.id);
    setDragIndex(null);
  };

  const renderGroupRow = (group: TrackGroup) => (
    <div
      key={group.id}
      className="group-row"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => dropOnGroup(e, group)}
    >
      <button
        className="group-collapse"
        onClick={() => setGroupProps(group.id, { collapsed: !group.collapsed })}
        title={group.collapsed ? 'Expand' : 'Collapse'}
      >
        {group.collapsed ? '▸' : '▾'}
      </button>
      {editing?.kind === 'group' && editing.id === group.id ? (
        <input
          className="track-name-input"
          value={editing.name}
          autoFocus
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          onBlur={() => {
            setGroupProps(group.id, { name: editing.name || group.name });
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(null);
          }}
        />
      ) : (
        <span
          className="group-name"
          onDoubleClick={() => setEditing({ kind: 'group', id: group.id, name: group.name })}
          title="Double-click to rename. Drop a track here to add it to the group."
        >
          {group.name}
        </span>
      )}
      <button
        className={`track-toggle${group.muted ? ' on' : ''}`}
        onClick={() => setGroupProps(group.id, { muted: !group.muted })}
        title="Mute group"
      >
        M
      </button>
      <button
        className={`track-toggle solo${group.solo ? ' on' : ''}`}
        onClick={() => setGroupProps(group.id, { solo: !group.solo })}
        title="Solo group"
      >
        S
      </button>
      <input
        className="track-volume"
        type="range"
        min={0}
        max={100}
        value={group.volume}
        onChange={(e) => setGroupProps(group.id, { volume: Number(e.target.value) })}
        title={`Group volume ${group.volume} (multiplies member volumes)`}
      />
      <button
        className="track-remove"
        onClick={() => deleteGroup(group.id)}
        title="Ungroup (tracks are kept)"
      >
        ×
      </button>
    </div>
  );

  const renderLayerRow = (item: Extract<DisplayItem, { type: 'layer' }>) => {
    const { layer, index, grouped } = item;
    return (
      <div
        key={layer.id}
        className={`track-row${index === activeLayer ? ' active' : ''}${grouped ? ' grouped' : ''}`}
        onClick={() => setActiveLayer(index)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => dropOnLayer(e, item)}
      >
        <span
          className="track-grip"
          draggable
          onDragStart={() => setDragIndex(index)}
          title="Drag to reorder / into a group"
        >
          ⋮⋮
        </span>
        <input
          className="track-color"
          type="color"
          value={layer.color}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setLayerProps(index, { color: e.target.value })}
          title="Track color"
        />
        {editing?.kind === 'layer' && editing.id === layer.id ? (
          <input
            className="track-name-input"
            value={editing.name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onBlur={() => {
              renameLayer(index, editing.name || layer.name);
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
            onDoubleClick={() => setEditing({ kind: 'layer', id: layer.id, name: layer.name })}
            title="Double-click to rename"
          >
            {layer.name}
          </span>
        )}
        <button
          className={`track-toggle${layer.muted ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setLayerProps(index, { muted: !layer.muted });
          }}
          title="Mute"
        >
          M
        </button>
        <button
          className={`track-toggle solo${layer.solo ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setLayerProps(index, { solo: !layer.solo });
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
          onChange={(e) => setLayerProps(index, { volume: Number(e.target.value) })}
          title={`Volume ${layer.volume}`}
        />
        <button
          className="track-remove"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete({ index, layer });
          }}
          disabled={layers.length <= 1}
          title="Remove track"
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <aside className="track-panel">
      <div className="track-panel-head">
        <span>Tracks</span>
        <div className="track-panel-buttons">
          <button
            className="track-add group"
            onClick={createGroupWithActiveLayer}
            title="Create a group containing the active track"
          >
            +G
          </button>
          <button className="track-add" onClick={addLayer} title="Add track">
            +
          </button>
        </div>
      </div>
      <div className="track-list">
        {buildDisplayList(layers, groups).map((item) =>
          item.type === 'group' ? renderGroupRow(item.group) : renderLayerRow(item),
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete track"
          message={`Delete "${confirmDelete.layer.name}"${
            confirmDelete.layer.notes.length > 0
              ? ` and its ${confirmDelete.layer.notes.length} note${
                  confirmDelete.layer.notes.length > 1 ? 's' : ''
                }`
              : ''
          }? This can be undone with Ctrl+Z.`}
          onConfirm={() => {
            removeLayer(confirmDelete.index);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </aside>
  );
}
