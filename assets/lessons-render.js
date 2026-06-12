/* ──────────────────────────────────────────────────────────────────────────
   Lesson renderer — single source of truth for turning a lesson's `blocks`
   array into HTML, used by BOTH the member Courses page and Lesson Studio's
   live preview (so they can never drift).

   API:
     LessonRender.html(blocks)        -> HTML string
     LessonRender.init(rootEl, opts)  -> wires question interactions inside rootEl
                                         opts.onQuizScore(score, total) optional
     LessonRender.injectStyles()      -> add the base stylesheet once (auto-called)

   Block types: heading | text | callout | example | image | audio | task |
                divider | questions   (see 20260610_lessons.sql for the shape)
─────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Lazy-load the Mux player web component the first time a video block renders.
  let _muxLoading = false;
  function ensureMux() {
    if (_muxLoading || (window.customElements && customElements.get("mux-player"))) return;
    _muxLoading = true;
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@mux/mux-player@3";
    document.head.appendChild(s);
  }

  // ── Minimal, safe markdown → HTML (bold, italic, code, links, lists) ──
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/_([^_]+)_/g, '<em>$1</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }
  function mdToHtml(md) {
    const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
    let out = "", list = null, para = [];
    const flushPara = () => { if (para.length) { out += "<p>" + inline(para.join(" ")) + "</p>"; para = []; } };
    const flushList = () => { if (list) { out += "</" + list + ">"; list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushPara(); flushList(); continue; }
      const ul = line.match(/^[-*]\s+(.*)$/);
      const ol = line.match(/^\d+\.\s+(.*)$/);
      if (ul) { flushPara(); if (list !== "ul") { flushList(); out += "<ul>"; list = "ul"; } out += "<li>" + inline(ul[1]) + "</li>"; continue; }
      if (ol) { flushPara(); if (list !== "ol") { flushList(); out += "<ol>"; list = "ol"; } out += "<li>" + inline(ol[1]) + "</li>"; continue; }
      flushList(); para.push(line);
    }
    flushPara(); flushList();
    return out;
  }

  // ── Per-block rendering ──
  const CALLOUT_LABEL = { key: "Key idea", tip: "Tip", note: "Note", watch: "Watch out" };

  function renderQuestion(q, qi, bi) {
    const id = `lr-${bi}-${qi}`;
    const accept = q.accept ? JSON.stringify(q.accept).replace(/"/g, "&quot;") : "";
    let body = "";
    if (q.kind === "mcq") {
      body = (q.options || []).map((o, i) =>
        `<button type="button" class="lr-opt" data-i="${i}">${esc(o)}</button>`).join("");
      body = `<div class="lr-opts" data-answer="${q.answer}">${body}</div>`;
    } else if (q.kind === "truefalse") {
      body = `<div class="lr-opts" data-answer="${q.answer ? 0 : 1}">
        <button type="button" class="lr-opt" data-i="0">True</button>
        <button type="button" class="lr-opt" data-i="1">False</button></div>`;
    } else if (q.kind === "short") {
      body = `<div class="lr-short"><input type="text" class="lr-input" data-accept="${accept}" placeholder="Your answer">
        <button type="button" class="lr-check">Check</button></div>`;
    } else { // reflect
      body = `<div class="lr-reflect"><textarea class="lr-input" rows="2" placeholder="Jot your thoughts (optional)"></textarea>
        <button type="button" class="lr-done">Mark done</button></div>`;
    }
    return `<div class="lr-q" id="${id}" data-kind="${esc(q.kind)}">
      <div class="lr-q-prompt">${inline(q.prompt || "")}</div>
      ${body}
      ${q.explain ? `<div class="lr-q-explain" hidden>${inline(q.explain)}</div>` : ""}
    </div>`;
  }

  function renderBlock(b, bi) {
    switch (b && b.type) {
      case "heading":
        return `<h${b.size === 3 ? 3 : 2} class="lr-heading">${inline(b.text || "")}</h${b.size === 3 ? 3 : 2}>`;
      case "text":
        return `<div class="lr-text">${mdToHtml(b.md)}</div>`;
      case "callout":
        return `<div class="lr-callout lr-callout-${esc(b.style || "note")}">
          <div class="lr-callout-label">${esc(CALLOUT_LABEL[b.style] || "Note")}</div>
          <div class="lr-text">${mdToHtml(b.md)}</div></div>`;
      case "example":
        return `<div class="lr-example">
          ${b.title ? `<div class="lr-example-title">${esc(b.title)}</div>` : ""}
          ${b.image ? `<img class="lr-img" src="${esc(b.image)}" alt="">` : ""}
          <div class="lr-text">${mdToHtml(b.md)}</div></div>`;
      case "image":
        return `<figure class="lr-figure"><img class="lr-img" src="${esc(b.url)}" alt="${esc(b.alt || "")}">
          ${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
      case "audio":
        return `<div class="lr-audio">${b.caption ? `<div class="lr-audio-cap">${esc(b.caption)}</div>` : ""}
          <audio controls preload="none" src="${esc(b.url)}"></audio></div>`;
      case "task":
        return `<div class="lr-task"><div class="lr-task-label">Your task</div>
          <div class="lr-text">${mdToHtml(b.md)}</div>
          ${b.share ? `<button type="button" class="lr-task-share" data-share="1">Share to community</button>` : ""}</div>`;
      case "divider":
        return `<hr class="lr-divider">`;
      case "video": {
        if (!b.playbackId) return `<div class="lr-video lr-video-poster"><div class="lr-video-badge">▶ Video</div><div class="lr-video-id">Add a Mux Playback ID</div></div>`;
        // With a signed token (store delivery) render the live player; otherwise show
        // a labelled poster so signed videos don't show a broken player in previews.
        if (b.token || b.public) {
          ensureMux();
          const tok = b.token ? ` playback-token="${esc(b.token)}"` : "";
          const tt = b.thumbToken ? ` thumbnail-token="${esc(b.thumbToken)}"` : "";
          const st = b.storyboardToken ? ` storyboard-token="${esc(b.storyboardToken)}"` : "";
          return `<div class="lr-video"><mux-player playback-id="${esc(b.playbackId)}"${tok}${tt}${st} accent-color="#f5c518" style="width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;display:block;--controls:flex"></mux-player>${b.caption ? `<div class="lr-cap">${esc(b.caption)}</div>` : ""}</div>`;
        }
        return `<div class="lr-video lr-video-poster"><div class="lr-video-badge">▶ Video</div><div class="lr-video-id">Mux &middot; ${esc(b.playbackId)}</div>${b.caption ? `<div class="lr-cap">${esc(b.caption)}</div>` : ""}</div>`;
      }
      case "download": {
        const href = b.url ? esc(b.url) : "#";
        const dl = b.url ? ' target="_blank" rel="noopener" download' : ' data-download-pending="1"';
        return `<div class="lr-download"><a class="lr-download-btn" href="${href}"${dl}><span class="lr-dl-ico">&#x2913;</span><span>${esc(b.label || "Download")}</span></a>${b.note ? `<div class="lr-cap">${esc(b.note)}</div>` : ""}</div>`;
      }
      case "questions": {
        const items = (b.items || []).map((q, qi) => renderQuestion(q, qi, bi)).join("");
        if (b.mode === "quiz") {
          const n = (b.items || []).length;
          return `<div class="lr-quiz" data-quiz="${bi}">
            <div class="lr-quiz-card">
              <div class="lr-quiz-title">${esc(b.title || "Quiz")}</div>
              <div class="lr-quiz-sub">${n} question${n !== 1 ? "s" : ""}</div>
              <button type="button" class="lr-quiz-start">Start quiz</button>
            </div>
            <div class="lr-quiz-body" hidden>${items}
              <button type="button" class="lr-quiz-submit">Submit answers</button>
              <div class="lr-quiz-result" hidden></div></div>
          </div>`;
        }
        return `<div class="lr-questions">${b.title ? `<div class="lr-questions-title">${esc(b.title)}</div>` : ""}${items}</div>`;
      }
      default:
        return "";
    }
  }

  // ── Interaction wiring ──
  function markQuestion(qEl) {
    const kind = qEl.dataset.kind;
    let correct = null;
    if (kind === "mcq" || kind === "truefalse") {
      const opts = qEl.querySelector(".lr-opts");
      const sel = qEl.querySelector(".lr-opt.lr-sel");
      if (!sel) return null;
      const ans = parseInt(opts.dataset.answer, 10);
      correct = parseInt(sel.dataset.i, 10) === ans;
      qEl.querySelectorAll(".lr-opt").forEach(o => {
        const i = parseInt(o.dataset.i, 10);
        if (i === ans) o.classList.add("lr-correct");
        else if (o.classList.contains("lr-sel")) o.classList.add("lr-wrong");
        o.disabled = true;
      });
    } else if (kind === "short") {
      const inp = qEl.querySelector(".lr-input");
      let accept = [];
      try { accept = JSON.parse(inp.dataset.accept || "[]"); } catch (e) {}
      const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
      correct = accept.map(norm).includes(norm(inp.value));
      inp.classList.add(correct ? "lr-correct" : "lr-wrong");
      inp.disabled = true;
    } else { correct = null; } // reflect
    const ex = qEl.querySelector(".lr-q-explain");
    if (ex) ex.hidden = false;
    if (correct !== null) qEl.classList.add(correct ? "lr-q-correct" : "lr-q-wrong");
    return correct;
  }

  function init(root, opts) {
    opts = opts || {};
    // Option selection (mcq / truefalse)
    root.querySelectorAll(".lr-opt").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const wrap = btn.closest(".lr-opts");
        wrap.querySelectorAll(".lr-opt").forEach(o => o.classList.remove("lr-sel"));
        btn.classList.add("lr-sel");
        // inline questions auto-mark on pick
        const q = btn.closest(".lr-q");
        if (q && !q.closest(".lr-quiz-body")) markQuestion(q);
      });
    });
    // short-answer check
    root.querySelectorAll(".lr-check").forEach(b =>
      b.addEventListener("click", () => markQuestion(b.closest(".lr-q"))));
    // reflect done
    root.querySelectorAll(".lr-done").forEach(b =>
      b.addEventListener("click", () => { const q = b.closest(".lr-q"); q.classList.add("lr-q-done"); b.disabled = true; }));
    // quiz mode
    root.querySelectorAll(".lr-quiz").forEach(quiz => {
      const start = quiz.querySelector(".lr-quiz-start");
      const body = quiz.querySelector(".lr-quiz-body");
      const card = quiz.querySelector(".lr-quiz-card");
      const submit = quiz.querySelector(".lr-quiz-submit");
      const result = quiz.querySelector(".lr-quiz-result");
      if (start) start.addEventListener("click", () => { card.hidden = true; body.hidden = false; });
      if (submit) submit.addEventListener("click", () => {
        const qs = [...body.querySelectorAll(".lr-q")];
        let score = 0, gradable = 0;
        qs.forEach(q => { const r = markQuestion(q); if (r !== null) { gradable++; if (r) score++; } });
        result.hidden = false;
        result.innerHTML = `You scored <strong>${score} / ${gradable}</strong>.`;
        submit.disabled = true;
        if (opts.onQuizScore) opts.onQuizScore(score, gradable);
      });
    });
    // task share hook (page supplies behaviour)
    root.querySelectorAll(".lr-task-share").forEach(b =>
      b.addEventListener("click", () => { if (opts.onShare) opts.onShare(b.closest(".lr-task")); }));
  }

  let _styled = false;
  function injectStyles() {
    if (_styled) return; _styled = true;
    const css = `
    .lr-body{max-width:680px;margin:0 auto;line-height:1.6;color:var(--text,#1a1410)}
    .lr-heading{font-weight:800;letter-spacing:-.01em;margin:26px 0 10px;line-height:1.25}
    h2.lr-heading{font-size:1.3rem} h3.lr-heading{font-size:1.08rem}
    .lr-text{font-size:1rem;margin:0 0 4px}
    .lr-text p{margin:0 0 12px} .lr-text ul,.lr-text ol{margin:0 0 12px;padding-left:22px}
    .lr-text li{margin:4px 0} .lr-text code{background:rgba(0,0,0,.06);border-radius:4px;padding:1px 5px;font-size:.9em}
    .lr-callout{border-radius:12px;padding:14px 16px;margin:16px 0;border:1px solid var(--border,#e3e1e6);background:var(--surface-2,#f5f2ee)}
    .lr-callout-label{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;color:var(--accent-dark,#9a6f12)}
    .lr-callout-key{border-left:3px solid var(--accent,#f5c518)}
    .lr-callout-watch{border-left:3px solid #d9534f}.lr-callout-watch .lr-callout-label{color:#c0392b}
    .lr-callout-tip{border-left:3px solid #5fbf7e}.lr-callout-tip .lr-callout-label{color:#2f7d4a}
    .lr-example{border:1px solid var(--border,#e3e1e6);border-radius:12px;padding:14px 16px;margin:16px 0;background:var(--surface,#fff)}
    .lr-example-title{font-weight:700;margin-bottom:8px;font-size:.92rem}
    .lr-img{max-width:100%;height:auto;border-radius:10px;display:block;margin:4px 0}
    .lr-figure{margin:16px 0}.lr-figure figcaption{font-size:.8rem;color:var(--text-muted,#8a7868);margin-top:6px;text-align:center}
    .lr-audio{margin:16px 0}.lr-audio-cap{font-size:.85rem;color:var(--text-muted,#8a7868);margin-bottom:6px}.lr-audio audio{width:100%}
    .lr-task{border:1.5px solid var(--accent,#f5c518);border-radius:12px;padding:14px 16px;margin:18px 0;background:linear-gradient(180deg,rgba(245,197,24,.06),transparent)}
    .lr-task-label{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;color:var(--accent-dark,#9a6f12)}
    .lr-task-share{margin-top:10px;background:var(--accent,#f5c518);color:#3a2c00;border:none;border-radius:9px;padding:8px 14px;font-weight:700;font-size:.82rem;cursor:pointer}
    .lr-divider{border:none;border-top:1px solid var(--border,#e3e1e6);margin:24px 0}
    .lr-video{margin:18px 0}
    .lr-cap{font-size:.82rem;color:var(--text-muted,#8a7868);margin-top:7px;text-align:center}
    .lr-video-poster{aspect-ratio:16/9;border:1.5px dashed var(--border,#e3e1e6);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:var(--surface-2,#f5f2ee);color:var(--text-muted,#8a7868)}
    .lr-video-badge{font-weight:800;font-size:1.05rem;color:var(--accent-dark,#9a6f12)}
    .lr-video-id{font-size:.8rem}
    .lr-download{margin:16px 0}
    .lr-download-btn{display:inline-flex;align-items:center;gap:9px;background:var(--surface,#fff);border:1.5px solid var(--accent,#f5c518);border-radius:10px;padding:11px 16px;font-weight:700;font-size:.9rem;color:var(--text,#1a1410);text-decoration:none;cursor:pointer}
    .lr-download-btn:hover{background:linear-gradient(180deg,rgba(245,197,24,.1),transparent)}
    .lr-dl-ico{font-size:1.05rem;color:var(--accent-dark,#9a6f12)}
    .lr-questions,.lr-quiz{margin:18px 0}
    .lr-questions-title,.lr-quiz-title{font-weight:700;margin-bottom:10px}
    .lr-q{border:1px solid var(--border,#e3e1e6);border-radius:12px;padding:14px 16px;margin:10px 0;background:var(--surface,#fff)}
    .lr-q-prompt{font-weight:600;margin-bottom:10px}
    .lr-opts{display:flex;flex-direction:column;gap:8px}
    .lr-opt{text-align:left;background:var(--surface-2,#f5f2ee);border:1.5px solid var(--border,#e3e1e6);border-radius:9px;padding:10px 12px;font:inherit;font-size:.92rem;cursor:pointer;transition:border-color .12s,background .12s}
    .lr-opt:hover:not(:disabled){border-color:var(--accent,#f5c518)}
    .lr-opt.lr-sel{border-color:var(--accent,#f5c518)}
    .lr-opt.lr-correct{border-color:#5fbf7e;background:#eaf6ee}
    .lr-opt.lr-wrong{border-color:#d9534f;background:#fbecea}
    .lr-short{display:flex;gap:8px}.lr-input{flex:1;border:1.5px solid var(--border,#e3e1e6);border-radius:9px;padding:9px 12px;font:inherit;font-size:.92rem}
    .lr-input.lr-correct{border-color:#5fbf7e}.lr-input.lr-wrong{border-color:#d9534f}
    .lr-check,.lr-done,.lr-quiz-start,.lr-quiz-submit{background:var(--accent,#f5c518);color:#3a2c00;border:none;border-radius:9px;padding:9px 16px;font-weight:700;font-size:.85rem;cursor:pointer}
    .lr-reflect{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
    .lr-q-explain{margin-top:10px;font-size:.86rem;color:var(--text-muted,#8a7868);border-top:1px dashed var(--border,#e3e1e6);padding-top:10px}
    .lr-quiz-card{border:1.5px solid var(--accent,#f5c518);border-radius:12px;padding:18px;text-align:center;background:linear-gradient(180deg,rgba(245,197,24,.06),transparent)}
    .lr-quiz-sub{font-size:.82rem;color:var(--text-muted,#8a7868);margin:4px 0 12px}
    .lr-quiz-result{margin-top:14px;font-size:1rem}
    `;
    const el = document.createElement("style");
    el.id = "lesson-render-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  window.LessonRender = {
    html(blocks) { injectStyles(); return `<div class="lr-body">${(blocks || []).map(renderBlock).join("")}</div>`; },
    init,
    injectStyles,
    mdToHtml
  };
})();
