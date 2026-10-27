import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(root, "src", "config.ts");
const tmpRoots = [];

const DEFAULT_BOUNDARY = 120_000;
const DEFAULT_INTERVAL = 40_000;

async function makeTempConfigPath(name = "smart-compact.json") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smart-compact-config-"));
  tmpRoots.push(dir);
  return path.join(dir, name);
}

afterEach(async () => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    await chmod(dir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeStore(filePath) {
  const mod = await import(pathToFileURL(configPath).href);
  assert.equal(typeof mod.createSmartBoundaryConfig, "function", "config module must expose a store factory");
  const store = mod.createSmartBoundaryConfig({ configPath: filePath, path: filePath });

  return {
    read: () => store.read({ configPath: filePath, path: filePath }),
    write: (patch) => store.write(patch, { configPath: filePath, path: filePath }),
    reset: (target) => store.reset({ configPath: filePath, path: filePath, target }),
  };
}

describe("smart-compact global config", () => {
  it("falls back to the 120000/40000-token defaults when the config file is missing", async () => {
    const store = await makeStore(await makeTempConfigPath());

    const read = await store.read();

    assert.equal(read.tokens, DEFAULT_BOUNDARY);
    assert.equal(read.boundaryTokens, DEFAULT_BOUNDARY);
    assert.equal(read.intervalTokens, DEFAULT_INTERVAL);
    assert.equal(read.source, "default");
    assert.equal(read.intervalSource, "default");
  });

  it("persists a custom boundary and reloads it through a new store instance", async () => {
    const filePath = await makeTempConfigPath();
    const firstStore = await makeStore(filePath);
    await firstStore.write(160_000);

    const reloaded = await (await makeStore(filePath)).read();

    assert.equal(reloaded.boundaryTokens, 160_000);
    assert.equal(reloaded.source, "custom");
    assert.match(await readFile(filePath, "utf8"), /160000/);
  });

  it("persists a custom escalation interval independently of the boundary", async () => {
    const filePath = await makeTempConfigPath();
    const store = await makeStore(filePath);

    await store.write({ intervalTokens: 25_000 });
    let read = await store.read();
    assert.equal(read.intervalTokens, 25_000);
    assert.equal(read.intervalSource, "custom");
    assert.equal(read.boundaryTokens, DEFAULT_BOUNDARY, "setting the interval must not invent a custom boundary");
    assert.equal(read.source, "default");

    await store.write({ boundaryTokens: 90_000 });
    read = await store.read();
    assert.equal(read.boundaryTokens, 90_000, "writing the boundary must not drop the stored interval");
    assert.equal(read.intervalTokens, 25_000);
    assert.match(await readFile(filePath, "utf8"), /escalationIntervalTokens/);
  });

  it("resets only the interval when asked, and both when asked for all", async () => {
    const filePath = await makeTempConfigPath();
    const store = await makeStore(filePath);
    await store.write({ boundaryTokens: 90_000, intervalTokens: 25_000 });

    await store.reset("interval");
    let read = await store.read();
    assert.equal(read.intervalTokens, DEFAULT_INTERVAL);
    assert.equal(read.boundaryTokens, 90_000, "an interval reset must leave the custom boundary alone");

    await store.reset("all");
    read = await store.read();
    assert.equal(read.boundaryTokens, DEFAULT_BOUNDARY);
    assert.equal(read.intervalTokens, DEFAULT_INTERVAL);
  });

  it("reset removes the custom boundary and returns future reads to the default", async () => {
    const store = await makeStore(await makeTempConfigPath());
    await store.write(160_000);

    await store.reset();

    assert.equal((await store.read()).boundaryTokens, DEFAULT_BOUNDARY);
  });

  it("falls back to defaults with a warning for corrupt config content", async () => {
    const filePath = await makeTempConfigPath();
    await writeFile(filePath, "{ this is not json", "utf8");
    const store = await makeStore(filePath);

    const read = await store.read();

    assert.equal(read.boundaryTokens, DEFAULT_BOUNDARY);
    assert.equal(read.intervalTokens, DEFAULT_INTERVAL);
    assert.ok(String(read.warning ?? "").trim().length > 0, "corrupt config fallback should surface a warning");
  });

  it("falls back to defaults with a warning when the configured path cannot be read as a file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "smart-compact-unreadable-"));
    tmpRoots.push(dir);
    const unreadablePath = path.join(dir, "config-as-directory");
    await mkdir(unreadablePath);
    const store = await makeStore(unreadablePath);

    const read = await store.read();

    assert.equal(read.boundaryTokens, DEFAULT_BOUNDARY);
    assert.ok(String(read.warning ?? "").trim().length > 0, "unreadable config fallback should surface a warning");
  });

  it("rejects non-positive or fractional writes", async () => {
    const store = await makeStore(await makeTempConfigPath());

    await assert.rejects(() => store.write(0));
    await assert.rejects(() => store.write({ intervalTokens: -1 }));
    await assert.rejects(() => store.write({ intervalTokens: 1.5 }));
  });
});
