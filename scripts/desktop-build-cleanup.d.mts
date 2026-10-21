import type { DesktopBuildConfig } from "./desktop-build.mjs";

export interface BuildCleanupOptions {
  acquireBuildLock?: (config: DesktopBuildConfig) => Promise<() => Promise<void>>;
  listActiveConfigFiles?: () => Promise<string[]>;
  protectedDirectories?: string[];
  /** Explicitly reviewed verification artifacts, used only for one-off cleanup. */
  extraDirectories?: string[];
  dryRun?: boolean;
  now?: number;
  minimumAgeMs?: number;
  onProgress?: (message: string) => void;
}

export interface BuildCleanupReport {
  removed: { directory: string; bytes: number }[];
  retained: string[];
  failed: { directory: string; reason: string }[];
  reclaimedBytes: number;
  skipped: boolean;
  reason?: string;
}

export function pruneDesktopBuilds(config: DesktopBuildConfig, options?: BuildCleanupOptions): Promise<BuildCleanupReport>;
