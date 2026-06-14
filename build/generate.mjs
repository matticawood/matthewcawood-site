// Brand-site generator: pulls PUBLISHED Monday Music Tips from Supabase and emits
// static pages, /monday-music-tips/ (archive) + /monday-music-tips/<slug>/ (each
// article), in the cream/gold theme. Runs locally and as the Netlify build step;
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

// Deterministic dark card colour, distinct per tip, cohesive across the archive.
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
    <img class="brand-mark" src="/assets/img/m-logo.webp" width="34" height="34" alt="" aria-hidden="true">
    <span>Matthew Cawood<small>Pianist · Producer · Educator</small></span>
  </a>
  <button class="nav-toggle" aria-label="Menu" onclick="document.getElementById('nav').classList.toggle('open')"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
  <nav class="nav-links" id="nav">
    ${link("/","Home")}${link("/about/","About")}${link("/store/","Store")}${link("/monday-music-tips/","Monday Music Tips")}${link("/book-a-lesson/","Book a Lesson")}<a class="nav-ico" href="/contact/" aria-label="Contact" title="Contact"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><span>Contact</span></a><a class="nav-ico" href="/account/" aria-label="My Account" title="My Account"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg><span>My Account</span></a>
    <a class="cta" href="https://app.matthewcawood.com/signup">The Practice Room →</a>
  </nav></div></header>`;
}
function footer(){
  return `<footer class="site"><div class="wrap">
  <div><div class="brand-f">Matthew Cawood</div><p style="color:#cbbda9;margin:0;font-size:.95rem;max-width:300px">Pianist, producer and educator. Making music theory and technique genuinely understandable.</p></div>
  <div><h4>Explore</h4><a href="/about/">About</a><a href="/store/">Store</a><a href="/monday-music-tips/">Monday Music Tips</a><a href="/book-a-lesson/">Book a Lesson</a><a href="/contact/">Contact</a></div>
  <div><h4>The Practice Room</h4><a href="https://app.matthewcawood.com/signup">Join the app</a><a href="https://app.matthewcawood.com/">Sign in</a><a href="https://www.youtube.com/@matticawood" target="_blank" rel="noopener">YouTube</a><a href="https://www.instagram.com/matticawood" target="_blank" rel="noopener">Instagram</a></div>
  <div class="legal"><span>© ${new Date().getUTCFullYear()} Matthew Cawood. All rights reserved.</span><span>enquiries@matthewcawood.com</span></div>
</div></footer>`;
}
const newsletterCTA = `<section class="news"><div class="wrap news-inner">
  <p class="eyebrow">Free weekly email</p><h2>Get the next tip in your inbox</h2>
  <p>One short, useful idea about playing and understanding music, every Monday.</p>
  <form class="subscribe" id="subscribe-form" onsubmit="return false"><input type="email" id="sub-email" placeholder="you@email.com" autocomplete="email" required><button class="btn" type="submit" id="sub-btn">Subscribe</button></form>
  <div class="form-note" id="sub-note"></div>
</div></section>`;
const subscribeJS = `<script>(function(){var f=document.getElementById('subscribe-form');if(!f)return;var n=document.getElementById('sub-note'),b=document.getElementById('sub-btn');f.addEventListener('submit',async function(){var e=document.getElementById('sub-email').value.trim();if(!/.+@.+\\..+/.test(e)){n.textContent='Please enter a valid email.';return;}b.disabled=true;n.textContent='Subscribing…';try{var r=await fetch('/.netlify/functions/newsletter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,source:'mmt'})});n.textContent=r.ok?"You're in! Check your inbox.":'Something went wrong, try again.';if(r.ok)f.reset();}catch(_){n.textContent='Something went wrong, try again.';}b.disabled=false;});})();</script>`;
const navToggleJS = ``; // toggle is inline onclick

function shell({title, desc, body, active, extraHead=""}){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="article">
<link rel="icon" href="/assets/img/icon.webp">
<link rel="stylesheet" href="/assets/css/site.css?v=7">${extraHead}
</head><body>
${header(active)}
${body}
${footer()}
${subscribeJS}
<script src="/assets/js/analytics.js?v=2" defer></script>
<script src="/assets/reveal.js" defer></script>
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
  return shell({ title:`${a.title}, Monday Music Tips`, desc:a.seo_description||a.excerpt||a.title, body, active:"/monday-music-tips/" });
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
    <p>One short, useful idea about practice, theory or musicality, every Monday. ${articles.length} issues and counting.</p>
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
  return shell({ title:"Monday Music Tips, Matthew Cawood", desc:`Free weekly piano & music tips from Matthew Cawood. ${articles.length} issues on practice, theory and musicality.`, body, active:"/monday-music-tips/" });
}

// ════════════════════════════════════════════════════════════════════════
//  STORE  —  digital products (course + PDFs), generated at /store
//  Catalog is the single source of truth for DISPLAY. Prices are GBP minor
//  units (pence); the store-checkout edge function localises to the buyer's
//  currency at purchase, mirroring the booking engine.
// ════════════════════════════════════════════════════════════════════════
const COLLECTIONS = [
  { key:"courses",   title:"Courses",          blurb:"In-depth video courses." },
  { key:"books",     title:"Books & Guides",   blurb:"Downloadable books and exercise collections." },
  { key:"resources", title:"Other Resources",  blurb:"Free PDFs, exercises and templates." },
];
const STORE = [
  { slug:"the-art-of-understanding-music", title:"The Art of Understanding Music", collection:"courses", type:"course", price:4999,
    tagline:"A practical framework for turning any piece into a musical performance.",
    blurb:[
      "Most pianists can learn the notes. The hard part is knowing what to do with them.",
      "The Art of Understanding Music gives you a practical framework for turning any piece into a musical performance: what to look for, what it means, and how to translate it into sound.",
    ],
    chapters:[
      ["Performance Directions","Interpreting the composer's instructions: dynamics, articulation, tempo, time signatures and markings, so your choices are intentional, not random."],
      ["Notes, Rhythms & Chords","The hidden information inside the music: keys, scales, rhythmic patterns, chord qualities, cadences and harmony, so you understand the emotional and harmonic journey."],
      ["Shaping, Phrasing & Structure","How music works like language and story: phrasing, repetition, rate of chord change, common forms, and using the three-act structure to shape direction."],
      ["Bringing It Together","Applying everything to real pieces so you can use this process on any music you're learning."],
    ],
    result:"You'll stop relying on guesswork and start playing with clearer phrasing, stronger direction and more convincing expression." },

  { slug:"beginner-sight-reading-book", title:"Beginner Sight Reading Exercises Book", collection:"books", type:"pdf", price:1499,
    tagline:"420 graded exercises to build real sight-reading fluency.",
    blurb:[
      "Enough exercises to take your sight reading to a level where you can confidently read pieces of music.",
      "Divided into three sections: 150 right-hand fundamentals, 150 left-hand fundamentals, and 120 Grade 1 level exercises. The first two sections build through six incrementally harder levels and can be worked simultaneously to develop both hands at once.",
      "Available as a digital download.",
    ], samples:["beginner-sight-reading-book-sample-1","beginner-sight-reading-book-sample-2"] },

  { slug:"beginners-guide-reading-sheet-music", title:"Beginners Guide to Reading Sheet Music", collection:"books", type:"pdf", price:1499,
    tagline:"Everything you need to start reading sheet music with confidence.",
    blurb:[
      "All the information you need to get the best possible start with reading sheet music.",
      "By the end you'll understand how to read notes and rhythms, what every symbol means, and the methods for learning to read quickly, so you can approach any piece and know exactly what to do.",
      "Available as a digital download.",
    ], samples:["beginners-guide-reading-sheet-music-sample-1","beginners-guide-reading-sheet-music-sample-2"] },

  { slug:"playing-by-ear-theory", title:"Playing by Ear: Theory Exercises", collection:"books", type:"pdf", price:799,
    tagline:"The theory you need to start playing by ear.",
    blurb:[
      "Theory exercises designed to help you understand music well enough to start playing the piano by ear.",
      "Covers locating notes on the piano, sharps and flats, tones and semitones, major and minor scales, the three types of minor, and working out scales from a selection of notes.",
    ], samples:["playing-by-ear-theory-sample-1","playing-by-ear-theory-sample-2"] },

  { slug:"30-ways-to-play-a-chord", title:"30 Ways to Play a Chord", collection:"books", type:"pdf", price:799,
    tagline:"30 patterns to play any chord more musically.",
    blurb:[
      "30 chord patterns you can use with any triad, each shown with both a C major and a D major triad.",
      "Includes several chord sequences to practise the patterns. Based on Matthew's YouTube video '30 Ways to Play a Chord'.",
    ], samples:["30-ways-to-play-a-chord-sample-1","30-ways-to-play-a-chord-sample-2"] },

  { slug:"4-fun-techniques", title:"4 Fun Techniques to Transform Your Playing", collection:"resources", type:"pdf", price:0,
    tagline:"Four exercises to level up your technique.",
    blurb:[
      "Four fun technical exercises: alternating for wrist rotation and staying relaxed, two-against-three polyrhythms, weak-finger control, and moving hand positions for accuracy.",
      "Written to accompany Matthew's YouTube video of the same name.",
    ] },

  { slug:"technical-exercises", title:"Technical Exercises to Transform Your Playing", collection:"resources", type:"pdf", price:0,
    tagline:"Seven exercises to transform your playing.",
    blurb:[
      "Seven technical exercises covering right- and left-hand runs, arpeggio flourishes and padding, weak fingers, and split focus.",
      "Play them independently, repeat them, or link all seven together. Written to accompany Matthew's YouTube video '7 Exercises to Transform Your Playing'.",
    ] },

  { slug:"4-levels-chord-patterns", title:"4 Levels of Chord Patterns", collection:"resources", type:"pdf", price:0,
    tagline:"Chord patterns from beginner to pro.",
    blurb:[
      "The notes from Matthew's YouTube video '4 Levels of Chord Patterns', taking you from working out chords to playing patterns and adding arpeggios, interesting notes and texture.",
      "Includes several chord progressions to practise the concepts at every level.",
    ] },

  { slug:"how-to-reharmonise", title:"How to Reharmonise Any Song", collection:"resources", type:"pdf", price:0,
    tagline:"Four ways to reharmonise any song.",
    blurb:[
      "The notes from Matthew's video on reharmonising songs, walking through four different methods and when to use each.",
      "Includes the example songs from the video along with Matthew's reharmonisations.",
    ] },

  { slug:"practice-planner", title:"Practice Planner Template", collection:"resources", type:"pdf", price:0,
    tagline:"The exact system Matthew used at music college.",
    blurb:[
      "Planning and evaluating your practice is one of the most effective ways to get the most from your time.",
      "This is the exact planner Matthew devised at music college to learn in two hours what was previously taking eight.",
    ] },
];

// ── Funnel helpers: authority proof, cross-sell map, membership ──────────
const MEMBERSHIP_URL = "https://app.matthewcawood.com/signup";
const AUTHORITY = [
  ["143K", "YouTube subscribers"],
  ["40M+", "Video views"],
  ["1,000s", "Students taught"],
];
// "Pairs well with" — companion products shown at full price (no discount).
const RELATED = {
  "beginner-sight-reading-book":        ["beginners-guide-reading-sheet-music","the-art-of-understanding-music"],
  "beginners-guide-reading-sheet-music":["beginner-sight-reading-book","the-art-of-understanding-music"],
  "playing-by-ear-theory":              ["30-ways-to-play-a-chord","4-levels-chord-patterns"],
  "30-ways-to-play-a-chord":            ["4-levels-chord-patterns","how-to-reharmonise"],
  "4-levels-chord-patterns":            ["30-ways-to-play-a-chord","how-to-reharmonise"],
  "how-to-reharmonise":                 ["4-levels-chord-patterns","playing-by-ear-theory"],
  "technical-exercises":                ["4-fun-techniques","the-art-of-understanding-music"],
  "4-fun-techniques":                   ["technical-exercises","the-art-of-understanding-music"],
  "practice-planner":                   ["the-art-of-understanding-music","beginner-sight-reading-book"],
  "the-art-of-understanding-music":     ["beginners-guide-reading-sheet-music","playing-by-ear-theory"],
};
const bySlug = s => STORE.find(p=>p.slug===s);

// Units sold/downloaded — combined Squarespace (pre-2026) + Shopify (2026+) totals.
const SOLD = {
  "beginner-sight-reading-book":1709, "technical-exercises":1270,
  "beginners-guide-reading-sheet-music":671, "4-levels-chord-patterns":580,
  "4-fun-techniques":361, "practice-planner":248, "how-to-reharmonise":180,
  "30-ways-to-play-a-chord":93, "the-art-of-understanding-music":51, "playing-by-ear-theory":29,
};
const TOTAL_SOLD = Object.values(SOLD).reduce((a,b)=>a+b,0); // ~5,192
const commas = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g,",");
const roundSold = n => n>=1000 ? Math.floor(n/100)*100 : n>=100 ? Math.floor(n/50)*50 : Math.floor(n/10)*10;
function soldLabel(p){
  const n = SOLD[p.slug]; if(!n) return "";
  const verb = p.price>0 ? (p.type==="course"?"enrolled":"sold") : "downloaded";
  return `${commas(roundSold(n))}+ ${verb}`;
}
const gbp = pence => pence % 100 === 0 ? `£${pence/100}` : `£${(pence/100).toFixed(2)}`;
const priceLabel = p => p.price === 0 ? "Free" : gbp(p.price);

// Scoped store styles (kept out of the shared stylesheet).
const STORE_CSS = `<style>
.store-hero{padding:64px 0 8px}
.store-hero h1{font-size:clamp(2rem,5vw,3rem);margin:0 0 12px}
.store-collection{padding:38px 0 8px}
.store-collection .col-head{display:flex;align-items:baseline;gap:14px;margin-bottom:22px;flex-wrap:wrap}
.store-collection h2{font-size:clamp(1.4rem,3vw,1.9rem);margin:0}
.store-collection .col-head p{margin:0;color:var(--muted);font-size:.95rem}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:26px}
.product-card{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.product-card:hover{transform:translateY(-4px);border-color:var(--accent);box-shadow:0 18px 40px -22px rgba(0,0,0,.8)}
.product-card .cover{aspect-ratio:640/905;background:#0d0d0f;display:flex;align-items:center;justify-content:center;overflow:hidden;border-bottom:1px solid var(--border)}
.product-card .cover img{width:100%;height:100%;object-fit:cover;object-position:center}
.product-card .pc-body{padding:16px 17px 18px;display:flex;flex-direction:column;gap:7px;flex:1}
.product-card .pc-tag{font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gold-dim)}
.product-card h3{font-size:1.04rem;line-height:1.3;margin:0}
.product-card .pc-foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;padding-top:10px}
.product-card .price{font-weight:800;font-size:1.05rem}
.product-card .price.free{color:var(--gold-dim)}
.product-card .go{font-size:.82rem;color:var(--muted);font-weight:600}
.product-detail{display:grid;grid-template-columns:minmax(0,420px) 1fr;gap:48px;align-items:start;padding-top:30px}
@media(max-width:820px){.product-detail{grid-template-columns:1fr;gap:30px}}
.product-detail .pd-cover{border:1px solid var(--border);border-radius:18px;overflow:hidden;background:#0d0d0f;position:sticky;top:96px}
.product-detail .pd-cover img{width:100%;display:block}
@media(max-width:820px){.product-detail .pd-cover{position:static;max-width:340px;margin:0 auto}}
.product-detail .pd-gallery{position:sticky;top:96px}
.product-detail .pd-gallery .pd-cover{position:relative;top:auto}
.pd-sample-badge{position:absolute;top:10px;left:10px;background:rgba(10,10,11,.82);color:var(--gold-dim);border:1px solid var(--border-2);font-size:.68rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:8px;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.pd-sample-badge[hidden]{display:none}
/* Sample pages have the blur/fade baked into the image file itself (so a right-click
   "save image" downloads the obscured version, not a clean page). This veil now only
   positions the caption over the already-faded lower area. */
.pd-sample-veil{position:absolute;left:0;right:0;bottom:0;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding-bottom:18px}
.pd-sample-veil[hidden]{display:none}
.pd-sample-veil span{font-size:.64rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-dim);background:rgba(10,10,11,.78);border:1px solid var(--border-2);padding:5px 11px;border-radius:8px}
.pd-thumb.is-sample{box-shadow:inset 0 -3px 0 var(--gold-deep)}
.pd-thumbs{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
.pd-thumb{width:62px;height:62px;border-radius:11px;overflow:hidden;border:1.5px solid var(--border);background:#0d0d0f;padding:0;cursor:pointer;transition:border-color .15s,transform .15s}
.pd-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pd-thumb:hover{transform:translateY(-2px)}
.pd-thumb.active{border-color:var(--gold-dim)}
@media(max-width:820px){.product-detail .pd-gallery{position:static;max-width:340px;margin:0 auto}.pd-thumbs{justify-content:center}}
.product-detail .pd-tag{font-size:.74rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gold-dim);margin:0 0 8px}
.product-detail h1{font-size:clamp(1.8rem,4vw,2.5rem);margin:0 0 6px;line-height:1.12}
.product-detail .pd-tagline{color:var(--muted);font-size:1.08rem;margin:0 0 22px}
.product-detail .pd-blurb p{font-size:1.02rem;line-height:1.66;color:var(--text);margin:0 0 14px}
.pd-price-row{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin:24px 0 8px;padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:14px}
.pd-price-row .price{font-size:1.7rem;font-weight:800}
.pd-price-row .price.free{color:var(--gold-dim)}
.pd-buy-note{font-size:.86rem;color:var(--muted);margin:10px 2px 0;display:flex;align-items:center;gap:7px}
.pd-buy-note svg{width:15px;height:15px;stroke:var(--gold-dim);fill:none;stroke-width:2;flex:none}
.curriculum{margin-top:40px}
.curriculum h2{font-size:1.3rem;margin:0 0 16px}
.chapter{border:1px solid var(--border);border-radius:13px;padding:16px 18px;margin-bottom:12px;background:var(--surface)}
.chapter .ch-n{font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gold-dim)}
.chapter h3{font-size:1.05rem;margin:4px 0 6px}
.chapter p{margin:0;color:var(--muted);font-size:.96rem;line-height:1.6}
.free-form{display:flex;gap:10px;flex-wrap:wrap;align-items:center;width:100%}
.free-form input{flex:1;min-width:200px;border:1.5px solid var(--border-2);background:var(--bg);border-radius:11px;padding:13px 15px;font-size:1rem;color:var(--text);font-family:inherit}
.free-form input:focus{outline:none;border-color:var(--accent)}
.store-banner{background:rgba(245,197,24,.1);border:1px solid var(--accent);border-radius:13px;padding:15px 18px;color:var(--text);margin:0 0 26px;display:flex;gap:10px;align-items:flex-start}
.store-banner svg{width:19px;height:19px;stroke:var(--accent);fill:none;stroke-width:2;flex:none;margin-top:1px}
.pd-back{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-weight:600;font-size:.9rem;text-decoration:none;margin-bottom:6px}
.pd-back:hover{color:var(--gold-dim)}
.pd-back svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2}
/* ── featured course banner ── */
.store-feature{padding:30px 0 8px}
.feat-card{display:grid;grid-template-columns:300px 1fr;gap:34px;align-items:stretch;text-decoration:none;color:var(--text);
  background:linear-gradient(110deg,rgba(245,197,24,.07),var(--surface) 55%);border:1px solid var(--border-2);border-radius:22px;padding:26px;
  transition:transform .18s ease,border-color .2s,box-shadow .25s}
.feat-card:hover{transform:translateY(-4px);border-color:rgba(245,197,24,.5);box-shadow:0 40px 80px -44px rgba(245,197,24,.18)}
.feat-cover{border-radius:14px;overflow:hidden;border:1px solid var(--border);background:#0d0d0f}
.feat-cover img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
.feat-eyebrow{font-size:.74rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--gold-dim);margin:0 0 8px}
.feat-body h2{font-size:clamp(1.5rem,3vw,2.1rem);margin:0 0 8px;line-height:1.12}
.feat-tag{color:var(--muted);font-size:1.05rem;margin:0 0 14px}
.feat-points{list-style:none;padding:0;margin:0 0 14px;display:flex;flex-wrap:wrap;gap:8px 16px}
.feat-points li{position:relative;padding-left:20px;color:var(--text);font-size:.92rem}
.feat-points li::before{content:"";position:absolute;left:0;top:7px;width:8px;height:8px;border-radius:50%;background:var(--gold-dim)}
.feat-note{color:var(--muted-2);font-size:.86rem;margin:0 0 16px;max-width:520px}
.feat-foot{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.feat-foot .price{font-size:1.6rem;font-weight:800}
.feat-go{color:var(--gold-dim);font-weight:800;font-size:.95rem}
@media(max-width:760px){.feat-card{grid-template-columns:1fr;gap:20px}.feat-cover{max-width:220px;margin:0 auto}.feat-cover img{height:auto}}
/* ── free resources section (lighter) ── */
.store-free-sec .product-grid.compact{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:18px}
.store-free-sec .product-card{background:transparent}
.store-free-sec .product-card .cover{aspect-ratio:640/905}
/* ── authority trust strip ── */
.trust-row{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0 4px}
.trust-stat{flex:1;min-width:110px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:14px 12px}
.trust-stat .tn{display:block;font-size:1.5rem;font-weight:800;color:var(--gold-dim);line-height:1}
.trust-stat .tl{display:block;font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-top:5px}
.trust-sec{padding:30px 0 8px}
.trust-cap{text-align:center;color:var(--muted);font-size:.92rem;margin:14px 0 0}
/* ── membership CTA panel ── */
.member-cta{padding:40px 0 12px}
.member-inner{display:flex;align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap;
  background:linear-gradient(110deg,#16140d,var(--surface));border:1px solid var(--border-2);border-radius:20px;padding:30px 32px;position:relative;overflow:hidden}
.member-inner::after{content:"";position:absolute;right:-50px;top:-50px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(245,197,24,.12),transparent 70%)}
.member-copy{position:relative;max-width:620px}
.member-copy h2{font-size:clamp(1.4rem,3vw,1.9rem);margin:6px 0 10px}
.member-copy p{color:var(--muted);margin:0;line-height:1.6}
.member-inner .btn{position:relative;flex:none}
@media(max-width:760px){.member-inner{padding:24px}}
/* ── reviews ── */
.stars{display:inline-flex;gap:1px;letter-spacing:1px;white-space:nowrap}
.stars .star{color:#3a3a42}
.stars .star.on{color:var(--accent)}
.pd-rating{display:inline-flex;align-items:center;gap:9px;text-decoration:none;margin:-8px 0 18px;font-size:.95rem}
.pd-rating .pd-rating-n{color:var(--muted);font-weight:600}
.reviews-sec{padding:36px 0 8px}
.reviews-sec .col-head{display:flex;align-items:baseline;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.reviews-sec h2{font-size:clamp(1.4rem,3vw,1.9rem);margin:0}
.reviews-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:26px}
.review{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
.rv-head{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.rv-name{font-weight:700;font-size:.92rem}
.rv-body{margin:0;color:var(--text);font-size:.98rem;line-height:1.6}
.rv-empty{color:var(--muted);margin:0 0 24px}
.review-form{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px 24px;max-width:560px}
.review-form h3{margin:0 0 14px;font-size:1.1rem}
.rv-stars{display:flex;gap:4px;margin-bottom:14px}
.rv-star{background:none;border:none;cursor:pointer;font-size:1.7rem;line-height:1;color:#3a3a42;padding:0;transition:color .12s}
.rv-star.on{color:var(--accent)}
.rv-fields{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.rv-fields input{flex:1;min-width:180px;border:1.5px solid var(--border-2);background:var(--bg);border-radius:11px;padding:12px 14px;font-size:1rem;color:var(--text);font-family:inherit}
.review-form textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--border-2);background:var(--bg);border-radius:11px;padding:12px 14px;font-size:1rem;color:var(--text);font-family:inherit;line-height:1.6;resize:vertical;min-height:88px}
.rv-fields input:focus,.review-form textarea:focus{outline:none;border-color:var(--accent)}
.review-form .btn{margin-top:14px}
/* ── sold-count social proof ── */
.pc-sold{font-size:.76rem;font-weight:700;color:var(--gold-dim);margin-top:-2px}
.pd-proof{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-8px 0 18px}
.pd-proof .pd-rating{margin:0}
.pd-sold{display:inline-flex;align-items:center;gap:5px;font-size:.85rem;font-weight:700;color:var(--gold-dim);background:rgba(245,197,24,.08);border:1px solid rgba(245,197,24,.22);border-radius:100px;padding:5px 12px}
/* ── price skeleton (avoids the GBP→local flash) ── */
.price-skel{display:inline-block;width:64px;height:1em;vertical-align:-2px;border-radius:6px;
  background:linear-gradient(100deg,var(--surface-2) 30%,var(--border-2) 50%,var(--surface-2) 70%);
  background-size:200% 100%;animation:priceShimmer 1.1s ease-in-out infinite}
.pd-price-row .price-skel,.feat-foot .price-skel{width:88px;height:1.2em}
@keyframes priceShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@media(prefers-reduced-motion:reduce){.price-skel{animation:none}}
</style>`;

// Client script shared by store pages: localise prices + buy / free-download flow.
const storeJS = `<script>
(function(){
  var SUPA=${JSON.stringify(SUPA)}, ANON=${JSON.stringify(ANON)};
  var FN=SUPA+"/functions/v1/";
  function fmt(sym,major){ return sym + (Number.isInteger(major)?major:major.toFixed(2)); }
  // Localise [data-price-slug] elements. Show a skeleton until the currency
  // resolves (no GBP→local flash); fall back to the rendered GBP on timeout/fail.
  var priceEls=[].slice.call(document.querySelectorAll("[data-price-slug]"));
  priceEls.forEach(function(el){ el.setAttribute("data-fallback", el.textContent); el.innerHTML='<span class="price-skel"></span>'; });
  function restore(){ priceEls.forEach(function(el){ if(el.querySelector(".price-skel")) el.textContent=el.getAttribute("data-fallback"); }); }
  var priceTimer=setTimeout(restore, 2500);
  fetch(FN+"store-checkout?action=prices",{headers:{apikey:ANON,Authorization:"Bearer "+ANON}})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){ clearTimeout(priceTimer);
      if(!d||!d.prices){ restore(); return; }
      priceEls.forEach(function(el){ var s=el.getAttribute("data-price-slug"), v=d.prices[s];
        el.textContent = (v===0) ? "Free" : (v ? fmt(d.symbol,v) : el.getAttribute("data-fallback")); });
    }).catch(function(){ clearTimeout(priceTimer); restore(); });
  // Paid buy buttons.
  document.querySelectorAll("[data-buy]").forEach(function(btn){
    btn.addEventListener("click",function(){
      var slug=btn.getAttribute("data-buy"); btn.disabled=true; var t=btn.textContent; btn.textContent="Loading…";
      window.mcTrack && window.mcTrack("checkout_click",{slug:slug});
      fetch(FN+"store-checkout",{method:"POST",headers:{"Content-Type":"application/json",apikey:ANON,Authorization:"Bearer "+ANON},body:JSON.stringify({slug:slug,vid:(window.mcVid||null),pageUrl:location.origin+location.pathname})})
        .then(function(r){return r.json();})
        .then(function(d){ if(d.url){location.href=d.url;} else {btn.disabled=false;btn.textContent=t;alert(d.error||"Something went wrong.");} })
        .catch(function(){btn.disabled=false;btn.textContent=t;alert("Something went wrong.");});
    });
  });
  // Free download form.
  var ff=document.getElementById("free-form");
  if(ff){ ff.addEventListener("submit",function(e){ e.preventDefault();
    var slug=ff.getAttribute("data-slug"), em=document.getElementById("free-email").value.trim(), note=document.getElementById("free-note"), b=ff.querySelector("button");
    if(!/.+@.+\\..+/.test(em)){note.textContent="Please enter a valid email.";return;}
    b.disabled=true; note.textContent="Sending…";
    fetch(FN+"store-free",{method:"POST",headers:{"Content-Type":"application/json",apikey:ANON,Authorization:"Bearer "+ANON},body:JSON.stringify({slug:slug,email:em})})
      .then(function(r){return r.json();})
      .then(function(d){ b.disabled=false;
        if(d.url){ note.textContent="Done! Your download is starting, and we've emailed you a copy."; window.open(d.url,"_blank"); ff.reset(); }
        else { note.textContent=d.error||"Something went wrong, please try again."; } })
      .catch(function(){ b.disabled=false; note.textContent="Something went wrong, please try again."; });
  }); }
  // Review form (star picker + submit → store-review).
  var rf=document.getElementById("review-form");
  if(rf){
    var chosen=0, stars=rf.querySelectorAll(".rv-star");
    function paint(n){ stars.forEach(function(s,i){ s.classList.toggle("on", i<n); }); }
    stars.forEach(function(s,i){
      s.addEventListener("mouseenter",function(){ paint(i+1); });
      s.addEventListener("click",function(){ chosen=i+1; paint(chosen); });
    });
    rf.addEventListener("mouseleave",function(){ paint(chosen); });
    rf.addEventListener("submit",function(e){ e.preventDefault();
      var note=document.getElementById("rv-note"), b=rf.querySelector("button[type=submit]");
      var name=rf.querySelector("[name=name]").value.trim(), email=rf.querySelector("[name=email]").value.trim(), body=rf.querySelector("[name=body]").value.trim();
      if(!chosen){ note.textContent="Please pick a star rating."; return; }
      if(!name||body.length<4){ note.textContent="Please add your name and a few words."; return; }
      b.disabled=true; note.textContent="Sending…";
      fetch(FN+"store-review",{method:"POST",headers:{"Content-Type":"application/json",apikey:ANON,Authorization:"Bearer "+ANON},body:JSON.stringify({slug:rf.getAttribute("data-slug"),name:name,email:email,rating:chosen,body:body})})
        .then(function(r){return r.json();})
        .then(function(d){ b.disabled=false;
          if(d.ok){ rf.reset(); chosen=0; paint(0); note.textContent="Thank you! Your review will appear once it's approved."; }
          else { note.textContent=d.error||"Something went wrong, please try again."; } })
        .catch(function(){ b.disabled=false; note.textContent="Something went wrong, please try again."; });
    });
  }
  // Live reviews: fetch approved reviews for this product (instant, no rebuild).
  var rMount=document.getElementById("reviews-mount"), rfEl=document.getElementById("review-form");
  if(rMount && rfEl){
    var esc=function(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");};
    var stars=function(n){var r=Math.round(n),o="";for(var i=1;i<=5;i++){o+='<span class="star'+(i<=r?' on':'')+'">★</span>';}return '<span class="stars">'+o+'</span>';};
    var rSlug=rfEl.getAttribute("data-slug");
    fetch(SUPA+"/rest/v1/store_reviews?select=name,rating,body&status=eq.approved&slug=eq."+encodeURIComponent(rSlug)+"&order=created_at.desc",{headers:{apikey:ANON,Authorization:"Bearer "+ANON}})
      .then(function(r){return r.ok?r.json():[];})
      .then(function(rows){
        if(!rows||!rows.length) return;
        var avg=rows.reduce(function(a,x){return a+x.rating;},0)/rows.length;
        var rs=document.getElementById("pd-rating-mount");
        if(rs){ rs.innerHTML='<a class="pd-rating" href="#reviews">'+stars(avg)+'<span class="pd-rating-n">'+avg.toFixed(1)+' · '+rows.length+' review'+(rows.length>1?'s':'')+'</span></a>'; }
        rMount.innerHTML='<div class="col-head"><h2>Reviews</h2></div><div class="reviews-grid">'+rows.map(function(x){return '<div class="review"><div class="rv-head">'+stars(x.rating)+'<span class="rv-name">'+esc(x.name)+'</span></div><p class="rv-body">'+esc(x.body)+'</p></div>';}).join("")+'</div>';
      }).catch(function(){});
  }
})();
</script>`;

function productCard(p){
  const freeCls = p.price===0 ? " free" : "";
  return `<a class="product-card reveal" href="/store/${p.slug}/">
    <div class="cover"><img src="/assets/img/store/${p.slug}.webp" alt="${esc(p.title)}" loading="lazy"></div>
    <div class="pc-body">
      <div class="pc-tag">${p.type==="course"?"Course":"PDF"}</div>
      <h3>${esc(p.title)}</h3>
      ${soldLabel(p)?`<div class="pc-sold">★ ${soldLabel(p)}</div>`:""}
      <div class="pc-foot"><span class="price${freeCls}" data-price-slug="${p.slug}">${priceLabel(p)}</span><span class="go">View →</span></div>
    </div>
  </a>`;
}

// Compact authority strip — social proof you can show today (no sourcing needed).
function trustRow(){
  return `<div class="trust-row">
    ${AUTHORITY.map(a=>`<div class="trust-stat"><span class="tn">${a[0]}</span><span class="tl">${a[1]}</span></div>`).join("")}
  </div>`;
}

// Flagship course, featured at the top of the storefront.
function featuredCourseBanner(){
  const c = bySlug("the-art-of-understanding-music"); if(!c) return "";
  return `<section class="store-feature"><div class="wrap">
    <a class="feat-card reveal" href="/store/${c.slug}/">
      <div class="feat-cover"><img src="/assets/img/store/${c.slug}.webp" alt="${esc(c.title)}" loading="lazy"></div>
      <div class="feat-body">
        <p class="feat-eyebrow">★ Flagship course · Video</p>
        <h2>${esc(c.title)}</h2>
        <p class="feat-tag">${esc(c.tagline)}</p>
        <ul class="feat-points">${c.chapters.map(ch=>`<li>${esc(ch[0])}</li>`).join("")}</ul>
        <p class="feat-note">Originally a 3-hour live masterclass, restructured into a step-by-step course you take at your own pace.</p>
        <div class="feat-foot"><span class="price" data-price-slug="${c.slug}">${priceLabel(c)}</span><span class="feat-go">Explore the course →</span></div>
      </div>
    </a>
  </div></section>`;
}

// "Pairs well with" — up to 3 related products at full price.
function crossSell(p){
  const rel = (RELATED[p.slug]||[]).map(bySlug).filter(Boolean).slice(0,3);
  if(!rel.length) return "";
  return `<section class="store-collection"><div class="wrap">
    <div class="col-head"><h2>Pairs well with</h2></div>
    <div class="product-grid">${rel.map(productCard).join("")}</div>
  </div></section>`;
}

// The real funnel: turn one-off buyers into recurring members.
function membershipPanel(){
  return `<section class="member-cta reveal"><div class="wrap"><div class="member-inner">
    <div class="member-copy">
      <p class="eyebrow">Go further</p>
      <h2>Keep going inside The Practice Room</h2>
      <p>Matthew's piano platform: structured practice tracking, a growing pieces library, theory guides, tools and a community — everything in these resources, taught in depth and built for how you actually learn.</p>
    </div>
    <a class="btn" href="${MEMBERSHIP_URL}">Explore The Practice Room →</a>
  </div></div></section>`;
}

// ── Reviews: fetched LIVE on the client (approved only) so newly-approved
// reviews appear instantly — no rebuild. The heading + rating + list are
// injected by storeJS only when reviews exist (nothing shown when empty).
function reviewsSection(p){
  const form = `<form class="review-form reveal" id="review-form" data-slug="${p.slug}">
      <h3>Leave a review</h3>
      <div class="rv-stars" aria-label="Your rating">${[1,2,3,4,5].map(()=>`<button type="button" class="rv-star" aria-label="Rate">★</button>`).join("")}</div>
      <div class="rv-fields">
        <input type="text" name="name" placeholder="Your name" autocomplete="name" required>
        <input type="email" name="email" placeholder="Email (optional, never shown)" autocomplete="email">
      </div>
      <textarea name="body" rows="3" placeholder="What did you think?" required></textarea>
      <button class="btn" type="submit">Submit review</button>
      <div class="form-note" id="rv-note"></div>
    </form>`;
  return `<section class="reviews-sec" id="reviews"><div class="wrap">
    <div id="reviews-mount"></div>
    ${form}
  </div></section>`;
}

function storeIndexPage(){
  const paid = STORE.filter(p=>p.price>0 && p.collection!=="courses");
  const free = STORE.filter(p=>p.price===0);
  const booksSection = paid.length ? `<section class="store-collection"><div class="wrap">
      <div class="col-head"><h2>Books &amp; Guides</h2><p>In-depth books and exercise collections — instant digital download.</p></div>
      <div class="product-grid">${paid.map(productCard).join("")}</div>
    </div></section>` : "";
  const freeSection = free.length ? `<section class="store-collection store-free-sec"><div class="wrap">
      <div class="col-head"><h2>Free resources</h2><p>Genuinely useful PDFs — pop in your email and they're yours.</p></div>
      <div class="product-grid compact">${free.map(productCard).join("")}</div>
    </div></section>` : "";
  const body = `<section class="store-hero"><div class="wrap">
      <p class="eyebrow">The Store</p>
      <h1>Books, guides &amp; courses<br>to deepen your playing.</h1>
      <p class="lede">Downloadable resources and in-depth courses from Matthew Cawood, from free exercises to the complete Art of Understanding Music course.</p>
    </div></section>
    ${featuredCourseBanner()}
    ${booksSection}
    ${freeSection}
    <section class="trust-sec reveal"><div class="wrap">${trustRow()}<p class="trust-cap">Over <strong>${commas(Math.floor(TOTAL_SOLD/100)*100)}</strong> books, courses &amp; resources in pianists' hands — and counting.</p></div></section>
    ${newsletterCTA}
    ${storeJS}`;
  return shell({ title:"Store, Matthew Cawood", desc:"Piano books, guides and courses from Matthew Cawood. Sight-reading, theory, technique and the Art of Understanding Music course.", body, active:"/store/", extraHead:STORE_CSS });
}

function storeProductPage(p){
  const isFree = p.price===0;
  const curriculum = p.chapters ? `<div class="curriculum"><h2>What's inside</h2>
    ${p.chapters.map((c,i)=>`<div class="chapter"><div class="ch-n">Chapter ${i+1}</div><h3>${esc(c[0])}</h3><p>${esc(c[1])}</p></div>`).join("")}
    ${p.result?`<p class="pd-blurb" style="margin-top:16px"><strong style="color:var(--gold-dim)">The result:</strong> ${esc(p.result)}</p>`:""}
  </div>` : "";

  const buyBox = isFree
    ? `<div class="pd-price-row">
         <span class="price free" data-price-slug="${p.slug}">Free</span>
         <form class="free-form" id="free-form" data-slug="${p.slug}">
           <input type="email" id="free-email" placeholder="you@email.com" autocomplete="email" required>
           <button class="btn" type="submit">Get it free</button>
         </form>
       </div>
       <div class="form-note" id="free-note"></div>
       <p class="pd-buy-note"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none"/><path d="M22 6l-10 7L2 6"/></svg>We'll email you the download and the occasional Monday Music Tip. Unsubscribe anytime.</p>`
    : `<div class="pd-price-row">
         <span class="price" data-price-slug="${p.slug}">${gbp(p.price)}</span>
         <button class="btn" data-buy="${p.slug}">${p.type==="course"?"Get the course":"Buy & download"}</button>
       </div>
       <p class="pd-buy-note"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>Secure checkout. ${p.type==="course"?"Instant access, watch online anytime.":"Instant digital download after payment."}</p>`;

  const banner = `<div class="store-banner" id="success-banner" style="display:none">
    <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
    <div><strong>Payment received.</strong> Check your inbox, ${p.type==="course"?"we've emailed your course access link.":"we've emailed your download link."} Want to keep going? <a href="${MEMBERSHIP_URL}" style="color:var(--gold-dim);font-weight:700">Explore The Practice Room →</a></div>
  </div>`;

  const body = `<section class="page-intro" style="padding-bottom:0"><div class="wrap">
      <a class="pd-back" href="/store/"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg> All products</a>
    </div></section>
    <section style="padding-top:6px"><div class="wrap">
      ${banner}
      <div class="product-detail">
        ${(()=>{ const items=[{s:p.slug,sample:false},...(p.gallery||[]).map(s=>({s,sample:false})),...(p.samples||[]).map(s=>({s,sample:true}))];
          if(items.length<2) return `<div class="pd-cover"><img src="/assets/img/store/${p.slug}.webp" alt="${esc(p.title)}"></div>`;
          return `<div class="pd-gallery">
            <div class="pd-cover"><img id="pd-main" src="/assets/img/store/${p.slug}.webp" alt="${esc(p.title)}"><span class="pd-sample-badge" id="pd-badge" hidden>Sample page</span><div class="pd-sample-veil" id="pd-veil" hidden><span>Full page in the download</span></div></div>
            <div class="pd-thumbs">${items.map((it,i)=>`<button type="button" class="pd-thumb${i===0?' active':''}${it.sample?' is-sample':''}" data-src="/assets/img/store/${it.s}.webp" data-sample="${it.sample?'1':'0'}" aria-label="${it.sample?'View sample page':'View image '+(i+1)}"><img src="/assets/img/store/${it.s}.webp" alt="${esc(p.title)}${it.sample?' sample page':' preview '+(i+1)}" loading="lazy"></button>`).join("")}</div>
          </div>`; })()}
        <div class="pd-info">
          <p class="pd-tag">${p.type==="course"?"Video Course":"Digital Download"}</p>
          <h1>${esc(p.title)}</h1>
          <p class="pd-tagline">${esc(p.tagline)}</p>
          <div class="pd-proof"><span id="pd-rating-mount"></span>${soldLabel(p)?`<span class="pd-sold">★ ${soldLabel(p)}</span>`:""}</div>
          <div class="pd-blurb">${p.blurb.map(b=>`<p>${esc(b)}</p>`).join("")}</div>
          ${buyBox}
          ${trustRow()}
          ${curriculum}
        </div>
      </div>
    </div></section>
    ${reviewsSection(p)}
    ${crossSell(p)}
    ${membershipPanel()}
    ${storeJS}
    <script>(function(){var m=document.getElementById("pd-main");if(!m)return;var bd=document.getElementById("pd-badge");var vl=document.getElementById("pd-veil");document.querySelectorAll(".pd-thumb").forEach(function(t){t.addEventListener("click",function(){var isSample=t.getAttribute("data-sample")==="1";m.src=t.getAttribute("data-src");if(bd)bd.hidden=!isSample;if(vl)vl.hidden=!isSample;document.querySelectorAll(".pd-thumb").forEach(function(x){x.classList.remove("active")});t.classList.add("active");});});})();</script>
    <script>if(/[?&]success=true/.test(location.search)){var b=document.getElementById("success-banner");if(b)b.style.display="flex";}</script>`;
  return shell({ title:`${p.title}, Store, Matthew Cawood`, desc:p.tagline, body, active:"/store/", extraHead:STORE_CSS });
}

// ── Course player (/store/learn) — token-gated, plays Mux-hosted lessons ──
function storeLearnPage(){
  const head = STORE_CSS + `<style>
    .learn-wrap{display:grid;grid-template-columns:1fr 330px;gap:28px;align-items:start;padding-top:22px}
    @media(max-width:920px){.learn-wrap{grid-template-columns:1fr}}
    .lesson-main{min-width:0}
    .np-mod{font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gold-dim)}
    .lesson-main h2{font-size:1.5rem;margin:5px 0 16px;line-height:1.2}
    .lesson-content{--text:#f2f1ef;--surface:#1b1b1f;--surface-2:#222228;--border:#2c2c32;--accent:#f5c518;--accent-dark:#f5c518;--text-muted:#9a9aa2}
    .lesson-content .lr-body{max-width:none}
    .ls-nav{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;position:sticky;top:96px;max-height:calc(100vh - 120px);overflow-y:auto}
    .ls-nav .nav-head{padding:15px 18px;border-bottom:1px solid var(--border);font-weight:800;font-size:.95rem}
    .mod-label{padding:14px 18px 6px;font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
    .lrow{display:flex;gap:11px;align-items:center;padding:10px 18px;cursor:pointer;border:none;background:none;width:100%;text-align:left;color:var(--text);font:inherit;border-left:3px solid transparent}
    .lrow:hover{background:var(--surface-2)} .lrow.active{background:var(--surface-2);border-left-color:var(--accent)}
    .lrow .ix{width:24px;height:24px;border-radius:50%;background:var(--bg);border:1px solid var(--border);font-size:.7rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;color:var(--muted)}
    .lrow.active .ix{background:var(--accent);color:#000;border-color:var(--accent)}
    .lrow .lt{flex:1;min-width:0;font-size:.9rem;line-height:1.3}
    .lrow .dur{font-size:.72rem;color:var(--muted);flex:none}
    .lesson-foot{display:flex;justify-content:space-between;gap:10px;margin-top:22px}
    .learn-state{max-width:560px;margin:40px auto;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:40px 28px}
    .learn-state svg{width:38px;height:38px;stroke:var(--gold-dim);fill:none;stroke-width:1.6;margin-bottom:6px}
    .learn-state h2{margin:8px 0 8px;font-size:1.4rem} .learn-state p{color:var(--muted);margin:0 auto;max-width:420px;line-height:1.6}
  </style>
  <script src="/assets/lessons-render.js?v=3"></script>`;
  const body = `<section class="page-intro" style="padding-bottom:0"><div class="wrap">
      <a class="pd-back" href="/store/"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg> Store</a>
      <p class="eyebrow" style="margin-top:10px">Course</p>
      <h1 id="course-title">Loading your course…</h1>
    </div></section>
    <section style="padding-top:6px"><div class="wrap" id="learn-root">
      <div class="learn-state"><p>Loading…</p></div>
    </div></section>
    <script>
    (function(){
      var SUPA=` + JSON.stringify(SUPA) + `, ANON=` + JSON.stringify(ANON) + `;
      var root=document.getElementById("learn-root"), titleEl=document.getElementById("course-title");
      var t=new URLSearchParams(location.search).get("t");
      var ICON_BOX='<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg>';
      function state(icon,title,msg){ root.innerHTML='<div class="learn-state">'+(icon||'')+'<h2>'+title+'</h2><p>'+msg+'</p></div>'; }
      if(!t){ titleEl.textContent="Course"; state(ICON_BOX,"Missing access link","Open the course from the link in your purchase email."); return; }
      function fmtDur(m){ return m? (m+" min"):""; }
      fetch(SUPA+"/functions/v1/store-access?token="+encodeURIComponent(t)+"&format=json",{headers:{apikey:ANON,Authorization:"Bearer "+ANON}})
        .then(function(r){return r.json();})
        .then(function(d){
          if(!d||!d.ok){ titleEl.textContent="Course"; state(ICON_BOX,"We couldn't open this course","That access link looks invalid or expired. Reopen the link from your purchase email, or contact enquiries@matthewcawood.com."); return; }
          titleEl.textContent=d.title||"Your course";
          var modules=(d.modules||[]);
          var flat=[]; modules.forEach(function(m){ (m.lessons||[]).forEach(function(l){ flat.push({mod:m.title, lesson:l}); }); });
          if(!flat.length){ state(ICON_BOX,"Course content is on its way","Your access is confirmed. The lessons are being added and will appear here shortly, you'll keep this same link."); return; }
          root.innerHTML='<div class="learn-wrap"><div class="lesson-main"><div class="np-mod" id="np-mod"></div><h2 id="np-title"></h2><div class="lesson-content" id="lesson-content"></div><div class="lesson-foot"><button class="btn btn-ghost" id="prev-l">← Previous</button><button class="btn" id="next-l">Next lesson →</button></div></div><aside class="ls-nav" id="ls-nav"></aside></div>';
          var nav=document.getElementById("ls-nav"), content=document.getElementById("lesson-content");
          var total=flat.length, html='<div class="nav-head">'+total+' lessons</div>';
          modules.forEach(function(m){ html+='<div class="mod-label">'+m.title+'</div>';
            (m.lessons||[]).forEach(function(l){ var gi=flat.findIndex(function(f){return f.lesson===l;});
              html+='<button class="lrow" data-i="'+gi+'"><span class="ix">'+(gi+1)+'</span><span class="lt">'+l.title+'</span><span class="dur">'+fmtDur(l.estMinutes)+'</span></button>'; }); });
          nav.innerHTML=html;
          var idx=0;
          function show(i){
            if(i<0||i>=total)return; idx=i; var f=flat[i], l=f.lesson;
            document.getElementById("np-mod").textContent=f.mod;
            document.getElementById("np-title").textContent=l.title;
            content.innerHTML=window.LessonRender? LessonRender.html(l.blocks||[]) : "";
            try{ LessonRender.init(content,{}); }catch(_){}
            [].forEach.call(nav.querySelectorAll(".lrow"),function(b){ b.classList.toggle("active", b.getAttribute("data-i")==String(i)); });
            document.getElementById("prev-l").style.visibility=i>0?"visible":"hidden";
            document.getElementById("next-l").style.visibility=i<total-1?"visible":"hidden";
            try{ window.scrollTo({top:0,behavior:"smooth"}); }catch(_){}
          }
          nav.addEventListener("click",function(e){ var b=e.target.closest(".lrow"); if(!b)return; show(parseInt(b.getAttribute("data-i"),10)); });
          document.getElementById("prev-l").onclick=function(){ show(idx-1); };
          document.getElementById("next-l").onclick=function(){ show(idx+1); };
          show(0);
        })
        .catch(function(){ titleEl.textContent="Course"; state(ICON_BOX,"Something went wrong","Please refresh, or reopen the link from your purchase email."); });
    })();
    </script>`;
  return shell({ title:"Course, Matthew Cawood", desc:"Watch your course from Matthew Cawood.", body, active:"/store/", extraHead:head });
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

// ── store (reviews are fetched live on the client, not at build time) ──
await mkdir(join(ROOT,"store"), { recursive:true });
await writeFile(join(ROOT,"store","index.html"), storeIndexPage());
for(const p of STORE){
  const dir=join(ROOT,"store",p.slug);
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,"index.html"), storeProductPage(p));
}
await mkdir(join(ROOT,"store","learn"), { recursive:true });
await writeFile(join(ROOT,"store","learn","index.html"), storeLearnPage());
console.log(`Generated store index + ${STORE.length} product pages + course player.`);
