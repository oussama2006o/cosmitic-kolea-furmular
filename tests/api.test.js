import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "kolea-survey-test-"));
const owner = { authorization: "Basic " + Buffer.from("owner:test-password").toString("base64") };
let child, url;
async function start() {
  child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DATA_DIR: dir, OWNER_PASSWORD: "test-password", COLLECTION_OPEN: "true" },
    stdio: ["ignore", "pipe", "inherit"]
  });
  const [message] = await once(child.stdout, "data");
  url = message.toString().trim().split(" ").at(-1);
}
async function stop() {
  const done = once(child, "exit");
  child.kill();
  await done;
}
before(start);
after(async () => { await stop(); rmSync(dir, { recursive: true }); });
const example = () => ({
  id: randomUUID(), products: ["other"], other: "فرشاة",
  current: { none: false, names: ["  ماركة    A  "] },
  wanted: { none: true, names: [] }, spending: "none"
});
const post = data => fetch(url + "/api/responses", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
});
test("invalid and mutually exclusive answers are rejected by the server", async () => {
  for (const change of [
    { products: [] }, { products: ["lips", "eyes", "skin", "face"] },
    { products: ["eyes", "eyes"] }, { other: "  " }, { other: "a".repeat(201) },
    { current: { none: false, names: [" "] } }, { wanted: { none: true, names: ["A"] } },
    { wanted: { none: false, names: ["a","b","c","d"] } },
    { current: { none: false, names: ["a".repeat(101)] } }, { spending: "invalid" }
  ]) assert.equal((await post({ ...example(), ...change })).status, 422);
});
test("owner access, concurrent retries, persistence, Arabic CSV and safe spreadsheet text", async () => {
  for (const path of ["/owner", "/owner/export.csv"]) {
    assert.equal((await fetch(url + path)).status, 401);
  }
  assert.equal((await fetch(url + "/data/owner-password.txt")).status, 404);
  const entry = example();
  entry.other = '=فرشاة,"صغيرة"';
  const retries = await Promise.all([post(entry), post(entry)]);
  assert.deepEqual(retries.map(r => r.status).sort(), [200, 201]);
  assert.equal((await post({ ...entry, spending: "high" })).status, 409);
  await stop();
  await start();
  assert.equal((await post(entry)).status, 200);
  const exported = await fetch(url + "/owner/export.csv", { headers: owner });
  assert.equal(exported.status, 200);
  const bytes = Buffer.from(await exported.arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  const csv = bytes.toString();
  assert.equal(csv.trim().split("\r\n").length, 2);
  assert.ok(csv.includes("'=فرشاة," + '""صغيرة""'));
  assert.ok(csv.includes("ماركة A"));
  assert.ok(csv.includes("ليس لدي تفضيل"));
  const results = await fetch(url + "/owner", { headers: owner });
  assert.ok((await results.text()).includes("ماركة A"));
});
