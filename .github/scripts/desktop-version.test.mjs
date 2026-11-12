import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, setVersion, validateVersions } from "./desktop-version.mjs";

function versionFiles(version = "1.0.1") {
  return new Map([
    ["apps/desktop/src-tauri/tauri.conf.json", JSON.stringify({ version, plugins: { updater: { pubkey: "fork-public-key" } } })],
    ["apps/desktop/package.json", JSON.stringify({ name: "cursor-byok-desktop", version })],
    ["apps/desktop/package-lock.json", JSON.stringify({ version, packages: { "": { version }, "node_modules/example": { version: "7.0.0" } } })],
    ["apps/desktop/src-tauri/Cargo.toml", `[package]\nname = "cursor-byok-desktop"\nversion = "${version}"\nedition = "2021"\n`],
    ["Cargo.lock", `version = 4\n\n[[package]]\nname = "cursor-server"\nversion = "0.1.0"\n\n[[package]]\nname = "cursor-byok-desktop"\nversion = "${version}"\n`],
  ]);
}

test("compares stable versions numerically", () => {
  assert.equal(compareVersions("1.0.10", "1.0.9"), 1);
  assert.equal(compareVersions("1.1.0", "1.0.99"), 1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.0.1", "1.0.1"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
});

test("rejects missing, malformed and prerelease versions", () => {
  for (const version of [undefined, null, "", "01.0.1", "v1.0.1", "1.0", "1.0.2-beta.1", "1.0.2\n"]) {
    assert.throws(() => compareVersions(version, "1.0.1"));
  }
});

test("requires all manifests and lockfiles to agree", () => {
  const files = versionFiles();
  assert.equal(validateVersions(files), "1.0.1");
  for (const path of files.keys()) {
    const inconsistent = new Map(files);
    inconsistent.set(path, inconsistent.get(path).replaceAll("1.0.1", "1.0.2"));
    assert.throws(() => validateVersions(inconsistent), /versions differ/);
  }
});

test("updates all five files without changing dependency versions or the public key", () => {
  const files = versionFiles();
  const updated = setVersion(files, "1.0.2");
  assert.equal(validateVersions(updated), "1.0.2");
  assert.equal(validateVersions(files), "1.0.1");
  const config = JSON.parse(updated.get("apps/desktop/src-tauri/tauri.conf.json"));
  assert.equal(config.plugins.updater.pubkey, "fork-public-key");
  const lock = JSON.parse(updated.get("apps/desktop/package-lock.json"));
  assert.equal(lock.packages["node_modules/example"].version, "7.0.0");
  assert.match(updated.get("Cargo.lock"), /name = "cursor-server"\nversion = "0.1.0"/);
});

test("rejects unchanged versions and downgrades", () => {
  for (const version of ["1.0.1", "1.0.0", "0.9.9"]) {
    assert.throws(() => setVersion(versionFiles(), version), /must be greater/);
  }
});

test("supports CRLF Cargo files", () => {
  const files = versionFiles();
  for (const path of ["apps/desktop/src-tauri/Cargo.toml", "Cargo.lock"]) {
    files.set(path, files.get(path).replaceAll("\n", "\r\n"));
  }
  assert.equal(validateVersions(setVersion(files, "1.0.2")), "1.0.2");
});
