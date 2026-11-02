// Məlumat saxlama: DATABASE_URL varsa Postgres (Supabase), yoxdursa data/*.json faylları.
const fs = require("fs");
const path = require("path");

const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const url = process.env.DATABASE_URL || "";
const cache = new Map();
const pending = new Map();
let pool = null;
let ready = false;
let timer = null;
let chain = Promise.resolve();

function localFiles() {
    try { return fs.readdirSync(DATA).filter(f => f.endsWith(".json")); } catch { return []; }
}
function readLocal(name) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch { return undefined; }
}

async function doFlush() {
    if (!pool || pending.size === 0) return;
    const batch = Array.from(pending.entries());
    pending.clear();
    for (const [name, json] of batch) {
        try {
            await pool.query(
                "INSERT INTO kv (name, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
                [name, json]
            );
        } catch (e) {
            console.error("DB yazma xətası:", name, e.message);
            if (!pending.has(name)) pending.set(name, json);
            schedule(3000);
        }
    }
}
function flush() { chain = chain.then(doFlush).catch(() => {}); return chain; }
function schedule(ms = 250) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, ms);
}

async function shutdown() {
    try { if (timer) { clearTimeout(timer); timer = null; } await flush(); } finally { process.exit(0); }
}

async function init() {
    if (ready) return;
    if (url) {
        const { Pool } = require("pg");
        pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });
        pool.on("error", e => console.error("DB pool xətası:", e.message));
        await pool.query("CREATE TABLE IF NOT EXISTS kv (name text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
        const { rows } = await pool.query("SELECT name, value FROM kv");
        for (const r of rows) cache.set(r.name, r.value);
        let seeded = 0;
        for (const f of localFiles()) {
            if (cache.has(f)) continue;
            const v = readLocal(f);
            if (v === undefined) continue;
            cache.set(f, v);
            pending.set(f, JSON.stringify(v));
            seeded++;
        }
        if (pending.size) await flush();
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
        console.log("DB: " + rows.length + " fayl bazadan yükləndi, " + seeded + " fayl repodan köçürüldü.");
    } else {
        for (const f of localFiles()) { const v = readLocal(f); if (v !== undefined) cache.set(f, v); }
        console.log("DB: DATABASE_URL yoxdur, yerli fayllar işlədilir (Render-də məlumat itə bilər).");
    }
    ready = true;
}

function save(name, value) {
    const json = JSON.stringify(value);
    cache.set(name, JSON.parse(json));
    if (pool) { pending.set(name, json); schedule(); }
    else fs.writeFileSync(path.join(DATA, name), JSON.stringify(value, null, 2));
}

function read(name, fallback = []) {
    if (!cache.has(name)) save(name, fallback);
    return JSON.parse(JSON.stringify(cache.get(name)));
}

module.exports = { init, read, save, flush, get ready() { return ready; } };
