/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL for vanilla note block samples. Defaults to the jsDelivr-hosted
   * community mirror (InventivetalentDev/minecraft-assets), which sends CORS
   * headers. Override to pin a version or self-host.
   */
  readonly VITE_MC_SOUND_BASE?: string;
  /**
   * Host for the Minecraft client jar (piston-data.mojang.com by default). That
   * host sends `Access-Control-Allow-Origin: *`, so it is fetched directly;
   * override only if a proxy is required.
   */
  readonly VITE_MC_DATA_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
