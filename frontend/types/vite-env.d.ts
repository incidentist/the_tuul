/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Custom prefixed variables
  readonly TUUL_API_HOSTNAME: string;
  readonly TUUL_USE_REMOTE_SEPARATION: string;
  readonly TUUL_DONATE_URL: string;

  // Built-in Vite variables (these don't change)
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}