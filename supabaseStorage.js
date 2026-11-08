// Supabase Storage — yüklənən fayllar Render diskində yox, Supabase-də saxlanır.
// SUPABASE_URL və SUPABASE_SERVICE_ROLE_KEY təyin edilməyibsə enabled=false olur
// və server köhnə disk yükləməsi ilə işləməyə davam edir.
const crypto = require("crypto");
const path = require("path");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = process.env.SUPABASE_BUCKET || "talkchat-uploads";
const enabled = Boolean(SUPABASE_URL && SERVICE_KEY);

let client = null;
if (enabled) {
    const { createClient } = require("@supabase/supabase-js");
    client = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// multer üçün storage engine: req.file.filename / size əvvəlki kimi qalır
function engine() {
    return {
        _handleFile(_req, file, cb) {
            const chunks = [];
            file.stream.on("data", c => chunks.push(c));
            file.stream.on("error", cb);
            file.stream.on("end", async () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
                    const filename = `${crypto.randomUUID()}${ext}`;
                    const { error } = await client.storage.from(BUCKET)
                        .upload(filename, buffer, { contentType: file.mimetype, upsert: false });
                    if (error) return cb(error);
                    cb(null, { filename, size: buffer.length });
                } catch (e) { cb(e); }
            });
        },
        _removeFile(_req, file, cb) {
            remove(file.filename).then(() => cb(null), cb);
        }
    };
}

function publicUrl(filename) {
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(filename)}`;
}

async function remove(filename) {
    if (!enabled || !filename) return;
    try { await client.storage.from(BUCKET).remove([filename]); }
    catch (e) { console.error("Supabase silmə xətası:", e.message); }
}

module.exports = { enabled, engine, publicUrl, remove, origin: enabled ? new URL(SUPABASE_URL).origin : "" };
