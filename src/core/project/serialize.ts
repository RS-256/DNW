/**
 * Native project format (.dnw.json): a JSON envelope around the Song model.
 * Holds everything NBS cannot (track colors, tempo track, infinote sound
 * ids, custom-instrument references). Sample binaries live in IndexedDB and
 * are referenced by Instrument.soundSourceId.
 */
import { createNote, newId } from '../model/song';
import type { Song } from '../model/types';

export const PROJECT_FORMAT = 'dnw';
export const PROJECT_VERSION = 1;

interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  song: Song;
}

export function serializeProject(song: Song): string {
  const file: ProjectFile = { format: PROJECT_FORMAT, version: PROJECT_VERSION, song };
  return JSON.stringify(file, null, 2);
}

export function deserializeProject(json: string): Song {
  const parsed = JSON.parse(json) as Partial<ProjectFile>;
  if (parsed.format !== PROJECT_FORMAT || typeof parsed.version !== 'number' || !parsed.song) {
    throw new Error('Not a DNW project file');
  }
  if (parsed.version > PROJECT_VERSION) {
    throw new Error(`Project version ${parsed.version} is newer than this app supports`);
  }
  const song = parsed.song;
  // Defensive fixups for hand-edited files.
  if (!song.tempoTrack?.events?.some((e) => e.type === 'bpm' && e.tick === 0)) {
    throw new Error('Project is missing the initial bpm event');
  }
  for (const layer of song.layers) {
    layer.notes = layer.notes.map((n) => (n.id ? n : createNote({ ...n })));
    layer.notes.sort((a, b) => a.tick - b.tick);
    if (!layer.id) layer.id = newId('layer');
  }
  return song;
}
