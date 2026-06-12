// Newsletter signup for the brand site. Saves the subscriber (service role,
// bypasses RLS) and sends a short welcome via Resend. POST {email, source}.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://gyskfutmncprqxazgatv.supabase.co";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND = process.env.RESEND_API_KEY;

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const ok   = (b={ok:true}) => ({ statusCode: 200, headers, body: JSON.stringify(b) });
const fail = (c=400, m="Bad request") => ({ statusCode: c, headers, body: JSON.stringify({ error: m }) });

exports.handler = async (evt) => {
  if (evt.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (evt.httpMethod !== "POST") return fail(405, "Method not allowed");
  let email, source;
  try { const b = JSON.parse(evt.body || "{}"); email = String(b.email||"").trim().toLowerCase(); source = String(b.source||"site").slice(0,40); }
  catch { return fail(400, "Bad JSON"); }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, "Invalid email");

  // Add to email_contacts + the Monday Music Tips list (the campaign system the
  // sender reads from). Service role bypasses RLS. Contact must exist before the
  // subscription (FK), so insert it first.
  try {
    if (SERVICE) {
      const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
      await fetch(`${SUPABASE_URL}/rest/v1/email_contacts`, {
        method: "POST",
        headers: { ...h, Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ email, notes: source ? `signup: ${source}` : null }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/email_list_subscriptions`, {
        method: "POST",
        headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ email, list_slug: "monday-music-tips", opted_out: false }),
      });
    }
  } catch (e) { console.error("subscribe failed:", e); }

  // welcome email (best-effort)
  try {
    if (RESEND) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Matthew Cawood <noreply@matthewcawood.com>",
          to: [email],
          subject: "You're on the list 🎹",
          html: `<!DOCTYPE html><html><body style="margin:0;background:#faf7f3;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1410;padding:40px 20px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <table width="100%" style="max-width:520px" cellpadding="0" cellspacing="0">
              <tr><td style="text-align:center;padding-bottom:18px"><span style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#a99d8c">Monday Music Tips</span></td></tr>
              <tr><td style="background:#fff;border:1px solid #e0d5c8;border-radius:14px;padding:30px 28px">
                <h1 style="margin:0 0 14px;font-size:22px;color:#42382e">Welcome — you're in.</h1>
                <p style="margin:0 0 14px;line-height:1.7;color:#42382e">Thanks for joining Monday Music Tips. Every Monday I'll send you one short, useful idea about practice, theory or musicality.</p>
                <p style="margin:0 0 20px;line-height:1.7;color:#42382e">While you wait for the next one, the whole archive of 115+ tips is right here:</p>
                <p style="margin:0"><a href="https://matthewcawood.com/monday-music-tips/" style="display:inline-block;background:#f5c518;color:#3a2f12;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:9px">Browse the archive →</a></p>
              </td></tr>
              <tr><td style="text-align:center;padding-top:18px;font-size:12px;color:#a99d8c">Matthew Cawood · Pianist, Producer &amp; Educator</td></tr>
            </table></td></tr></table></body></html>`,
        }),
      });
    }
  } catch (e) { console.error("welcome email failed:", e); }

  return ok();
};
