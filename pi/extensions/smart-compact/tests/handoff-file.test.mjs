import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const modulePath = path.join(root, "src", "handoff-file.ts");
const tmpRoots = [];

afterEach(async () => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    await chmod(dir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempCwd() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smart-compact-handoff-"));
  tmpRoots.push(dir);
  return dir;
}

async function load() {
  return import(pathToFileURL(modulePath).href);
}

describe("durable handoff file", () => {
  it("builds a filesystem-safe ISO timestamped file name carrying the compaction id", async () => {
    const { buildHandoffFileName } = await load();

    const name = buildHandoffFileName(new Date("2026-08-04T13:45:12.345Z"), "smart-compact-3");

    assert.equal(name, "2026-08-04T13-45-12Z-smart-compact-3-compaction-handoff.md");
    assert.doesNotMatch(name, /:/, "colons are not portable in file names");
    assert.equal(
      buildHandoffFileName(new Date("2026-08-04T13:45:12.345Z")),
      "2026-08-04T13-45-12Z-compaction-handoff.md",
      "a missing id should still produce a usable name",
    );
    assert.equal(
      buildHandoffFileName(new Date("2026-08-04T13:45:12.345Z"), " ../smart compact/9 "),
      "2026-08-04T13-45-12Z-smart-compact-9-compaction-handoff.md",
      "path separators and spaces must not leak into the file name",
    );
  });

  it("does not overwrite an earlier handoff written in the same second", async () => {
    const { writeHandoffFile } = await load();
    const cwd = await makeTempCwd();
    const now = new Date("2026-08-04T13:45:12.345Z");

    const first = await writeHandoffFile({ cwd, handoff: "first handoff", smartCompactionId: "smart-compact-1", now });
    const second = await writeHandoffFile({ cwd, handoff: "second handoff", smartCompactionId: "smart-compact-2", now });

    assert.notEqual(first.path, second.path, "same-second compactions must not collide");
    assert.equal((await readdir(path.join(cwd, ".agents", "handoff"))).length, 2);
    assert.match(await readFile(first.path, "utf8"), /first handoff/);
    assert.match(await readFile(second.path, "utf8"), /second handoff/);
  });

  it("does not overwrite a handoff from a concurrent process with the same compaction id", async () => {
    // Concurrent pi-subagents children share the cwd, and the compaction id is
    // a per-process counter, so two children in the same second both build
    // `...-smart-compact-1-...`. The second write must land under a pid-suffixed
    // name, and a third identical write must warn rather than overwrite.
    const { writeHandoffFile } = await load();
    const cwd = await makeTempCwd();
    const now = new Date("2026-08-04T13:45:12.345Z");
    const shared = { cwd, smartCompactionId: "smart-compact-1", now };

    const first = await writeHandoffFile({ ...shared, handoff: "first process" });
    const second = await writeHandoffFile({ ...shared, handoff: "second process" });

    assert.ok(first.path && second.path, "both writes should succeed");
    assert.notEqual(first.path, second.path, "identical ids from separate processes must not collide");
    assert.match(await readFile(first.path, "utf8"), /first process/);
    assert.match(await readFile(second.path, "utf8"), /second process/);

    const third = await writeHandoffFile({ ...shared, handoff: "third process" });
    assert.equal(third.path, undefined, "an unresolvable collision must not silently overwrite");
    assert.match(String(third.warning ?? ""), /could not write the durable handoff file/i);
    assert.match(await readFile(second.path, "utf8"), /second process/, "the earlier handoff must survive");
  });

  it("creates .agents/handoff/ under the project cwd and writes the handoff verbatim", async () => {
    const { writeHandoffFile } = await load();
    const cwd = await makeTempCwd();
    const handoff = "Progress completed: unit finished.\nNext steps: continue after compaction.";

    const result = await writeHandoffFile({ cwd, handoff, smartCompactionId: "smart-compact-7" });

    assert.ok(result.path, `expected a written path, got warning: ${result.warning}`);
    assert.equal(result.warning, undefined);
    assert.equal(path.dirname(result.path), path.join(cwd, ".agents", "handoff"));
    assert.deepEqual(await readdir(path.join(cwd, ".agents", "handoff")), [path.basename(result.path)]);

    const contents = await readFile(result.path, "utf8");
    assert.match(contents, /^# Compaction handoff/);
    assert.match(contents, /Compaction id: smart-compact-7/);
    assert.ok(contents.includes(handoff), "the agent-authored handoff must be preserved verbatim");
  });

  it("writes into the nearest .agents above a subfolder cwd instead of creating a stray one", async () => {
    const { writeHandoffFile } = await load();
    const repo = await makeTempCwd();
    await mkdir(path.join(repo, ".agents"));
    const cwd = path.join(repo, "pkg", "sub");
    await mkdir(cwd, { recursive: true });

    const result = await writeHandoffFile({ cwd, handoff: "nested", smartCompactionId: "smart-compact-1" });

    assert.equal(path.dirname(result.path), path.join(repo, ".agents", "handoff"));
    assert.equal((await readdir(cwd)).length, 0, "no .agents may appear in the subfolder");
  });

  it("reports a warning instead of throwing when there is no cwd", async () => {
    const { writeHandoffFile } = await load();

    for (const cwd of [undefined, "", "   "]) {
      const result = await writeHandoffFile({ cwd, handoff: "text", smartCompactionId: "smart-compact-1" });
      assert.equal(result.path, undefined);
      assert.ok(String(result.warning ?? "").length > 0, "a missing cwd should be reported as a warning");
    }
  });

  it("reports a warning instead of throwing when the directory cannot be created", async () => {
    const { writeHandoffFile } = await load();
    const cwd = await makeTempCwd();
    await chmod(cwd, 0o500);

    const result = await writeHandoffFile({ cwd, handoff: "text", smartCompactionId: "smart-compact-2" });

    assert.equal(result.path, undefined);
    assert.match(String(result.warning ?? ""), /could not write the durable handoff file/i);
  });
});
