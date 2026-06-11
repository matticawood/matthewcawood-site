// Brand-site generator: pulls PUBLISHED Monday Music Tips from Supabase and emits
// static pages — /monday-music-tips/ (archive) + /monday-music-tips/<slug>/ (each
// article) — in the cream/gold theme. Runs locally and as the Netlify build step;
// re-running regenerates everything from the DB (the source of truth).
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUPA = "https://gyskfutmncprqxazgatv.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5c2tmdXRtbmNwcnF4YXpnYXR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NjIwMTYsImV4cCI6MjA5MTMzODAxNn0.ttC3plmhbA7ls_T3w25XgYT0WBt6O3MMu0G6NrEKI9g";

const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = iso => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const year = iso => new Date(iso).getUTCFullYear();

// Deterministic dark card colour — distinct per tip, cohesive across the archive.
const CARD_BG = [
  ["#4a3f31","#2a241d","#161310"], // espresso
  ["#3a4250","#232a33","#11151b"], // charcoal blue
  ["#463046","#2b1f2e","#160f17"], // plum
  ["#314a40","#1d2a26","#0e1613"], // forest teal
  ["#4d2f31","#2e1d1f","#170d0e"], // burgundy
  ["#373451","#222033","#11101c"], // indigo
  ["#44402f","#29271c","#14130d"], // olive graphite
  ["#2f4548","#1c2a2c","#0d1416"], // deep slate teal
];
function cardBG(slug){
  let h=0; for(let i=0;i<slug.length;i++){ h=(h*31+slug.charCodeAt(i))>>>0; }
  const [a,b,c]=CARD_BG[h%CARD_BG.length];
  return `radial-gradient(130% 90% at 50% -10%, ${a} 0%, ${b} 45%, ${c} 100%)`;
}

function header(active){
  const link=(href,label)=>`<a href="${href}"${active===href?' aria-current="page"':''}>${label}</a>`;
  return `<header class="site"><div class="wrap nav">
  <a class="brand" href="/">
    <svg class="brand-mark" viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="10" fill="#fff" stroke="#e0d5c8"/><text x="20" y="26.5" text-anchor="middle" font-family="Georgia, serif" font-size="17" font-weight="700" fill="#42382e" letter-spacing="-1">MC</text></svg>
    <span>Matthew Cawood<small>Pianist · Producer · Educator</small></span>
  </a>
  <button class="nav-toggle" aria-label="Menu" onclick="document.getElementById('nav').classList.toggle('open')"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
  <nav class="nav-links" id="nav">
    ${link("/","Home")}${link("/about/","About")}${link("/monday-music-tips/","Monday Music Tips")}${link("/book-a-lesson/","Book a Lesson")}${link("/contact/","Contact")}
    <a class="cta" href="https://app.matthewcawood.com/signup">The Practice Room →</a>
  </nav></div></header>`;
}
function footer(){
  return `<footer class="site"><div class="wrap">
  <div><div class="brand-f">Matthew Cawood</div><p style="color:#cbbda9;margin:0;font-size:.95rem;max-width:300px">Pianist, producer and educator. Making music theory and technique genuinely understandable.</p></div>
  <div><h4>Explore</h4><a href="/about/">About</a><a href="/monday-music-tips/">Monday Music Tips</a><a href="/book-a-lesson/">Book a Lesson</a><a href="/contact/">Contact</a></div>
  <div><h4>The Practice Room</h4><a href="https://app.matthewcawood.com/signup">Join the app</a><a href="https://app.matthewcawood.com/">Sign in</a><a href="https://www.youtube.com/@matticawood" target="_blank" rel="noopener">YouTube</a><a href="https://www.instagram.com/matticawood" target="_blank" rel="noopener">Instagram</a></div>
  <div class="legal"><span>© ${new Date().getUTCFullYear()} Matthew Cawood. All rights reserved.</span><span>enquiries@matthewcawood.com</span></div>
</div></footer>`;
}
const newsletterCTA = `<section class="news"><div class="wrap news-inner">
  <p class="eyebrow">Free weekly email</p><h2>Get the next tip in your inbox</h2>
  <p>One short, useful idea about playing and understanding music — every Monday.</p>
  <form class="subscribe" id="subscribe-form" onsubmit="return false"><input type="email" id="sub-email" placeholder="you@email.com" autocomplete="email" required><button class="btn" type="submit" id="sub-btn">Subscribe</button></form>
  <div class="form-note" id="sub-note"></div>
</div></section>`;
const subscribeJS = `<script>(function(){var f=document.getElementById('subscribe-form');if(!f)return;var n=document.getElementById('sub-note'),b=document.getElementById('sub-btn');f.addEventListener('submit',async function(){var e=document.getElementById('sub-email').value.trim();if(!/.+@.+\\..+/.test(e)){n.textContent='Please enter a valid email.';return;}b.disabled=true;n.textContent='Subscribing…';try{var r=await fetch('/.netlify/functions/newsletter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,source:'mmt'})});n.textContent=r.ok?"You're in! Check your inbox.":'Something went wrong — try again.';if(r.ok)f.reset();}catch(_){n.textContent='Something went wrong — try again.';}b.disabled=false;});})();</script>`;
const navToggleJS = ``; // toggle is inline onclick

function shell({title, desc, body, active, extraHead=""}){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="article">
<link rel="icon" href="/assets/img/icon.webp">
<link rel="stylesheet" href="/assets/css/site.css">${extraHead}
</head><body>
${header(active)}
${body}
${footer()}
${subscribeJS}
</body></html>`;
}

function articlePage(a, newer, older){
  const nav = `<nav class="article-nav">
    ${older ? `<a class="prev" href="/monday-music-tips/${esc(older.slug)}/">← Previous tip<b>${esc(older.title)}</b></a>` : `<span></span>`}
    ${newer ? `<a class="next" href="/monday-music-tips/${esc(newer.slug)}/">Next tip →<b>${esc(newer.title)}</b></a>` : ``}
  </nav>`;
  const body = `<article>
  <div class="article-head"><div class="date">${fmtDate(a.published_at)}</div><h1>${esc(a.title)}</h1></div>
  <div class="article">${a.body_html||""}</div>
  <div class="article-foot">
    <a class="back-link" href="/monday-music-tips/"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> All Monday Music Tips</a>
    ${nav}
  </div>
</article>
${newsletterCTA}`;
  return shell({ title:`${a.title} — Monday Music Tips`, desc:a.seo_description||a.excerpt||a.title, body, active:"/monday-music-tips/" });
}

function archivePage(articles){
  const byYear = {};
  for(const a of articles){ (byYear[year(a.published_at)] ??= []).push(a); }
  const years = Object.keys(byYear).sort((x,y)=>y-x);
  const groups = years.map(y=>`<div class="year-group" data-year="${y}"><h2>${y}</h2><div class="tip-grid">
    ${byYear[y].map(a=>`<a class="tip reveal" href="/monday-music-tips/${esc(a.slug)}/" data-title="${esc((a.title||"").toLowerCase())}">
      <div class="tip-card" style="background:${cardBG(a.slug)}"><span class="tip-title">${esc(a.title)}</span></div>
      <div class="tip-meta">${fmtDate(a.published_at)}</div>
    </a>`).join("")}
  </div></div>`).join("");
  const body = `<section class="page-intro"><div class="wrap">
    <p class="eyebrow">Free weekly email</p><h1>Monday Music Tips</h1>
    <p>One short, useful idea about practice, theory or musicality — every Monday. ${articles.length} issues and counting.</p>
  </div></section>
  <section class="archive"><div class="wrap">
    <div class="archive-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input type="search" id="tip-search" placeholder="Search ${articles.length} tips…" aria-label="Search tips"></div>
    <div id="tip-results">${groups}</div>
    <div class="no-results" id="no-results">No tips match that search.</div>
  </div></section>
  ${newsletterCTA}
  <script>(function(){
    var tips=[].slice.call(document.querySelectorAll('.tip'));
    // scroll reveal
    if('IntersectionObserver' in window){
      var io=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){x.target.classList.add('visible');io.unobserve(x.target);}})},{threshold:.08,rootMargin:'0px 0px -40px 0px'});
      tips.forEach(function(t){io.observe(t);});
    } else { tips.forEach(function(t){t.classList.add('visible');}); }
    // search
    var s=document.getElementById('tip-search');if(!s)return;
    var groups=[].slice.call(document.querySelectorAll('.year-group')),nr=document.getElementById('no-results');
    s.addEventListener('input',function(){var q=s.value.trim().toLowerCase(),any=false;
      tips.forEach(function(t){var m=!q||t.getAttribute('data-title').indexOf(q)>-1;t.style.display=m?'':'none';if(m){any=true;t.classList.add('visible');}});
      groups.forEach(function(g){var vis=g.querySelectorAll('.tip:not([style*="none"])').length;g.style.display=vis?'':'none';});
      nr.style.display=any?'none':'block';});
  })();</script>`;
  return shell({ title:"Monday Music Tips — Matthew Cawood", desc:`Free weekly piano & music tips from Matthew Cawood. ${articles.length} issues on practice, theory and musicality.`, body, active:"/monday-music-tips/" });
}

// ── run ──
const res = await fetch(`${SUPA}/rest/v1/mmt_articles?select=slug,title,excerpt,body_html,cover_image,published_at,seo_description&status=eq.published&order=published_at.desc`,
  { headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` } });
if(!res.ok){ console.error("fetch failed", res.status, await res.text()); process.exit(1); }
const articles = await res.json();
console.log(`Fetched ${articles.length} published articles`);

await mkdir(join(ROOT,"monday-music-tips"), { recursive:true });
await writeFile(join(ROOT,"monday-music-tips","index.html"), archivePage(articles));
for(let i=0;i<articles.length;i++){
  const a=articles[i], newer=articles[i-1]||null, older=articles[i+1]||null;
  const dir=join(ROOT,"monday-music-tips",a.slug);
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,"index.html"), articlePage(a,newer,older));
}
console.log(`Generated archive + ${articles.length} article pages.`);
