import { test } from "node:test";
import assert from "node:assert/strict";
import { discardItem, memoryStore, newItem, retryItem, syncOutbox, type OutboxItem, type SendResult } from "./outbox.ts";

const at = (min: number) => new Date(Date.UTC(2026, 10, 26, 9, min));
const item = (id: string, jobId: string, min: number, type: OutboxItem["type"] = "note") => newItem(type, jobId, { text: id }, id, at(min));

/** A fake server: answers per item id, records what it received. */
function server(answers: Record<string, SendResult | SendResult[]> = {}) {
  const got: string[] = [];
  const send = async (i: OutboxItem): Promise<SendResult> => {
    got.push(i.id);
    const a = answers[i.id];
    if (Array.isArray(a)) return a.shift() ?? { ok: true };
    return a ?? { ok: true };
  };
  return { got, send };
}

test("sends everything oldest first and empties the queue", async () => {
  const store = memoryStore([item("b", "J1", 2), item("a", "J1", 1), item("c", "J2", 3)]);
  const srv = server();
  const r = await syncOutbox(store, srv.send);
  assert.deepEqual(srv.got, ["a", "b", "c"]);
  assert.deepEqual(r, { sent: 3, failed: 0, waiting: 0, offline: false, needsSignIn: false });
});

test("stops when there is no connection and keeps everything", async () => {
  const store = memoryStore([item("a", "J1", 1), item("b", "J2", 2)]);
  const r = await syncOutbox(store, server({ a: { ok: false, status: 0, message: "offline" } }).send);
  assert.equal(r.offline, true);
  assert.equal(r.waiting, 2);
  assert.equal(store.items.get("a")?.tries, 0);
});

test("stops at a sign-in and keeps the queue for later", async () => {
  const store = memoryStore([item("a", "J1", 1), item("b", "J2", 2)]);
  const srv = server({ a: { ok: false, status: 401, message: "Sign in required" } });
  const r = await syncOutbox(store, srv.send);
  assert.equal(r.needsSignIn, true);
  assert.deepEqual(srv.got, ["a"]);
  assert.equal(r.waiting, 2);
});

test("a refusal fails that change and holds back the same job's later changes only", async () => {
  const store = memoryStore([item("a", "J1", 1), item("b", "J1", 2), item("c", "J2", 3)]);
  const srv = server({ a: { ok: false, status: 400, message: "Job is closed — editing locked" } });
  const r = await syncOutbox(store, srv.send);
  assert.deepEqual(srv.got, ["a", "c"]);
  assert.equal(store.items.get("a")?.state, "failed");
  assert.equal(store.items.get("a")?.lastError, "Job is closed — editing locked");
  assert.equal(store.items.get("b")?.state, "pending");
  assert.deepEqual({ sent: r.sent, failed: r.failed, waiting: r.waiting }, { sent: 1, failed: 1, waiting: 1 });

  // Next time round, the failed change still holds its job back.
  const again = server();
  await syncOutbox(store, again.send);
  assert.deepEqual(again.got, []);
});

test("conflicts are retried, then fail after three tries", async () => {
  const conflict: SendResult = { ok: false, status: 409, message: "Someone else changed it" };
  const store = memoryStore([item("a", "J1", 1)]);
  await syncOutbox(store, server({ a: conflict }).send);
  assert.deepEqual([store.items.get("a")?.state, store.items.get("a")?.tries], ["pending", 1]);
  await syncOutbox(store, server({ a: conflict }).send);
  assert.equal(store.items.get("a")?.state, "pending");
  await syncOutbox(store, server({ a: conflict }).send);
  assert.deepEqual([store.items.get("a")?.state, store.items.get("a")?.tries], ["failed", 3]);
});

test("server errors are retried without failing", async () => {
  const store = memoryStore([item("a", "J1", 1)]);
  for (let n = 0; n < 5; n++) await syncOutbox(store, server({ a: { ok: false, status: 503, message: "Busy" } }).send);
  assert.equal(store.items.get("a")?.state, "pending");
  assert.equal(store.items.get("a")?.tries, 5);
  await syncOutbox(store, server().send);
  assert.equal(store.items.size, 0);
});

test("a failed change can be retried or discarded", async () => {
  const store = memoryStore([item("a", "J1", 1), item("b", "J1", 2)]);
  await syncOutbox(store, server({ a: { ok: false, status: 400, message: "No" } }).send);
  await retryItem(store, "a");
  assert.deepEqual([store.items.get("a")?.state, store.items.get("a")?.tries], ["pending", 0]);
  const srv = server();
  await syncOutbox(store, srv.send);
  assert.deepEqual(srv.got, ["a", "b"]);

  const store2 = memoryStore([item("x", "J9", 1)]);
  await syncOutbox(store2, server({ x: { ok: false, status: 400, message: "No" } }).send);
  await discardItem(store2, "x");
  assert.equal(store2.items.size, 0);
});
