// The production build: one page plus the files that make it installable and offline.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const dist = (f) => `${app}dist/${f}`;

test("build: writes the page, manifest, icon and an offline service worker", () => {
  execFileSync(process.execPath, ["build.mjs"], { cwd: app, stdio: "pipe" });
  const sw = readFileSync(dist("sw.js"), "utf8");
  assert.match(sw, /const VERSION = "[0-9a-f]{12}"/);
  // every file the worker precaches must exist, or install fails and nothing is cached
  const files = JSON.parse(sw.match(/const FILES = (\[.*?\]);/)[1]);
  for (const f of files) if (f !== "./") assert.ok(existsSync(dist(f)), f);
  const html = readFileSync(dist("index.html"), "utf8");
  assert.match(html, /<link rel="manifest"/);
  assert.ok(!readFileSync(dist("artifact.html"), "utf8").includes('<link rel="manifest"'), "the artifact build has no manifest, so it never registers a worker");
});
