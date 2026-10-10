import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error("This test requires the local Firestore emulator.");
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("HTTP smoke tests only run against localhost.");
initializeApp({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "demo-teachback",
});
const db = getFirestore();
const operationId = randomUUID();
const preparationId = randomUUID();
const owners = new Set();
const data = {
  operationId,
  text: "Filters reuse learned weights across spatial locations. Image size changes computation, not the learned filter parameters.",
};
const post = async (path, body, cookie, requestOrigin = origin) => {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const token = response.headers
    .get("set-cookie")
    ?.match(/teachback_guest=([^;]+)/)?.[1];
  if (token) owners.add(createHash("sha256").update(token).digest("hex"));
  return response;
};
try {
  assert.equal(
    (await post("/api/materials", data, undefined, "https://unrelated.example"))
      .status,
    403,
  );
  const created = await post("/api/materials", data);
  assert.equal(created.status, 201);
  const cookie = created.headers.get("set-cookie").split(";")[0];
  assert.match(created.headers.get("set-cookie"), /httponly/i);
  assert.match(created.headers.get("set-cookie"), /samesite=strict/i);
  const material = await created.json();
  assert.equal(
    (await (await post("/api/materials", data, cookie)).json()).id,
    material.id,
  );
  assert.equal((await post("/api/materials", data)).status, 404);
  const status = await (await fetch(origin + "/api/status")).json();
  if (!status.configured) {
    const lesson = await post(
      "/api/lessons",
      {
        operationId: preparationId,
        materialId: material.id,
        topic: "CNN weight sharing",
        level: "introductory",
        sources: material.sources,
      },
      cookie,
    );
    assert.equal(lesson.status, 503);
    assert.equal((await lesson.json()).error.code, "SETUP_REQUIRED");
  }
  console.log(
    "HTTP smoke passed: origin protection, HttpOnly cookie, persistence, idempotency, guest ownership, and configuration response. No model calls made.",
  );
} finally {
  await db.collection("materials").doc(operationId).delete();
  for (const owner of owners) {
    await db.collection("guests").doc(owner).delete();
    for (const id of [operationId, preparationId])
      await db.collection("operations").doc(`${owner}-${id}`).delete();
  }
  await db.terminate();
}
