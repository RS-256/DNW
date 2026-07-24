/** Shared file-type filters for open/save dialogs. */
import type { FileTypeFilter } from "./PlatformAdapter"

// Note: the File System Access API rejects multi-dot extensions like
// '.dnw.json', so the filter uses '.json'; suggested names still end in
// '.dnw.json'.
export const PROJECT_FILTER: FileTypeFilter = {
  description: "DNW project",
  extensions: [ ".json" ],
  mime: "application/json"
}

export const NBS_FILTER: FileTypeFilter = {
  description: "Note Block Studio song",
  extensions: [ ".nbs" ],
  mime: "application/octet-stream"
}

export const MIDI_FILTER: FileTypeFilter = {
  description: "Standard MIDI file",
  extensions: [ ".mid", ".midi" ],
  mime: "audio/midi"
}
