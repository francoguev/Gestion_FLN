import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "content-type": "application/json" };

function bytesFromBase64(value: string): Uint8Array {
  const normalized = value.replace(/^sha256=/i, "").trim();
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256Base64(value: string, secret?: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  let output: ArrayBuffer;
  if (secret) {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    output = await crypto.subtle.sign("HMAC", key, input);
  } else {
    output = await crypto.subtle.digest("SHA-256", input);
  }
  return btoa(String.fromCharCode(...new Uint8Array(output)));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  const signingSecret = Deno.env.get("TALLY_SIGNING_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!signingSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Missing required server secret.");
    return new Response(JSON.stringify({ error: "Webhook is not configured" }), { status: 500, headers: corsHeaders });
  }

  const rawBody = await request.text();
  const receivedSignature = request.headers.get("Tally-Signature");
  if (!receivedSignature) {
    return new Response(JSON.stringify({ error: "Missing Tally signature" }), { status: 401, headers: corsHeaders });
  }

  try {
    const expected = bytesFromBase64(await sha256Base64(rawBody, signingSecret));
    if (!sameBytes(expected, bytesFromBase64(receivedSignature))) {
      return new Response(JSON.stringify({ error: "Invalid Tally signature" }), { status: 401, headers: corsHeaders });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid Tally signature format" }), { status: 401, headers: corsHeaders });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: corsHeaders });
  }

  const data = (event.data ?? {}) as Record<string, unknown>;
  const submissionId = String(data.submissionId ?? data.responseId ?? "");
  if (!submissionId) {
    return new Response(JSON.stringify({ error: "Missing submission ID" }), { status: 400, headers: corsHeaders });
  }

  const contentHash = await sha256Base64(rawBody);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase.from("form_submissions").upsert({
    source: "tally",
    source_submission_id: submissionId,
    form_id: data.formId ? String(data.formId) : null,
    submitted_at: data.createdAt ? String(data.createdAt) : null,
    content_hash: contentHash,
    payload: event,
  }, { onConflict: "source,source_submission_id" });

  if (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "Could not store submission" }), { status: 500, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, submissionId }), { status: 200, headers: corsHeaders });
});
