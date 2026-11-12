import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const configPath = "apps/desktop/src-tauri/tauri.conf.json";
const packagePath = "apps/desktop/package.json";
const packageLockPath = "apps/desktop/package-lock.json";
const cargoPath = "apps/desktop/src-tauri/Cargo.toml";
const cargoLockPath = "Cargo.lock";
const paths = [configPath, packagePath, packageLockPath, cargoPath, cargoLockPath];
const desktopLockVersion = /(\[\[package\]\]\r?\nname = "cursor-byok-desktop"\r?\nversion = ")([^"]+)(")/;
const cargoVersion = /^(version = ")([^"]+)(")/m;

function versionParts(version) {
  if (typeof version !== "string" || version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`expected a stable MAJOR.MINOR.PATCH version, received ${version}`);
  }
  return version.split(".").map(BigInt);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function validateVersions(files) {
  const config = JSON.parse(files.get(configPath));
  const pkg = JSON.parse(files.get(packagePath));
  const lock = JSON.parse(files.get(packageLockPath));
  const version = config.version;
  versionParts(version);
  const versions = [
    pkg.version,
    lock.version,
    lock.packages?.[""]?.version,
    files.get(cargoPath).match(cargoVersion)?.[2],
    files.get(cargoLockPath).match(desktopLockVersion)?.[2],
  ];
  if (versions.some((value) => value !== version)) {
    throw new Error("desktop versions differ; run node .github/scripts/desktop-version.mjs set VERSION");
  }
  return version;
}

export function setVersion(files, version) {
  const current = validateVersions(files);
  if (compareVersions(version, current) <= 0) {
    throw new Error(`new version ${version} must be greater than ${current}`);
  }
  const updated = new Map(files);
  for (const path of [configPath, packagePath, packageLockPath]) {
    const value = JSON.parse(files.get(path));
    value.version = version;
    if (path === packageLockPath) value.packages[""].version = version;
    updated.set(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  updated.set(cargoPath, files.get(cargoPath).replace(cargoVersion, (_, prefix, _old, suffix) => `${prefix}${version}${suffix}`));
  updated.set(cargoLockPath, files.get(cargoLockPath).replace(desktopLockVersion, (_, prefix, _old, suffix) => `${prefix}${version}${suffix}`));
  validateVersions(updated);
  return updated;
}

async function main() {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (extra.length || !["check", "set", "plan"].includes(command)) {
    throw new Error("usage: desktop-version.mjs check | set VERSION | plan PREVIOUS_COMMIT");
  }
  const files = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(resolve(root, path), "utf8")])));
  const version = validateVersions(files);
  if (command === "set") {
    const updated = setVersion(files, argument);
    for (const [path, contents] of updated) await writeFile(resolve(root, path), contents);
    console.log(`Desktop version updated to ${argument} in all five version files.`);
  } else if (command === "plan") {
    if (!/^[a-f0-9]{40}$/.test(argument ?? "")) throw new Error("previous commit must be a full Git SHA");
    let changed = true;
    if (!/^0+$/.test(argument)) {
      const previous = JSON.parse(execFileSync("git", ["show", `${argument}:${configPath}`], { cwd: root, encoding: "utf8" })).version;
      const comparison = compareVersions(version, previous);
      if (comparison < 0) throw new Error(`desktop version cannot decrease from ${previous} to ${version}`);
      changed = comparison > 0;
    }
    console.log(`version=${version}\nversion_changed=${changed}`);
  } else {
    if (argument) throw new Error("check does not accept an argument");
    console.log(`Desktop version files agree: ${version}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
