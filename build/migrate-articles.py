#!/usr/bin/env python3
"""Migrate the 115 Monday Music Tips from the Squarespace WXR export into the
mmt_articles table, rescuing every Squarespace-CDN image into Supabase Storage.

  DRY RUN (no DB writes, no uploads — validate cleaning):
      python3 migrate-articles.py --dry [--limit N]
  REAL:
      python3 migrate-articles.py

Env (read from the app repo .env.local): SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import sys, os, re, json, html, hashlib, urllib.request, urllib.error
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
XML  = os.path.join(HERE, "export.xml")
ENV  = "/Users/matthewcawood/The Practice Room Database/.env.local"
NS = {'wp':'http://wordpress.org/export/1.2/','content':'http://purl.org/rss/1.0/modules/content/','excerpt':'http://wordpress.org/export/1.2/excerpt/'}
BUCKET = "mmt-images"

DRY = "--dry" in sys.argv
LIMIT = None
if "--limit" in sys.argv:
    LIMIT = int(sys.argv[sys.argv.index("--limit")+1])

def load_env():
    env={}
    for line in open(ENV):
        line=line.strip()
        if "=" in line and not line.startswith("#"):
            k,v=line.split("=",1); env[k]=v.strip().strip('"')
    return env
ENVV = load_env()
SUPA = ENVV["SUPABASE_URL"].rstrip("/")
SKEY = ENVV.get("SUPABASE_SERVICE_KEY") or ENVV.get("SUPABASE_SERVICE_ROLE_KEY")

# ── HTML cleaning ──────────────────────────────────────────────────────────
ALLOWED = {"p","h2","h3","h4","strong","em","b","i","u","ul","ol","li","a",
           "blockquote","hr","img","br","figure","figcaption"}
def clean_body(body, img_map):
    if not body: return ""
    h = body
    h = re.sub(r'<noscript>.*?</noscript>', '', h, flags=re.S|re.I)
    h = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', h, flags=re.S|re.I)
    # demote h1 -> h2 (article uses h1 for the title)
    h = re.sub(r'<(/?)h1\b', r'<\1h2', h, flags=re.I)
    # rewrite <img>: prefer data-src, map to local, keep alt
    def img_sub(m):
        tag=m.group(0)
        src=None
        d=re.search(r'data-src="([^"]+)"', tag) or re.search(r'src="([^"]+)"', tag)
        if d: src=d.group(1)
        if not src: return ''
        alt=re.search(r'alt="([^"]*)"', tag)
        local=img_map.get(src, src)
        return f'<img src="{local}" alt="{alt.group(1) if alt else ""}" loading="lazy">'
    h = re.sub(r'<img[^>]*>', img_sub, h, flags=re.I)
    # strip span/div wrappers (keep inner)
    h = re.sub(r'</?(?:div|span|section|figure|noscript)[^>]*>', '', h, flags=re.I)
    # strip ALL attributes except href on <a> and src/alt/loading on <img>
    def strip_attrs(m):
        tag=m.group(1).lower(); rest=m.group(2)
        if tag=='a':
            href=re.search(r'href="([^"]*)"', rest)
            return f'<a href="{href.group(1)}">' if href else '<a>'
        if tag=='img':
            return m.group(0)  # already normalised
        return f'<{m.group(3)}{tag}>'
    h = re.sub(r'<(/?)([a-zA-Z0-9]+)([^>]*)>',
               lambda m: ('</'+m.group(2).lower()+'>') if m.group(1)
                         else _open_tag(m.group(2).lower(), m.group(3)), h)
    # drop disallowed tags entirely (keep inner text)
    def drop_disallowed(m):
        t=m.group(2).lower()
        return m.group(0) if t in ALLOWED else ''
    h = re.sub(r'<(/?)([a-zA-Z0-9]+)[^>]*>', drop_disallowed, h)
    # tidy: remove empty paragraphs / headings, collapse <hr> runs and whitespace
    h = re.sub(r'<p>\s*(?:&nbsp;| |\s)*</p>', '', h, flags=re.I)
    h = re.sub(r'<(h2|h3|h4)>\s*</\1>', '', h, flags=re.I)
    h = re.sub(r'(?:\s*<hr\s*/?>\s*){2,}', '<hr>', h, flags=re.I)
    h = re.sub(r'^\s*<hr\s*/?>|<hr\s*/?>\s*$', '', h.strip(), flags=re.I)
    h = re.sub(r'[ \t]+', ' ', h)
    h = re.sub(r'\n{3,}', '\n\n', h)
    return h.strip()

def _open_tag(tag, rest):
    if tag=='a':
        href=re.search(r'href="([^"]*)"', rest)
        return f'<a href="{href.group(1)}">' if href else '<a>'
    if tag=='img':
        return '<'+tag+rest+'>'  # keep normalised img attrs
    return '<'+tag+'>'

def text_excerpt(body, n=180):
    t=re.sub(r'<[^>]+>',' ',body or ''); t=html.unescape(t)
    t=re.sub(r'\s+',' ',t).strip()
    return (t[:n].rsplit(' ',1)[0]+'…') if len(t)>n else t

# ── Supabase helpers ───────────────────────────────────────────────────────
def http(method, url, data=None, headers=None, raw=False):
    req=urllib.request.Request(url, data=data, method=method)
    for k,v in (headers or {}).items(): req.add_header(k,v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b=r.read(); return r.status, (b if raw else b.decode('utf-8','replace'))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8','replace')

_img_cache={}
def rescue_image(url):
    """Download a Squarespace image, upload to Storage, return public URL."""
    if url in _img_cache: return _img_cache[url]
    ext=re.search(r'\.(jpe?g|png|webp|gif)(?:\?|$)', url, re.I)
    ext=(ext.group(1).lower().replace('jpeg','jpg') if ext else 'jpg')
    key=hashlib.sha1(url.encode()).hexdigest()[:16]+'.'+ext
    if DRY:
        _img_cache[url]=f'[storage]/{key}'; return _img_cache[url]
    try:
        st,data=http("GET", url, headers={'User-Agent':'mmt-migrate/1.0'}, raw=True)
        if st!=200: print("   ! img fetch",st,url[:60]); return url
        ct={'jpg':'image/jpeg','png':'image/png','webp':'image/webp','gif':'image/gif'}[ext]
        up=f"{SUPA}/storage/v1/object/{BUCKET}/{key}"
        s2,_=http("POST", up, data=data, headers={'Authorization':f'Bearer {SKEY}','apikey':SKEY,'Content-Type':ct,'x-upsert':'true'}, raw=True)
        if s2 not in (200,201): print("   ! img upload",s2,key); return url
        pub=f"{SUPA}/storage/v1/object/public/{BUCKET}/{key}"
        _img_cache[url]=pub; return pub
    except Exception as e:
        print("   ! img error",e); return url

def upsert(row):
    url=f"{SUPA}/rest/v1/mmt_articles?on_conflict=slug"
    st,body=http("POST", url, data=json.dumps(row).encode(),
        headers={'Authorization':f'Bearer {SKEY}','apikey':SKEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'})
    return st,body

# ── Main ───────────────────────────────────────────────────────────────────
ch=ET.parse(XML).getroot().find('channel')
items=ch.findall('item')
def gv(it,tag): return it.findtext(tag,default='',namespaces=NS)
# attachment post_id -> url
att_by_id={}
for a in items:
    if gv(a,'wp:post_type')=='attachment':
        att_by_id[gv(a,'wp:post_id')]=gv(a,'wp:attachment_url')
posts=[it for it in items if gv(it,'wp:post_type')=='post' and gv(it,'wp:status')=='publish']
posts.sort(key=lambda it: gv(it,'wp:post_date'))
if LIMIT: posts=posts[:LIMIT]

print(f"{'DRY RUN — ' if DRY else ''}migrating {len(posts)} articles\n")
done=0
for it in posts:
    slug=gv(it,'wp:post_name'); title=(it.findtext('title') or '').strip()
    date=gv(it,'wp:post_date'); pubts=date.replace(' ','T')+'Z' if date else None
    be=it.find('content:encoded',NS); raw_body=be.text if (be is not None and be.text) else ''
    # cover via _thumbnail_id
    cover=None
    for pm in it.findall('wp:postmeta',NS):
        if pm.findtext('wp:meta_key',default='',namespaces=NS)=='_thumbnail_id':
            tid=pm.findtext('wp:meta_value',default='',namespaces=NS)
            cover=att_by_id.get(tid)
    # build image map (cover + inline body images) -> rescued URLs
    img_urls=set(re.findall(r'<img[^>]*?(?:data-src|src)="([^"]+)"', raw_body))
    img_map={u: rescue_image(u) for u in img_urls if 'squarespace-cdn' in u}
    cover_local = rescue_image(cover) if (cover and 'squarespace-cdn' in cover) else cover
    body=clean_body(raw_body, img_map)
    excerpt=text_excerpt(body)
    row={'slug':slug,'title':title,'excerpt':excerpt,'body_html':body,
         'cover_image':cover_local,'status':'published','published_at':pubts,
         'seo_description':excerpt}
    if DRY:
        if done<2:
            print(f"── {date[:10]}  {title}")
            print(f"   slug={slug}  cover={'yes' if cover_local else 'NONE'}  imgs={len(img_map)}  body={len(body)}c")
            print("   body preview:", body[:300].replace('\n',' '),"\n")
    else:
        st,b=upsert(row)
        if st not in (200,201,204): print("   ! upsert",st,b[:120],"-",slug)
    done+=1
    if not DRY and done%10==0: print(f"   …{done}/{len(posts)}")
print(f"\n{'DRY RUN complete' if DRY else 'Done'}: {done} articles, {len(_img_cache)} unique images.")
