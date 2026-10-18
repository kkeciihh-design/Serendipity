// The caller holds the instance operation lock for this entire transaction.
function sameOwner(config, state) {
  return state.projectRoot === config.projectRoot && state.dataDirectory === config.dataDirectory;
}

function configIdentity(config) {
  return JSON.stringify(Object.keys(config).filter((key) => key !== "runtimeDirectory").sort().map((key) => [key, config[key]]));
}

function checkService(config, current, alive) {
  if (current.state && !sameOwner(config, current.state) && (current.running || alive(current.state.pid))) {
    throw new Error("该数据目录已有另一个项目在运行，无法自动切换。请先通过原入口停止。");
  }
  if (!current.running && current.state && alive(current.state.pid)) {
    throw new Error("已有后台进程未响应。请查看运行状态；不会再开第二个实例。");
  }
}

function ready(result, warning) {
  if (result?.status !== "ready") throw new Error("应用还未就绪，请查看运行状态；不会打开错误的网页。");
  return warning ? { ...result, warning } : result;
}

export async function runDesktopStart(config, ops) {
  let current = await ops.inspect();
  checkService(config, current, ops.alive);
  if (current.running && current.state.buildDirectory !== config.buildDirectory) {
    throw new Error("该数据目录已有另一版本在运行。请先点击停止，再用当前入口启动。");
  }
  if (config.autoBuild !== true) {
    return ready(current.running ?? await ops.startService(config));
  }

  let prepared;
  let warning;
  try {
    prepared = await ops.prepareBuild(config);
  } catch (error) {
    warning = `本次更新未完成，继续使用原版本。${error.message}`;
    prepared = { config, changed: false };
  }

  // Builds take time. Do not overwrite a newer configuration or interrupt a
  // restore that started while compiling. Inspect the authenticated service again.
  if (configIdentity(await ops.readConfig()) !== configIdentity(config)) {
    throw new Error("启动配置在检查更新期间发生变化，请重新点击启动；未切换正在运行的版本。");
  }
  current = await ops.inspect();
  checkService(config, current, ops.alive);
  const target = prepared.config;
  const needsRestart = current.running && current.state.buildDirectory !== target.buildDirectory;
  if (current.running?.restoreActive && (prepared.changed || needsRestart)) {
    return ready(current.running, "旅行数据正在恢复，本次暂不切换新版。恢复完成后再次点击启动即可更新。");
  }
  if (warning) return ready(current.running ?? await ops.startService(config), warning);
  if (!prepared.changed && !needsRestart) return ready(current.running ?? await ops.startService(config));

  if (current.running) await ops.stopService(current.state);
  let selected = false;
  try {
    if (prepared.changed) {
      await ops.saveBuild(target.buildDirectory);
      selected = true;
    }
    return ready(await ops.startService(target));
  } catch (error) {
    // A startup timeout is not evidence of process exit. Never start an old
    // version alongside an unresponsive candidate or an unrelated service.
    const candidate = await ops.inspect();
    if (Number.isInteger(error.candidatePid) && ops.alive(error.candidatePid) && candidate.state?.pid !== error.candidatePid) {
      throw new Error("新版后台进程尚未报告状态，请稍后查看运行状态；不会同时启动另一个版本。", { cause: error });
    }
    checkService(config, candidate, ops.alive);
    if (candidate.running) {
      if (candidate.state.buildDirectory !== target.buildDirectory || candidate.running.restoreActive) {
        throw new Error("新版启动未完成，当前实例需要检查。未自动停止其他版本或恢复过程。", { cause: error });
      }
      await ops.stopService(candidate.state);
    }
    const latest = await ops.readConfig();
    const expected = selected ? { ...config, buildDirectory: target.buildDirectory } : config;
    if (configIdentity(latest) !== configIdentity(expected)) {
      throw new Error("启动配置已被修改，未覆盖该配置。请重新查看运行状态。", { cause: error });
    }
    if (selected) await ops.saveBuild(config.buildDirectory);
    // This restores the selected application build, never a database snapshot.
    return ready(await ops.startService(config), `新版暂时无法启动，已重新启动原版本。${error.message}`);
  }
}
