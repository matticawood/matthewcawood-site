// Contact form for the brand site — emails the enquiry to Matthew via Resend,
// with the sender set as reply-to. POST {name, email, message}.
const RESEND = process.env.RESEND_API_KEY;
const TO = "enquiries@matthewcawood.com";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fail = (c=400, m="Bad request") => ({ statusCode: c, headers, body: JSON.stringify({ error: m }) });

exports.handler = async (evt) => {
  if (evt.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (evt.httpMethod !== "POST") return fail(405, "Method not allowed");
  let name, email, message;
  try { const b = JSON.parse(evt.body || "{}");
    name = String(b.name||"").trim().slice(0,120);
    email = String(b.email||"").trim().slice(0,160);
    message = String(b.message||"").trim().slice(0,5000);
  } catch { return fail(400, "Bad JSON"); }
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !message) return fail(400, "Missing fields");
  if (!RESEND) return fail(500, "Mailer not configured");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Website Contact <noreply@matthewcawood.com>",
        to: [TO],
        reply_to: email,
        subject: `New enquiry from ${name}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1410;line-height:1.6">
          <p style="margin:0 0 6px"><strong>From:</strong> ${esc(name)} &lt;${esc(email)}&gt;</p>
          <hr style="border:none;border-top:1px solid #e0d5c8;margin:12px 0">
          <p style="white-space:pre-wrap;margin:0">${esc(message)}</p>
        </div>`,
      }),
    });
    if (!res.ok) { console.error("resend error", res.status, await res.text()); return fail(502, "Send failed"); }
  } catch (e) { console.error("contact send failed:", e); return fail(500, "Send failed"); }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
