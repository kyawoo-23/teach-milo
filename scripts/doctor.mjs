import { spawnSync } from "node:child_process";
import fs from "node:fs";
try {
  process.loadEnvFile(".env.local");
} catch {}
const major = Number(process.versions.node.split(".")[0]);
const checks = [
  [
    "Node 24.15 or newer",
    major > 24 ||
      (major === 24 && Number(process.versions.node.split(".")[1]) >= 15),
  ],
  ["Gemini key configured", !!process.env.GEMINI_API_KEY],
  ["Firestore project configured", !!process.env.GOOGLE_CLOUD_PROJECT],
  [
    "Firebase CLI installed",
    fs.existsSync("node_modules/firebase-tools/lib/bin/firebase.js"),
  ],
];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  const version = Number(
    (java.stderr || java.stdout || "").match(/version "(\d+)/)?.[1] || 0,
  );
  checks.push([
    "JDK 21 or newer for the emulator",
    java.status === 0 && version >= 21,
  ]);
  try {
    const response = await fetch(
      `http://${process.env.FIRESTORE_EMULATOR_HOST}/`,
      { signal: AbortSignal.timeout(2000) },
    );
    checks.push(["Firestore emulator running", response.status < 500]);
  } catch {
    checks.push(["Firestore emulator running", false]);
  }
}
for (const [name, ok] of checks)
  console.log(`${ok ? "OK" : "MISSING"}  ${name}`);
if (checks.some(([, ok]) => !ok)) {
  console.log(
    "\nSee README.md for setup. Credential values are never printed.",
  );
  process.exitCode = 1;
}
