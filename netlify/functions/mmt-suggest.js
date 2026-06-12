// Monday Music Tips suggestion form. Stores the suggestion in mmt_suggestions
// (service role) and emails Matthew a heads-up. POST { suggestion, email?, name? }.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://gyskfutmncprqxazgatv.supabase.co";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND  = process.env.RESEND_API_KEY;
const NOTIFY_TO = "enquiries@matthewcawood.com";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fail = (c = 400, m = "Bad request") => ({ statusCode: c, headers, body: JSON.stringify({ error: m }) });

exports.handler = async (evt) => {
  if (evt.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (evt.httpMethod !== "POST") return fail(405, "Method not allowed");

  let suggestion, email, name;
  try {
    const b = JSON.parse(evt.body || "{}");
    suggestion = String(b.suggestion || "").trim().slice(0, 4000);
    email = String(b.email || "").trim().slice(0, 160) || null;
    name = String(b.name || "").trim().slice(0, 120) || null;
  } catch { return fail(400, "Bad JSON"); }
  if (suggestion.length < 3) return fail(400, "Please write a suggestion.");

  // Store it.
  if (SERVICE) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/mmt_suggestions`, {
        method: "POST",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ suggestion, email, name }),
      });
      if (!r.ok) { console.error("mmt_suggestions insert failed:", r.status, await r.text()); return fail(500, "Could not save, please try again."); }
    } catch (e) { console.error("mmt-suggest store error:", e); return fail(500, "Could not save, please try again."); }
  }

  // Notify Matthew (best-effort).
  if (RESEND) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Monday Music Tips <noreply@matthewcawood.com>",
          to: [NOTIFY_TO], reply_to: email || undefined,
          subject: "New Monday Music Tip suggestion",
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1410;line-height:1.6">
            <p style="margin:0 0 6px"><strong>From:</strong> ${esc(name || "Anonymous")}${email ? ` &lt;${esc(email)}&gt;` : ""}</p>
            <hr style="border:none;border-top:1px solid #e0d5c8;margin:12px 0">
            <p style="white-space:pre-wrap;margin:0">${esc(suggestion)}</p></div>`,
        }),
      });
    } catch (e) { console.error("mmt-suggest notify failed:", e); }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
