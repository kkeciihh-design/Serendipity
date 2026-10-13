import fs from "node:fs";
import path from "node:path";

// Check every existing component, including test-data and its ancestors, before
// creating or removing files. A lexical prefix alone does not exclude junctions.
export function assertTestDataPath(target, projectRoot = process.cwd()) {
  const allowedRoot = path.resolve(projectRoot, "test-data");
  const resolved = path.resolve(target);
  const relative = path.relative(allowedRoot, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Refusing to access data outside a project test-data subdirectory.");
  }
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep)) {
    current = path.join(current, part);
    let entry;
    try { entry = fs.lstatSync(current); } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1) || path.relative(current, fs.realpathSync(current)) !== "") {
      throw new Error("Refusing linked test-data paths.");
    }
  }
  return resolved;
}

export function assertTestDataTree(target, projectRoot = process.cwd()) {
  const resolved = assertTestDataPath(target, projectRoot);
  if (!fs.existsSync(resolved)) return resolved;
  if (fs.lstatSync(resolved).isDirectory()) {
    for (const entry of fs.readdirSync(resolved)) {
      assertTestDataTree(path.join(resolved, entry), projectRoot);
    }
  }
  return resolved;
}
