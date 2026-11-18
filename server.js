import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { alternatives, products, spending, validate } from "./public/survey.js";

const dir = resolve(process.env.DATA_DIR || "data");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const passwordFile = join(dir, "owner-password.txt");
let password = process.env.OWNER_PASSWORD;
if (!password) {
  try {
    writeFileSync(passwordFile, randomBytes(24).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  password = readFileSync(passwordFile, "utf8").trim();
}
if (!password) throw new Error("Set OWNER_PASSWORD or restore the owner password file.");
const digest = value => createHash("sha256").update(value).digest();
const expected = digest("Basic " + Buffer.from("owner:" + password).toString("base64"));
const db = new DatabaseSync(join(dir, "survey.sqlite"));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY, created TEXT NOT NULL, payload TEXT NOT NULL
  )`);
const insert = db.prepare("INSERT INTO responses VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING");
const byId = db.prepare("SELECT payload FROM responses WHERE id = ?");
const files = new Map();
for (const [path, file, type] of [
  ["/", "index.html", "text/html"], ["/style.css", "style.css", "text/css"],
  ["/app.js", "app.js", "text/javascript"], ["/survey.js", "survey.js", "text/javascript"]
]) files.set(path, [type, readFileSync(new URL("./public/" + file, import.meta.url))]);

const headers = ["وقت الإرسال (UTC)", "المنتجات", "المنتج الآخر", "الماركات الحالية", "الماركات المرغوبة", "إنفاق آخر شهر"];
const escapeHtml = value => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function values(row) {
  const data = JSON.parse(row.payload);
  const brands = key => data[key].none ? alternatives[key] : data[key].names.join("، ");
  return [row.created, data.products.map(key => products[key]).join("، "), data.other,
    brands("current"), brands("wanted"), spending[data.spending]];
}
function csvCell(value) {
  const safe = /^[\s]*[=+@-]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function ownerPage(page) {
  const size = 50;
  const records = db.prepare("SELECT * FROM responses ORDER BY rowid DESC LIMIT ? OFFSET ?").all(size + 1, page * size);
  const rows = records.slice(0, size).map(record => "<tr>" + values(record).map(val => "<td><bdi>" + escapeHtml(val) + "</bdi></td>").join("") + "</tr>").join("");
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>إجابات الاستبيان</title><link rel="stylesheet" href="/style.css"><main class="owner">
    <h1>إجابات الاستبيان</h1><a href="/owner/export.csv">تنزيل جميع الإجابات بصيغة CSV</a>
    ${rows ? '<div class="table-wrap"><table><thead><tr>' + headers.map(h => '<th scope="col">' + h + '</th>').join("") + '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p>لا توجد إجابات في هذه الصفحة.</p>'}
    <nav>${page > 0 ? '<a href="?page=' + (page - 1) + '">الصفحة السابقة</a> ' : ""}
    ${records.length > size ? '<a href="?page=' + (page + 1) + '">الصفحة التالية</a>' : ""}</nav></main></html>`;
}
function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type + "; charset=utf-8" });
  res.end(body);
}
function json(res, status, body) {
  send(res, status, "application/json", JSON.stringify(body));
}
async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && files.has(url.pathname)) return send(res, 200, ...files.get(url.pathname));
  if (req.method === "GET" && ["/owner", "/owner/export.csv"].includes(url.pathname)) {
    if (!timingSafeEqual(expected, digest(req.headers.authorization || ""))) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Survey owner", charset="UTF-8"');
      return send(res, 401, "text/plain", "يلزم تسجيل الدخول بحساب صاحب المتجر.");
    }
    if (url.pathname === "/owner") {
      const page = Number(url.searchParams.get("page") || 0);
      return send(res, 200, "text/html", ownerPage(Number.isSafeInteger(page * 50) && page >= 0 && Number.isInteger(page) ? page : 0));
    }
    res.setHeader("Content-Disposition", 'attachment; filename="kolea-responses.csv"');
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
    res.write("\uFEFF" + headers.map(csvCell).join(",") + "\r\n");
    for (const row of db.prepare("SELECT * FROM responses ORDER BY rowid").iterate()) {
      res.write(values(row).map(csvCell).join(",") + "\r\n");
    }
    return res.end();
  }
  if (url.pathname !== "/api/responses" || req.method !== "POST") return json(res, 404, {});
  if (process.env.COLLECTION_OPEN === "false") return json(res, 403, { closed: true });
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") return json(res, 415, {});
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) return json(res, 413, {});
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return json(res, 400, {}); }
  if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) return json(res, 400, {});
  const { data, errors } = validate(input);
  if (Object.keys(errors).length) return json(res, 422, { errors });
  const payload = JSON.stringify(data);
  const saved = insert.run(input.id, new Date().toISOString(), payload);
  if (!saved.changes && byId.get(input.id).payload !== payload) return json(res, 409, {});
  return json(res, saved.changes ? 201 : 200, { saved: true });
}
const server = http.createServer((req, res) => handle(req, res).catch(() => {
  if (res.headersSent) res.destroy();
  else json(res, 500, { saved: false });
}));
server.listen(port, host, () => console.log("Survey listening on http://" + host + ":" + server.address().port));
