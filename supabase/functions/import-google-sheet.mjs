// Carga inicial idempotente desde la hoja principal publicada como CSV.
// No incluye secretos: se pasan solo como variables de entorno al ejecutarlo.
// Ejemplo:
// SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GOOGLE_SHEET_CSV_URL=... node import-google-sheet.mjs

import { createHash } from "node:crypto";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_SHEET_CSV_URL"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Falta la variable ${key}`);
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const dryRun = process.argv.includes("--dry-run");
const response = await fetch(process.env.GOOGLE_SHEET_CSV_URL);
if (!response.ok) throw new Error(`No se pudo leer la hoja: HTTP ${response.status}`);
const [headers = [], ...rows] = parseCsv(await response.text());
const records = rows.map((values, rowIndex) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ""])))
  .filter((record) => Object.values(record).some((value) => String(value).trim() !== ""));

if (dryRun) {
  console.log(JSON.stringify({ rows: records.length, headers, sample: records[0] ?? null }, null, 2));
  process.exit(0);
}

const endpoint = `${process.env.SUPABASE_URL}/rest/v1/form_submissions?on_conflict=source,source_submission_id`;
const batchSize = 200;
for (let start = 0; start < records.length; start += batchSize) {
  const batch = records.slice(start, start + batchSize).map((payload, offset) => {
    const serialized = JSON.stringify(payload);
    const rowNumber = start + offset + 2;
    const hash = sha256(serialized);
    return {
      source: "google_sheet",
      source_submission_id: `row-${rowNumber}-${hash}`,
      content_hash: hash,
      payload,
    };
  });
  const result = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(batch),
  });
  if (!result.ok) throw new Error(`Error importando filas ${start + 1}-${start + batch.length}: ${await result.text()}`);
  console.log(`Importadas ${Math.min(start + batch.length, records.length)} de ${records.length}`);
}
