/** Display settings, persisted to localStorage. */
import { create } from "zustand"

export type SkinMode = "disabled" | "activated" | "enabled"

const SKIN_KEY = "dnw.skinMode"

export interface SettingsState {
  /**
   * Textured note rendering:
   * disabled = flat everywhere, activated = active track only, enabled = all tracks.
   */
  skinMode: SkinMode
  setSkinMode: ( mode: SkinMode ) => void
}

function initialSkinMode(): SkinMode {
  if ( typeof localStorage === "undefined" ) return "disabled"
  const v = localStorage.getItem( SKIN_KEY )
  return v === "activated" || v === "enabled" ? v : "disabled"
}

export const useSettingsStore = create< SettingsState >()( ( set ) => ( {
  skinMode: initialSkinMode(),
  setSkinMode: ( mode ) => {
    localStorage.setItem( SKIN_KEY, mode )
    set( { skinMode: mode } )
  }
} ) )
