export type DesktopConfig = {
  version?: number;
  projectRoot: string;
  dataDirectory: string;
  runtimeDirectory: string;
  nodePath: string;
  buildDirectory: string;
  preferredPort: number;
  autoBuild?: boolean;
  databaseRequired?: boolean;
};
export type DesktopState = {
  pid: number;
  projectRoot: string;
  dataDirectory: string;
  buildDirectory: string;
};
export type DesktopStatus = {
  status: string;
  pid: number;
  buildDirectory: string;
  restoreActive?: boolean;
  url?: string;
  warning?: string;
};
export type DesktopOperations = {
  inspect(): Promise<{ state: DesktopState | null; running: DesktopStatus | null }>;
  alive(pid: number): boolean;
  prepareBuild(config: DesktopConfig): Promise<{ config: DesktopConfig; changed: boolean; fingerprint?: string }>;
  readConfig(): DesktopConfig | Promise<DesktopConfig>;
  saveBuild(buildDirectory: string): void | Promise<void>;
  stopService(state: DesktopState): Promise<void>;
  startService(config: DesktopConfig): Promise<DesktopStatus>;
};
export function runDesktopStart(config: DesktopConfig, ops: DesktopOperations): Promise<DesktopStatus>;
