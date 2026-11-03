const path = require("path");
const crypto = require("crypto");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "talkchat-uploads";

function headers(extra = {}) {
    if (!supabaseUrl || !serviceKey) {
        throw new Error("Supabase Storage environment variables are missing.");
    }
    return {
        apikey: serviceKey,
        ...extra
    };
}

async function uploadFile(file) {
    const ext = path.extname(file.originalname)
        .toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
    const filename = `${crypto.randomUUID()}${ext}`;

    const response = await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${filename}`,
        {
            method: "POST",
            headers: headers({
                "Content-Type": file.mimetype,
                "x-upsert": "false"
            }),
            body: file.buffer
        }
    );

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Supabase upload failed (${response.status}): ${details}`);
    }

    return filename;
}

async function deleteFile(fileUrl) {
    if (!fileUrl) return;
    const filename = path.basename(fileUrl);
    if (!filename) return;

    const response = await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
        {
            method: "DELETE",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ prefixes: [filename] })
        }
    );

    if (!response.ok && response.status !== 404) {
        throw new Error(`Supabase delete failed: ${response.status}`);
    }
}

async function getFile(filename, range) {
    const safeName = path.basename(filename);
    const response = await fetch(
        `${supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${safeName}`,
        {
            headers: headers(range ? { Range: range } : {})
        }
    );
    return response;
}

module.exports = { uploadFile, deleteFile, getFile };
