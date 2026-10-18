export interface DesktopBuildConfig {
  projectRoot: string;
  dataDirectory: string;
  runtimeDirectory?: string;
  nodePath: string;
  buildDirectory: string;
  autoBuild?: boolean;
}

export interface DesktopBuildRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: true;
  stdio: ["ignore", number, number];
  logPath: string;
}

export interface DesktopBuildOptions {
  executor?: (request: DesktopBuildRequest) => Promise<void>;
  acquireBuildLock?: (config: DesktopBuildConfig, timeout: number) => Promise<() => Promise<void>>;
  lockTimeoutMs?: number;
}

export function prepareDesktopBuild<T extends DesktopBuildConfig>(config: T, options?: DesktopBuildOptions): Promise<{
  config: T;
  changed: boolean;
  fingerprint: string;
}>;
