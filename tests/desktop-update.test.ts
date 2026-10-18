import { describe, expect, it, vi } from "vitest";
import { runDesktopStart, type DesktopConfig, type DesktopState } from "../scripts/desktop-update.mjs";

type Config = DesktopConfig;
type ServiceState = DesktopState & { instanceId?: string };
type Running = {
  status: "ready" | "starting" | "failed" | "unhealthy";
  pid: number;
  instanceId: string;
  buildDirectory: string;
  url: string;
  port: number;
  restoreActive: boolean;
};
type Snapshot = { state: ServiceState | null; running: Running | null };

const oldBuild = ".next-desktop-old";
const newBuild = ".next-desktop-new";
const originalPid = 4100;

function fixture(warm = true) {
  const config: Config = {
    version: 1,
    projectRoot: "C:/synthetic/Serendipity",
    dataDirectory: "C:/synthetic/travel-data",
    runtimeDirectory: "C:/synthetic/travel-data/runtime",
    nodePath: "C:/synthetic/node.exe",
    buildDirectory: oldBuild,
    preferredPort: 3140,
    databaseRequired: true,
    autoBuild: true,
  };
  const disk = { config: { ...config } };
  const events: string[] = [];
  const live = new Set<number>();
  let current: Snapshot = { state: null, running: null };
  let nextPid = originalPid + 1;

  function setService(selected: Config, pid: number, status: Running["status"] | null = "ready", restoreActive = false) {
    live.add(pid);
    const instanceId = `synthetic-instance-${pid}`;
    current = {
      state: { pid, instanceId, projectRoot: selected.projectRoot, dataDirectory: selected.dataDirectory, buildDirectory: selected.buildDirectory },
      running: status === null ? null : {
        pid, instanceId, status, buildDirectory: selected.buildDirectory,
        url: `http://127.0.0.1:${selected.preferredPort}`, port: selected.preferredPort, restoreActive,
      },
    };
    return current;
  }

  if (warm) setService(config, originalPid);

  const ops = {
    inspect: vi.fn(async (): Promise<Snapshot> => ({
      state: current.state && { ...current.state }, running: current.running && { ...current.running },
    })),
    alive: vi.fn((pid: number) => live.has(pid)),
    prepareBuild: vi.fn(async (selected: Config) => {
      events.push("build");
      return { config: { ...selected, buildDirectory: newBuild }, changed: true, fingerprint: "synthetic-source-fingerprint" };
    }),
    readConfig: vi.fn(() => ({ ...disk.config })),
    saveBuild: vi.fn(async (buildDirectory: string) => {
      events.push(`save:${buildDirectory}`);
      disk.config = { ...disk.config, buildDirectory };
    }),
    stopService: vi.fn(async (state: ServiceState) => {
      events.push(`stop:${state.pid}`);
      live.delete(state.pid);
      if (current.state?.instanceId === state.instanceId) current = { state: null, running: null };
    }),
    startService: vi.fn(async (selected: Config): Promise<Running> => {
      events.push(`start:${selected.buildDirectory}`);
      const started = setService(selected, nextPid++).running;
      if (!started) throw new Error("Synthetic ready process missing");
      return started;
    }),
  };

  return { config, disk, events, live, ops, setService };
}

function expectNoSwitch(context: ReturnType<typeof fixture>) {
  expect(context.ops.stopService).not.toHaveBeenCalled();
  expect(context.ops.saveBuild).not.toHaveBeenCalled();
  expect(context.ops.startService).not.toHaveBeenCalled();
}

describe("desktop automatic build updates", () => {
  it("reuses the ready process when the source fingerprint is unchanged", async () => {
    const context = fixture();
    context.ops.prepareBuild.mockImplementation(async (config) => ({ config, changed: false, fingerprint: "unchanged" }));

    const result = await runDesktopStart(context.config, context.ops);

    expect(result).toMatchObject({ status: "ready", pid: originalPid, buildDirectory: oldBuild });
    expect(result.warning).toBeUndefined();
    expect(context.ops.prepareBuild).toHaveBeenCalledTimes(1);
    expectNoSwitch(context);
  });

  it("finishes the build before stopping, persists only the build pointer, and starts with the same data and port", async () => {
    const context = fixture();

    const result = await runDesktopStart(context.config, context.ops);

    expect(context.events).toEqual(["build", `stop:${originalPid}`, `save:${newBuild}`, `start:${newBuild}`]);
    expect(context.ops.stopService).toHaveBeenCalledWith(expect.objectContaining({ pid: originalPid, buildDirectory: oldBuild }));
    expect(context.ops.startService).toHaveBeenCalledWith({ ...context.config, buildDirectory: newBuild });
    expect(context.disk.config).toEqual({ ...context.config, buildDirectory: newBuild });
    expect(result).toMatchObject({ status: "ready", buildDirectory: newBuild, port: context.config.preferredPort });
    expect(result.pid).not.toBe(originalPid);
  });

  it("a subsequent start reads the selected build and reuses the updated process", async () => {
    const context = fixture();
    const first = await runDesktopStart(context.config, context.ops);
    context.ops.prepareBuild.mockImplementation(async (config) => ({ config, changed: false, fingerprint: "unchanged" }));

    const second = await runDesktopStart(context.ops.readConfig(), context.ops);

    expect(second.pid).toBe(first.pid);
    expect(second.buildDirectory).toBe(newBuild);
    expect(context.ops.stopService).toHaveBeenCalledTimes(1);
    expect(context.ops.saveBuild).toHaveBeenCalledTimes(1);
    expect(context.ops.startService).toHaveBeenCalledTimes(1);
  });

  it("keeps the old healthy process and warns when the build fails", async () => {
    const context = fixture();
    context.ops.prepareBuild.mockRejectedValue(new Error("Synthetic compilation failed"));

    const result = await runDesktopStart(context.config, context.ops);

    expect(result).toMatchObject({ status: "ready", pid: originalPid, buildDirectory: oldBuild });
    expect(result.warning).toEqual(expect.any(String));
    expect(result.warning?.length).toBeGreaterThan(0);
    expect(context.disk.config).toEqual(context.config);
    expectNoSwitch(context);
  });

  it("starts the saved build with a warning when a cold build fails", async () => {
    const context = fixture(false);
    context.ops.prepareBuild.mockRejectedValue(new Error("Synthetic compilation failed"));

    const result = await runDesktopStart(context.config, context.ops);

    expect(result).toMatchObject({ status: "ready", buildDirectory: oldBuild });
    expect(result.warning).toEqual(expect.any(String));
    expect(context.ops.startService).toHaveBeenCalledExactlyOnceWith(context.config);
    expect(context.ops.stopService).not.toHaveBeenCalled();
    expect(context.ops.saveBuild).not.toHaveBeenCalled();
  });

  it("defers switching when a restore begins while the candidate is building", async () => {
    const context = fixture();
    context.ops.prepareBuild.mockImplementation(async (config) => {
      context.events.push("build");
      context.setService(config, originalPid, "ready", true);
      return { config: { ...config, buildDirectory: newBuild }, changed: true, fingerprint: "changed" };
    });

    const result = await runDesktopStart(context.config, context.ops);

    expect(context.ops.inspect.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result).toMatchObject({ pid: originalPid, buildDirectory: oldBuild, restoreActive: true });
    expect(result.warning).toEqual(expect.any(String));
    expectNoSwitch(context);
  });

  it("rejects a ready process belonging to another project", async () => {
    const context = fixture();
    context.setService({ ...context.config, projectRoot: "C:/synthetic/other-project" }, originalPid);

    await expect(runDesktopStart(context.config, context.ops)).rejects.toThrow();

    expect(context.ops.prepareBuild).not.toHaveBeenCalled();
    expectNoSwitch(context);
  });

  it("rejects an existing live process whose authenticated control is unavailable", async () => {
    const context = fixture();
    context.setService(context.config, originalPid, null);

    await expect(runDesktopStart(context.config, context.ops)).rejects.toThrow();

    expect(context.ops.prepareBuild).not.toHaveBeenCalled();
    expectNoSwitch(context);
  });

  it.each([
    { dataDirectory: "C:/synthetic/different-data" },
    { buildDirectory: ".next-desktop-external-selection" },
  ])("rejects a config change during the build before touching the old process: %j", async (change) => {
    const context = fixture();
    context.ops.prepareBuild.mockImplementation(async (config) => {
      context.disk.config = { ...context.disk.config, ...change };
      return { config: { ...config, buildDirectory: newBuild }, changed: true, fingerprint: "changed" };
    });

    await expect(runDesktopStart(context.config, context.ops)).rejects.toThrow();

    expectNoSwitch(context);
    expect(context.disk.config).toEqual({ ...context.config, ...change });
  });

  it("restores the saved pointer and starts the old build after the candidate exits on startup failure", async () => {
    const context = fixture();
    context.ops.startService.mockImplementationOnce(async (config) => {
      context.events.push(`start:${config.buildDirectory}`);
      context.setService(config, 4200, null);
      context.live.delete(4200);
      throw new Error("Synthetic candidate exited");
    });

    const result = await runDesktopStart(context.config, context.ops);

    expect(context.events).toEqual([
      "build", `stop:${originalPid}`, `save:${newBuild}`, `start:${newBuild}`, `save:${oldBuild}`, `start:${oldBuild}`,
    ]);
    expect(result).toMatchObject({ status: "ready", buildDirectory: oldBuild });
    expect(result.warning).toEqual(expect.any(String));
    expect(context.disk.config).toEqual(context.config);
    expect(context.ops.startService.mock.calls.map(([config]) => config.buildDirectory)).toEqual([newBuild, oldBuild]);
  });

  it("authenticates and stops a live failed candidate before restarting the old build", async () => {
    const context = fixture();
    context.ops.startService.mockImplementationOnce(async (config) => {
      context.events.push(`start:${config.buildDirectory}`);
      context.setService(config, 4200, "failed");
      throw new Error("Synthetic candidate failed health check");
    });

    const result = await runDesktopStart(context.config, context.ops);

    expect(context.events).toEqual([
      "build", `stop:${originalPid}`, `save:${newBuild}`, `start:${newBuild}`, "stop:4200", `save:${oldBuild}`, `start:${oldBuild}`,
    ]);
    expect(context.ops.stopService).toHaveBeenLastCalledWith(expect.objectContaining({ pid: 4200, buildDirectory: newBuild }));
    expect(result).toMatchObject({ status: "ready", buildDirectory: oldBuild });
    expect(result.warning).toEqual(expect.any(String));
  });

  it("does not start another process when a timed-out candidate is alive and cannot authenticate", async () => {
    const context = fixture();
    context.ops.startService.mockImplementationOnce(async (config) => {
      context.events.push(`start:${config.buildDirectory}`);
      context.setService(config, 4200, null);
      throw new Error("Synthetic startup timeout");
    });

    await expect(runDesktopStart(context.config, context.ops)).rejects.toThrow();

    expect(context.live.has(4200)).toBe(true);
    expect(context.ops.startService).toHaveBeenCalledTimes(1);
    expect(context.ops.startService).toHaveBeenCalledWith({ ...context.config, buildDirectory: newBuild });
    expect(context.ops.stopService).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pid: originalPid }));
  });

  it("does not roll back when a spawned candidate is alive before its state file is available", async () => {
    const context = fixture();
    context.ops.startService.mockImplementationOnce(async (config) => {
      context.events.push(`start:${config.buildDirectory}`);
      context.live.add(222);
      throw Object.assign(new Error("Synthetic timeout before service state was written"), { candidatePid: 222 });
    });

    await expect(runDesktopStart(context.config, context.ops)).rejects.toThrow();

    expect(await context.ops.inspect()).toEqual({ state: null, running: null });
    expect(context.live.has(222)).toBe(true);
    expect(context.ops.startService).toHaveBeenCalledTimes(1);
    expect(context.ops.saveBuild).toHaveBeenCalledExactlyOnceWith(newBuild);
    expect(context.disk.config.buildDirectory).toBe(newBuild);
    expect(context.events).toEqual(["build", `stop:${originalPid}`, `save:${newBuild}`, `start:${newBuild}`]);
  });

  it("starts a pinned config directly without preparing a build", async () => {
    const context = fixture(false);
    context.config.autoBuild = false;
    context.disk.config.autoBuild = false;

    const result = await runDesktopStart(context.config, context.ops);

    expect(result).toMatchObject({ status: "ready", buildDirectory: oldBuild });
    expect(context.ops.prepareBuild).not.toHaveBeenCalled();
    expect(context.ops.startService).toHaveBeenCalledExactlyOnceWith(context.config);
    expect(context.ops.saveBuild).not.toHaveBeenCalled();
  });
});
