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
const users = [];
const data = {
  operationId,
  text: "Filters reuse learned weights across spatial locations. Image size changes computation, not the learned filter parameters.",
};
const post = async (path, body, cookie, requestOrigin = origin) =>
  fetch(origin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const signup = async () => {
  const response = await post("/api/auth/signup", {
    email: `smoke-${randomUUID()}@example.test`,
    password: randomUUID(),
    name: "Smoke Test",
  });
  assert.equal(response.status, 201);
  const header = response.headers.get("set-cookie");
  assert.match(header, /httponly/i);
  const token = header.match(/teachback_auth=([^;]+)/)[1];
  const { user } = await response.json();
  users.push({
    id: user.id,
    session: createHash("sha256").update(token).digest("hex"),
  });
  return `teachback_auth=${token}`;
};
try {
  assert.equal(
    (await post("/api/materials", data, undefined, "https://unrelated.example"))
      .status,
    403,
  );
  const anonymous = await post("/api/materials", data);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "AUTH_REQUIRED");
  const cookie = await signup();
  const created = await post("/api/materials", data, cookie);
  assert.equal(created.status, 201);
  const material = await created.json();
  assert.equal(
    (await (await post("/api/materials", data, cookie)).json()).id,
    material.id,
  );
  assert.equal(
    (await post("/api/materials", data, await signup())).status,
    404,
  );
  const status = await (await fetch(origin + "/api/status")).json();
  if (!status.configured) {
    const lesson = await post(
      "/api/lessons",
      {
        operationId: preparationId,
        materialId: material.id,
        topic: "Reusing filter weights",
        level: "introductory",
        sources: material.sources,
      },
      cookie,
    );
    assert.equal(lesson.status, 503);
    assert.equal((await lesson.json()).error.code, "SETUP_REQUIRED");
  }
  console.log(
    "HTTP smoke passed: origin protection, sign-in requirement, HttpOnly auth cookie, persistence, idempotency, account ownership, and configuration response. No model calls made.",
  );
} finally {
  await db.collection("materials").doc(operationId).delete();
  for (const user of users) {
    await db.collection("users").doc(user.id).delete();
    await db.collection("user_sessions").doc(user.session).delete();
    for (const id of [operationId, preparationId])
      await db.collection("operations").doc(`${user.id}-${id}`).delete();
  }
  await db.terminate();
}
