import path from "node:path";
import fs from "node:fs";
import { assertTestDataPath, assertTestDataTree } from "../../scripts/test-data-safety.mjs";

// Routine re-runs must not replace the original phase acceptance evidence.
export function verificationEvidenceDirectory(scope: string) {
  if (!/^[a-z0-9-]+$/.test(scope)) throw new Error("Invalid evidence scope.");
  const root = process.env.SERENDIPITY_EVIDENCE_DIR
    ? path.resolve(process.env.SERENDIPITY_EVIDENCE_DIR)
    : path.resolve("test-data", "verification-output");
  assertTestDataTree(root);
  return assertTestDataPath(path.join(root, scope));
}

export function writeVerificationEvidence(scope: string, name: string, value: unknown) {
  if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error("Invalid evidence name.");
  const directory = verificationEvidenceDirectory(scope);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), value }, null, 2));
}
