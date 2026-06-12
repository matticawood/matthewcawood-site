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
    <svg class="brand-mark" viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="10" fill="#fff" stroke="#e0d5c8"/><text x="20" y="26.5" text-anchor="middle" font-family="Georgia, serif" font-size="17" font-weight="700" fill="#42382e" letter-spacing="-1">MC</text></svg>
    <span>Matthew Cawood<small>Pianist · Producer · Educator</small></span>
  </a>
  <button class="nav-toggle" aria-label="Menu" onclick="document.getElementById('nav').classList.toggle('open')"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
  <nav class="nav-links" id="nav">
    ${link("/","Home")}${link("/about/","About")}${link("/store/","Store")}${link("/monday-music-tips/","Monday Music Tips")}${link("/book-a-lesson/","Book a Lesson")}${link("/contact/","Contact")}
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
<link rel="stylesheet" href="/assets/css/site.css?v=2">${extraHead}
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
    ] },

  { slug:"beginners-guide-reading-sheet-music", title:"Beginners Guide to Reading Sheet Music", collection:"books", type:"pdf", price:1499,
    tagline:"Everything you need to start reading sheet music with confidence.",
    blurb:[
      "All the information you need to get the best possible start with reading sheet music.",
      "By the end you'll understand how to read notes and rhythms, what every symbol means, and the methods for learning to read quickly, so you can approach any piece and know exactly what to do.",
      "Available as a digital download.",
    ] },

  { slug:"playing-by-ear-theory", title:"Playing by Ear: Theory Exercises", collection:"books", type:"pdf", price:799,
    tagline:"The theory you need to start playing by ear.",
    blurb:[
      "Theory exercises designed to help you understand music well enough to start playing the piano by ear.",
      "Covers locating notes on the piano, sharps and flats, tones and semitones, major and minor scales, the three types of minor, and working out scales from a selection of notes.",
    ] },

  { slug:"30-ways-to-play-a-chord", title:"30 Ways to Play a Chord", collection:"books", type:"pdf", price:799,
    tagline:"30 patterns to play any chord more musically.",
    blurb:[
      "30 chord patterns you can use with any triad, each shown with both a C major and a D major triad.",
      "Includes several chord sequences to practise the patterns. Based on Matthew's YouTube video '30 Ways to Play a Chord'.",
    ] },

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
.product-card .cover{aspect-ratio:1/1.18;background:#0d0d0f;display:flex;align-items:center;justify-content:center;overflow:hidden;border-bottom:1px solid var(--border)}
.product-card .cover img{width:100%;height:100%;object-fit:cover;object-position:top center}
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
</style>`;

// Client script shared by store pages: localise prices + buy / free-download flow.
const storeJS = `<script>
(function(){
  var SUPA=${JSON.stringify(SUPA)}, ANON=${JSON.stringify(ANON)};
  var FN=SUPA+"/functions/v1/";
  function fmt(sym,major){ return sym + (Number.isInteger(major)?major:major.toFixed(2)); }
  // Localise any [data-price-slug] / [data-price-free] elements.
  fetch(FN+"store-checkout?action=prices",{headers:{apikey:ANON,Authorization:"Bearer "+ANON}})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){ if(!d||!d.prices)return;
      document.querySelectorAll("[data-price-slug]").forEach(function(el){
        var s=el.getAttribute("data-price-slug"), v=d.prices[s];
        if(v===0){el.textContent="Free";} else if(v){el.textContent=fmt(d.symbol,v);}
      });
    }).catch(function(){});
  // Paid buy buttons.
  document.querySelectorAll("[data-buy]").forEach(function(btn){
    btn.addEventListener("click",function(){
      var slug=btn.getAttribute("data-buy"); btn.disabled=true; var t=btn.textContent; btn.textContent="Loading…";
      fetch(FN+"store-checkout",{method:"POST",headers:{"Content-Type":"application/json",apikey:ANON,Authorization:"Bearer "+ANON},body:JSON.stringify({slug:slug,pageUrl:location.origin+location.pathname})})
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
})();
</script>`;

function productCard(p){
  const freeCls = p.price===0 ? " free" : "";
  return `<a class="product-card" href="/store/${p.slug}/">
    <div class="cover"><img src="/assets/img/store/${p.slug}.webp" alt="${esc(p.title)}" loading="lazy"></div>
    <div class="pc-body">
      <div class="pc-tag">${p.type==="course"?"Course":"PDF"}</div>
      <h3>${esc(p.title)}</h3>
      <div class="pc-foot"><span class="price${freeCls}" data-price-slug="${p.slug}">${priceLabel(p)}</span><span class="go">View →</span></div>
    </div>
  </a>`;
}

function storeIndexPage(){
  const cols = COLLECTIONS.map(c=>{
    const items = STORE.filter(p=>p.collection===c.key);
    if(!items.length) return "";
    return `<section class="store-collection"><div class="wrap">
      <div class="col-head"><h2>${c.title}</h2><p>${c.blurb}</p></div>
      <div class="product-grid">${items.map(productCard).join("")}</div>
    </div></section>`;
  }).join("");
  const body = `<section class="store-hero"><div class="wrap">
      <p class="eyebrow">The Store</p>
      <h1>Books, guides &amp; courses<br>to deepen your playing.</h1>
      <p class="lede">Downloadable resources and in-depth courses from Matthew Cawood, from free exercises to the complete Art of Understanding Music course.</p>
    </div></section>
    ${cols}
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
    <div><strong>Payment received.</strong> Check your inbox, ${p.type==="course"?"we've emailed your course access link.":"we've emailed your download link."}</div>
  </div>`;

  const body = `<section class="page-intro" style="padding-bottom:0"><div class="wrap">
      <a class="pd-back" href="/store/"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg> All products</a>
    </div></section>
    <section style="padding-top:6px"><div class="wrap">
      ${banner}
      <div class="product-detail">
        <div class="pd-cover"><img src="/assets/img/store/${p.slug}.webp" alt="${esc(p.title)}"></div>
        <div class="pd-info">
          <p class="pd-tag">${p.type==="course"?"Video Course":"Digital Download"}</p>
          <h1>${esc(p.title)}</h1>
          <p class="pd-tagline">${esc(p.tagline)}</p>
          <div class="pd-blurb">${p.blurb.map(b=>`<p>${esc(b)}</p>`).join("")}</div>
          ${buyBox}
          ${curriculum}
        </div>
      </div>
    </div></section>
    ${storeJS}
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

// ── store ──
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
