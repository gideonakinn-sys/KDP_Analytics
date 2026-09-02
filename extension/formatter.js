// KDP Book Analytics — Formatter tab.
// Typesets manuscript content for Kindle / Apple Books (reflowable EPUB),
// KDP Paperback / Hardcover (print PDF) and Word (.docx), all client-side.
// Pure logic is Node-testable (formatter.test.js); browser UI is guarded
// behind activate().
(function (root) {
  "use strict";

  // ------------------------------------------------------------------
  // Targets & spec constants
  // ------------------------------------------------------------------
  var TARGETS = {
    kindle:    { label: "Kindle",      kind: "ebook", defaultTrim: null, lineSpacing: 1.0,  minPages: 10,   maxPages: null, trims: null },
    apple:     { label: "Apple Books", kind: "ebook", defaultTrim: null, lineSpacing: 1.0,  minPages: null, maxPages: null, trims: null },
    paperback: { label: "Paperback",   kind: "print", defaultTrim: "6x9", lineSpacing: 1.15, minPages: 24, maxPages: 825, trims: ["6x9", "5.5x8.5", "5x8", "7x10", "8.5x11"] },
    hardcover: { label: "Hardcover",   kind: "print", defaultTrim: "6x9", lineSpacing: 1.15, minPages: 75, maxPages: 550, trims: ["6x9", "5.5x8.5", "7x10", "8.25x11"] },
  };
  var PRINT_TRIMS = {
    "5x8":      { w: 5,    h: 8 },
    "5.5x8.5":  { w: 5.5,  h: 8.5 },
    "6x9":      { w: 6,    h: 9 },
    "7x10":     { w: 7,    h: 10 },
    "8.25x11":  { w: 8.25, h: 11 },
    "8.5x11":   { w: 8.5,  h: 11 },
  };
  var PRINT_TRIM_ORDER = ["6x9", "5.5x8.5", "5x8", "7x10", "8.5x11", "8.25x11"];

  // KDP gutter (inside margin, inches) by page count.
  function gutterFor(pages, target) {
    if (target === "hardcover") {
      if (pages <= 150) return 0.5;
      if (pages <= 300) return 0.625;
      if (pages <= 500) return 0.75;
      return 0.875;
    }
    if (pages <= 150) return 0.375;
    if (pages <= 300) return 0.5;
    if (pages <= 500) return 0.625;
    if (pages <= 700) return 0.75;
    return 0.875;
  }

  // ------------------------------------------------------------------
  // Text utils
  // ------------------------------------------------------------------
  function smartenQuotes(s) {
    return s
      .replace(/(^|[-\u2014\s(\u2018])'/g, "$1\u2018")
      .replace(/'/g, "\u2019")
      .replace(/(^|[-\u2014\s(\u201c])"/g, "$1\u201c")
      .replace(/"/g, "\u201d")
      .replace(/(?<=\w)--(?=\w)/g, "\u2013");
  }

  function normalizeText(raw) {
    var s = String(raw || "").replace(/\r\n?/g, "\n");
    s = s
      .split("\n")
      .map(function (l) { return l.replace(/^[\s\t\u00a0]+/, "").replace(/[\s\t\u00a0]+$/, ""); })
      .join("\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    s = s.replace(/[ \t]{2,}/g, " ");
    return smartenQuotes(s).trim();
  }

  function isSceneMarker(line) {
    var t = String(line || "").trim();
    if (!t) return false;
    if (/^#{1,6}$/.test(t)) return true;
    var compact = t.replace(/\s+/g, "");
    if (/^[*·]{2,}$/.test(compact)) return true;
    if (/^-{2,}$/.test(compact)) return true;
    if (/^[—–]{1,}$/.test(t)) return true;
    return false;
  }

  // Split text into paragraph units; scene breaks = 3+ blank lines or a
  // marker line (* * *, #, - - -, —). Preserves single-line info for headings.
  function parseParagraphs(raw) {
    var lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var cur = [];
    var blanks = 0;
    function flush() {
      if (cur.length) {
        out.push({ text: cur.join(" "), single: cur.length === 1 });
        cur = [];
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^[\s\t\u00a0]+/, "").replace(/[\s\t\u00a0]+$/, "");
      if (!line) {
        blanks += 1;
        if (blanks === 3) { flush(); out.push({ scene: true }); }
        continue;
      }
      if (blanks > 0) flush(); // any blank run separates paragraphs
      blanks = 0;
      if (isSceneMarker(line)) {
        flush();
        out.push({ scene: true });
        continue;
      }
      cur.push(line);
    }
    flush();
    return out;
  }

  var HEADING_RE = /^(chapter|part|prologue|epilogue|introduction|preface|foreword|afterword|acknowledg?ments)(\s|[:.\u2013\u2014-]|$)/i;

  function isChapterHeading(line) {
    var s = String(line || "").trim();
    if (!s) return false;
    if (/^#\s+\S/.test(s)) return true; // single-hash markdown chapter
    return HEADING_RE.test(s);
  }

  // Markdown subheading; `## X` / `### X` inside a chapter become an h3 subsection.
  function subheadingDepth(line) {
    var m = String(line || "").trim().match(/^(#{2,6})\s+(.+)$/);
    return m ? m[1].length : 0;
  }

  // Split a chapter heading into a prominent label ("Chapter 1"/"Part II") and
  // an optional subtitle ("The Beginning"). Bare titles become the label alone.
  function splitChapterHeading(text) {
    var s = String(text || "").replace(/^#{1,3}\s*/, "").trim();
    if (!s) return { label: "", subtitle: "" };
    function firstWord(whole) {
      var w = whole.split(/\s+/);
      w[0] = w[0].charAt(0).toUpperCase() + w[0].slice(1).toLowerCase();
      return w.join(" ");
    }
    var sep = s.match(/^(chapter|part|prologue|epilogue|introduction|preface|foreword|afterword|acknowledg(e)?ments)(?:\s+([^\s:.\u2013\u2014-]+))?\s*[:.\u2013\u2014-]\s*(.+)$/i);
    if (sep) {
      var kw = sep[1];
      var word = sep[3] ? " " + sep[3] : "";
      return { label: firstWord(kw + word), subtitle: sep[sep.length - 1].trim() };
    }
    var only = s.match(/^(chapter|part|prologue|epilogue|introduction|preface|foreword|afterword|acknowledg(e)?ments)(?:\s+([^\s:.\u2013\u2014-]+))?$/i);
    if (only) {
      var kw2 = only[1];
      var word2 = only[3] ? " " + only[3] : "";
      return { label: firstWord(kw2 + word2), subtitle: "" };
    }
    return { label: s, subtitle: "" };
  }

  function defaultCopyright(ms) {
    return "Copyright \u00a9 " + new Date().getFullYear() + (ms && ms.author ? " " + ms.author : "");
  }

  function parseManuscript(rawText, opts) {
    var units = parseParagraphs(rawText);
    var o = opts || {};
    var ms = {
      title: (o.title || "").trim(),
      author: (o.author || "").trim(),
      subtitle: (o.subtitle || "").trim(),
      copyright: (o.copyright || "").trim(),
      alsoBy: (o.alsoBy || "").trim(),
      aboutAuthor: (o.aboutAuthor || "").trim(),
      frontmatter: [],
      chapters: [],
    };
    if (!ms.copyright) ms.copyright = defaultCopyright(ms);

    var cur = null;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.scene) {
        if (cur) cur.paragraphs.push({ scene: true });
        else ms.frontmatter.push({ scene: true });
        continue;
      }
      var text = u.text.replace(/[ \t]{2,}/g, " ").trim();
      text = smartenQuotes(text);
      if (!text) continue;
      if (u.single && isChapterHeading(text)) {
        var spl = splitChapterHeading(text);
        cur = { title: text.replace(/^#{1,3}\s*/, "").trim(), label: spl.label, subtitle: spl.subtitle, paragraphs: [], subs: [] };
        ms.chapters.push(cur);
      } else if (u.single && subheadingDepth(text)) {
        var sub = text.replace(/^#{1,6}\s*/, "").trim();
        if (cur) { cur.subs.push(sub); cur.paragraphs.push({ sub: sub }); }
        else ms.frontmatter.push({ text: sub });
      } else if (cur) {
        cur.paragraphs.push({ text: text });
      } else {
        ms.frontmatter.push({ text: text });
      }
    }

    if (!ms.chapters.length) {
      ms.chapters.push({ title: "", paragraphs: ms.frontmatter.slice() });
      ms.frontmatter = [];
    }
    return ms;
  }

  // ------------------------------------------------------------------
  // Semantic HTML import (AI-assisted).
  // The AI returns ONE controlled HTML document (see buildAiPrompt); we parse
  // it into the same ms model. Safe: we never execute anything the AI emits.
  // ------------------------------------------------------------------
  function inlineFromHtml(inner) {
    return String(inner || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<(?:em|i)\b[^>]*>/gi, "*")
      .replace(/<\/(?:em|i)>/gi, "*")
      .replace(/<(?:strong|b)\b[^>]*>/gi, "**")
      .replace(/<\/(?:strong|b)>/gi, "**")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function htmlMeta(html, tag, cls) {
    var re = new RegExp("<" + tag + "[^>]*class\\s*=\\s*[\"'][^\"']*" + cls + "[^\"']*[\"'][^>]*>([\\s\\S]*?)</" + tag + ">", "i");
    var m = html.match(re);
    return m ? inlineFromHtml(m[1]) : "";
  }

  function htmlManuscriptToModel(html, opts) {
    var o = opts || {};
    var ms = {
      title: htmlMeta(html, "h1", "book-title") || (o.title || "").trim(),
      author: htmlMeta(html, "p", "book-author") || (o.author || "").trim(),
      subtitle: htmlMeta(html, "p", "book-subtitle") || (o.subtitle || "").trim(),
      copyright: htmlMeta(html, "p", "copyright") || (o.copyright || "").trim(),
      alsoBy: "",
      aboutAuthor: "",
      frontmatter: [],
      chapters: [],
    };
    if (!ms.copyright) ms.copyright = defaultCopyright(ms);

    var body = String(html || "");
    body = body.replace(/<!--[\s\S]*?-->/g, "");
    body = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    body = body.replace(/<(h1|p)[^>]*class\s*=\s*["'][^"']*(?:book-title|book-author|book-subtitle|copyright)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, "");

    var tokenRe = /<[^>]+>|[^<]+/g;
    var units = [];
    var curHeadingRaw = null;
    var curHeadingLevel = 0;
    var para = null;
    var sectionMode = null;
    var mch;
    function flushPara() {
      if (para) {
        units.push({ type: "para", kind: para.kind, text: inlineFromHtml(para.raw) });
        para = null;
      }
    }
    function flushHeading() {
      if (curHeadingRaw !== null) {
        var t = inlineFromHtml(curHeadingRaw);
        if (t && sectionMode !== "frontmatter") units.push({ type: "heading", text: t, level: curHeadingLevel });
        curHeadingRaw = null;
        curHeadingLevel = 0;
      }
    }
    function clsOf(attrs) {
      var m = (attrs || "").match(/class\s*=\s*["']([^"']+)["']/i);
      return (m && m[1]) || "";
    }
    while ((mch = tokenRe.exec(body))) {
      var tok = mch[0];
      if (tok.charAt(0) !== "<") {
        if (para) para.raw += tok;
        else if (curHeadingRaw !== null) curHeadingRaw += tok;
        continue;
      }
      var tagMatch = tok.match(/^<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*?)\s*\/?>/);
      if (!tagMatch) continue;
      var closing = tagMatch[1] === "/";
      var tag = tagMatch[2].toLowerCase();
      var attrs = tagMatch[3];
if (closing) {
        if (tag === "section") { sectionMode = null; continue; }
        if (tag === "p" || tag === "blockquote") { flushPara(); continue; }
        if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") { flushHeading(); continue; }
        if (para) para.raw += tok;
        else if (curHeadingRaw !== null) curHeadingRaw += tok;
        continue;
      }
      if (tag === "section") {
        var sc = clsOf(attrs);
        sectionMode = /chapter/.test(sc) ? "chapter" : /backmatter/.test(sc) ? "backmatter" : /frontmatter/.test(sc) ? "frontmatter" : null;
        continue;
      }
      if (tag === "hr") { flushPara(); units.push({ type: "scene" }); continue; }
      if (tag === "div") {
        if (/scene/.test(clsOf(attrs))) { flushPara(); units.push({ type: "scene" }); }
        continue;
      }
      if (tag === "blockquote") {
        flushPara();
        para = { kind: "quote", raw: "" };
        continue;
      }
      if (tag === "p") {
        if (!para) {
          var pc = clsOf(attrs);
          para = { kind: /dedication/.test(pc) ? "dedication" : /epigraph/.test(pc) ? "epigraph" : undefined, raw: "" };
        }
        continue;
      }
      if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
        flushHeading();
        curHeadingLevel = parseInt(tag.slice(1), 10) || 1;
        curHeadingRaw = "";
        continue;
      }
      if (para) para.raw += tok;
      else if (curHeadingRaw !== null) curHeadingRaw += tok;
    }
    flushPara();
    flushHeading();

    var cur = null;
    var mode = null;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.type === "scene") {
        if (cur) cur.paragraphs.push({ scene: true });
        else ms.frontmatter.push({ scene: true });
        continue;
      }
      if (u.type === "heading") {
        var t2 = u.text;
        if (u.level >= 3) {
          // In-chapter subsection (h3+)
          if (cur) { cur.subs.push(t2); cur.paragraphs.push({ sub: t2 }); }
          continue;
        }
        if (/^also\s+by/i.test(t2)) { mode = "also"; cur = null; continue; }
        if (/^about\s+the\s+author/i.test(t2)) { mode = "about"; cur = null; continue; }
        mode = null;
        var hs = splitChapterHeading(t2);
        cur = { title: t2, label: hs.label, subtitle: hs.subtitle, paragraphs: [], subs: [] };
        ms.chapters.push(cur);
        continue;
      }
      var txt = u.text;
      if (!txt) continue;
      if (mode === "also") { ms.alsoBy = ms.alsoBy ? ms.alsoBy + "\n" + txt : txt; continue; }
      if (mode === "about") { ms.aboutAuthor = ms.aboutAuthor ? ms.aboutAuthor + "\n" + txt : txt; continue; }
      if (cur) cur.paragraphs.push({ text: txt, kind: u.kind });
      else ms.frontmatter.push({ text: txt, kind: u.kind });
    }

    if (!ms.chapters.length) {
      ms.chapters.push({ title: "", paragraphs: ms.frontmatter.slice() });
      ms.frontmatter = [];
    }
    return ms;
  }

  function buildAiPrompt(opts, manuscript) {
    var header = "";
    if (opts && (opts.title || opts.author)) {
      header = "BOOK METADATA (use exactly these if provided; otherwise infer from the manuscript):\n" +
        (opts.title ? "title: " + opts.title + "\n" : "") +
        (opts.author ? "author: " + opts.author + "\n" : "") +
        "-----------------------------------\n";
    }
    return header + AI_PROMPT_TEMPLATE + "\n" + String(manuscript || "");
  }

  // Example manuscript shown by the "Try an example" button.
  var EXAMPLE_MANUSCRIPT =
    "Chapter One: The Beginning\n\n" +
    "The hero woke to the smell of rain on old stone. *Something* had changed in the night, but the world kept its secret until noon.\n\n" +
    "\n\n" +
    "By dusk the mountain swallowed the sun, and the company pressed on toward the river.\n\n" +
    "Chapter Two: The Crossing\n\n" +
    "They reached the water just after first light. It was wider than any map promised, and the ferryman asked for a name the hero no longer used.\n\n" +
    '"So be it," he said. **The name is gone**, and so is the road behind us.';

  var AI_PROMPT_TEMPLATE = [
    "You are a professional book typesetter.",
    "Your ONLY job: turn the manuscript below into ONE complete, valid HTML document, preserving every word of the content (fix only clear OCR/typo errors, straighten quotes, fix punctuation).",
    "Do NOT add, remove, or rewrite sentences. Do NOT add styles, scripts, or comments. Output ONLY the HTML document in your final message.",
    "",
    "REQUIRED STRUCTURE (exact classes):",
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Title</title></head><body>',
    '  <h1 class="book-title">Book Title</h1>',
    '  <p class="book-author">Author</p>',
    '  <p class="book-subtitle">Subtitle (optional)</p>',
    '  <p class="copyright">Copyright © YEAR AUTHOR. All rights reserved.</p>',
    '  <section class="frontmatter"><h1>Dedication</h1><p>…</p></section>',
    '  <section class="chapter">',
    "    <h1>Chapter One</h1>",
    "    <p>Paragraph text with <em>emphasis</em> and <strong>bold</strong>.</p>",
    '    <div class="scene"></div>',
    '    <p class="dedication">…</p>',
    '    <p class="epigraph">…</p>',
    "    <blockquote>Quoted passage.</blockquote>",
    '    <h3>Subsection</h3>',
    "    <p>…</p>",
    "  </section>",
    '  <section class="backmatter"><h1>About the Author</h1><p>…</p></section>',
    "</body></html>",
    "",
    "RULES:",
    "- Detect chapters even when unlabeled: a lone number, 'ONE', '1.', 'Chapter One', 'Prologue', 'Part I'. One <section class=\"chapter\"> per chapter.",
    '- Scene breaks inside a chapter = <div class="scene"></div>.',
    "- Emphasize with <em>/<strong> only where the source marks it (*italic*, **bold**, etc.).",
    "- Wrap remembered/quoted passages in <blockquote>.",
    "- Minor section headings inside a chapter = <h3>. The chapter's <h1> stays its own title (with <h2> only for a 'Chapter N: Subtitle' pattern).",
    "",
    "MANUSCRIPT:",
    "-----------------------------------",
  ].join("\n");

  function countWords(text) {
    return String(text || "").trim() ? String(text).trim().split(/\s+/).length : 0;
  }

  // Word count aware of HTML mode (tags stripped before counting).
  function wordCountOf(text, isHtml) {
    var s = String(text || "");
    if (isHtml) s = s.replace(/<[^>]+>/g, " ");
    return countWords(s);
  }

  // Heuristic: is this pasted text actually (semantic) HTML?
  function looksLikeHtml(text) {
    var s = String(text || "").trim();
    if (!s) return false;
    return /<\s*(section|main|article|div|p|h[1-6]|blockquote|table|ul|ol)(\s|\/?>)/i.test(s);
  }

  function estimatePages(text, lineSpacing, trim) {
    var t = PRINT_TRIMS[trim] || PRINT_TRIMS["6x9"];
    var areaFactor = (t.w * t.h) / (6 * 9);
    var spacingFactor = 1.15 / (lineSpacing || 1.15);
    return Math.max(1, Math.ceil(countWords(text) / (300 * areaFactor * spacingFactor)));
  }

  function fullText(ms) {
    var parts = [];
    function collect(list) {
      list.forEach(function (p) { if (p.text) parts.push(p.text); });
    }
    collect(ms.frontmatter);
    ms.chapters.forEach(function (c) { collect(c.paragraphs); });
    return parts.join("\n\n");
  }

  // Annotating body iterator: adds .noindent on first para and after scenes.
  function bodyParagraphs(paragraphs) {
    var out = [];
    var first = true;
    (paragraphs || []).forEach(function (p) {
      if (p && p.scene) {
        out.push({ scene: true });
        first = true;
        return;
      }
      if (p && p.sub) {
        out.push({ sub: p.sub });
        first = true;
        return;
      }
      out.push({ text: (p && p.text) || "", noindent: first, kind: (p && p.kind) || undefined });
      first = false;
    });
    return out;
  }

  // ------------------------------------------------------------------
  // Inline emphasis parsing (*italic* **bold** _italic_ __bold__)
  // ------------------------------------------------------------------
  function inlineTokens(text) {
    var s = String(text || "");
    var out = [];
    var last = 0;
    var re = /(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g;
    var m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ text: s.slice(last, m.index) });
      var tok = m[0];
      if (tok.charAt(0) === "*") {
        if (tok.length > 2 && tok.charAt(1) === "*") out.push({ text: tok.slice(2, -2), bold: true });
        else out.push({ text: tok.slice(1, -1), italics: true });
      } else {
        if (tok.length > 2 && tok.charAt(1) === "_") out.push({ text: tok.slice(2, -2), bold: true });
        else out.push({ text: tok.slice(1, -1), italics: true });
      }
      last = m.index + tok.length;
    }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out.length ? out : [{ text: s }];
  }

  function renderHtmlInline(text) {
    return inlineTokens(text)
      .map(function (t) {
        var h = escHtml(t.text);
        if (t.bold) return "<strong>" + h + "</strong>";
        if (t.italics) return "<em>" + h + "</em>";
        return h;
      })
      .join("");
  }

  function renderPdfInline(text) {
    return inlineTokens(text).map(function (t) {
      var o = { text: t.text };
      if (t.bold) o.bold = true;
      if (t.italics) o.italics = true;
      return o;
    });
  }

  // ------------------------------------------------------------------
  // Escaping / ids
  // ------------------------------------------------------------------
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(
      /[&<>"']/g,
      function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]; }
    );
  }
  function escHtml(s) {
    return String(s === null || s === undefined ? "" : s).replace(
      /[&<>"]/g,
      function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }
    );
  }
  function escXml(s) {
    return String(s === null || s === undefined ? "" : s).replace(
      /[&<>"']/g,
      function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]; }
    );
  }

  function genUuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    var s = "";
    for (var i = 0; i < 32; i++) s += ((Math.random() * 16) | 0).toString(16);
    return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
  }
  function sanitizeFilename(title) {
    return (title || "book").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "book";
  }

  // ------------------------------------------------------------------
  // EPUB
  // ------------------------------------------------------------------
  function chapterFileName(i) { return "chapter-" + (i + 1) + ".xhtml"; }

  function xhtmlShell(title, bodyClass, inner) {
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n' +
      "<head><meta charset=\"utf-8\"/><title>" + esc(title) + "</title>" +
      '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n' +
      '<body class="' + bodyClass + '">\n' + inner + "\n</body></html>"
    );
  }

  function parasHtml(items) {
    var subN = 0;
    return items
      .map(function (item) {
        if (item.scene) return '<p class="scene">*&nbsp;*&nbsp;*</p>';
        if (item.sub) {
          subN += 1;
          return '<h3 id="s' + subN + '">' + renderHtmlInline(item.sub) + "</h3>";
        }
        var inner = renderHtmlInline(item.text);
        if (item.kind === "quote") return '<blockquote><p class="noindent">' + inner + "</p></blockquote>";
        if (item.kind === "dedication" || item.kind === "epigraph") {
          return '<p class="' + item.kind + (item.noindent ? " noindent" : "") + '">' + inner + "</p>";
        }
        return "<p" + (item.noindent ? ' class="noindent"' : "") + ">" + inner + "</p>";
      })
      .join("\n");
  }

  function chapterXhtml(chapter) {
    var items = bodyParagraphs(chapter.paragraphs);
    var heading = "";
    if (chapter.label) heading += "<h1" + (chapter.subtitle ? ' class="with-sub"' : "") + ">" + esc(chapter.label) + "</h1>\n";
    if (chapter.subtitle) heading += "<h2>" + esc(chapter.subtitle) + "</h2>\n";
    return xhtmlShell(chapter.title || "Chapter", "chapter", heading + parasHtml(items));
  }

  function titlepageXhtml(ms) {
    var inner = "<h1>" + escHtml(ms.title || "Untitled") + "</h1>\n";
    if (ms.subtitle) inner += '<p class="subtitle">' + escHtml(ms.subtitle) + "</p>\n";
    if (ms.author) inner += "<p>" + escHtml(ms.author) + "</p>\n";
    return xhtmlShell(ms.title || "Title", "titlepage", inner);
  }

  function metaLine(ms, opts) {
    opts = opts || {};
    var parts = [];
    if (opts.isbn) parts.push("ISBN " + opts.isbn);
    if (opts.publisher) parts.push("Published by " + opts.publisher);
    if (opts.edition) parts.push(opts.edition);
    return parts.join(" · ");
  }

  function copyrightXhtml(ms, opts) {
    var inner = "<h1>Copyright</h1>\n<p class=\"noindent\">" + esc(ms.copyright || defaultCopyright(ms)) + "</p>\n<p class=\"noindent\">All rights reserved.</p>";
    var meta = metaLine(ms, opts);
    if (meta) inner += '\n<p class="noindent">' + esc(meta) + "</p>";
    return xhtmlShell(ms.title || "Copyright", "copyright", inner);
  }

  function chapterSubs(chapter) {
    var out = [];
    var n = 0;
    (chapter.paragraphs || []).forEach(function (p) {
      if (p && p.sub) {
        n += 1;
        out.push({ text: p.sub, id: "s" + n });
      }
    });
    return out;
  }

  function contentsXhtml(ms, chapters) {
    var lis = chapters
      .filter(function (c) { return c.title; })
      .map(function (c) {
        var idx = chapters.indexOf(c);
        var subs = chapterSubs(c).map(function (s) {
          return '<li><a href="' + chapterFileName(idx) + '#' + s.id + '">' + esc(s.text) + "</a></li>";
        });
        var nested = subs.length
          ? "\n        <ol>\n        " + subs.join("\n        ") + "\n        </ol>"
          : "";
        return "<li><a href=\"" + chapterFileName(idx) + "\">" + esc(c.title) + "</a>" + nested + "</li>";
      })
      .join("\n      ");
    var inner = "<h1>Contents</h1>\n      <ol>\n      " + lis + "\n      </ol>";
    return xhtmlShell(ms.title || "Contents", "contents", inner);
  }

  function frontmatterXhtml(ms) {
    return xhtmlShell(ms.title || "Front Matter", "frontmatter", parasHtml(bodyParagraphs(ms.frontmatter)));
  }

  function backmatterXhtml(ms) {
    var inner = "";
    if (ms.alsoBy) {
      inner += "<h1>Also By " + esc(ms.author || ms.title) + "</h1>\n" +
        esc(ms.alsoBy).replace(/\n+/g, "<br/>\n");
    }
    if (ms.aboutAuthor) {
      inner += "<h1>About the Author</h1>\n" +
        esc(ms.aboutAuthor).replace(/\n+/g, "<br/>\n");
    }
    return inner ? xhtmlShell(ms.title || "Back Matter", "backmatter", inner) : null;
  }

  function epubStyle(justify) {
    var align = justify !== false ? "text-align: justify;" : "text-align: left;";
    return (
      "body { font-family: serif, Georgia, \"Times New Roman\", serif; margin: 0; padding: 0 0.5em; line-height: 1.4; " + align + " hyphens: auto; -webkit-hyphens: auto; }\n" +
      ".cover img { width: 100%; max-width: 100%; height: auto; }\n" +
      ".titlepage { text-align: center; margin-top: 34%; }\n" +
      ".titlepage h1 { font-size: 1.6em; margin: 0 0 .6em; page-break-before: avoid; }\n" +
      ".titlepage .subtitle { font-size: 1.05em; font-style: italic; margin: 0 0 1.2em; text-indent: 0; }\n" +
      ".titlepage p { text-align: center; text-indent: 0; font-size: 1em; margin: .4em 0; }\n" +
      ".copyright, .backmatter { text-align: center; padding-top: 2em; } .copyright p, .backmatter p { text-align: center; text-indent: 0; } .copyright .noindent, .backmatter .noindent { text-align: center; text-indent: 0; }\n" +
      ".contents h1 { page-break-before: avoid; }\n" +
      ".contents ol { list-style: none; margin: 1.2em 0 0 0; padding: 0; }\n" +
      ".contents li { margin: .5em 0; } .contents ol ol { margin-left: 1.2em; } .contents a { text-decoration: none; color: inherit; }\n" +
      "h1, h2, h3 { break-after: avoid; page-break-after: avoid; }\n" +
      "h1 { font-size: 1.3em; text-align: center; line-height: 1.2; margin: 0 0 1.1em; break-before: page; page-break-before: always; }\n" +
      "h1.with-sub { margin-bottom: .4em; }\n" +
      "h2 { font-size: 1.05em; text-align: center; line-height: 1.25; margin: 0 0 1.2em; }\n" +
      "h3 { font-size: 1em; font-weight: bold; text-align: left; margin: 1.2em 0 .4em; break-inside: avoid; }\n" +
      "p { text-indent: 1.2em; margin: 0; orphans: 2; widows: 2; }\n" +
      "p.noindent { text-indent: 0; }\n" +
      "p.scene { text-indent: 0; text-align: center; margin: .9em 0; letter-spacing: .3em; }\n" +
      "blockquote { margin: .8em 1.5em; } blockquote p { text-indent: 0; font-style: italic; }\n" +
      "p.dedication, p.epigraph { text-indent: 0; text-align: center; font-style: italic; }\n" +
      "img { max-width: 100%; height: auto; } figure { margin: 1em 0; text-align: center; break-inside: avoid; page-break-inside: avoid; }\n" +
      "em { font-style: italic; } strong { font-weight: bold; }\n"
    );
  }

  function contentOpf(ms, chapters, extra, uuid) {
    extra = extra || {};
    var manifest = [];
    var spine = [];
    var manifestOnly = function (id, href, type, props) {
      var prop = props ? ' properties="' + props + '"' : "";
      manifest.push('<item id="' + id + '" href="' + href + '" media-type="' + type + '"' + prop + "/>");
    };
    var reading = function (id, href) {
      manifest.push('<item id="' + id + '" href="' + href + '" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="' + id + '"/>');
    };
    manifestOnly("nav", "nav.xhtml", "application/xhtml+xml", "nav");
    manifestOnly("ncx", "toc.ncx", "application/x-dtbncx+xml");
    manifestOnly("css", "style.css", "text/css");
    if (extra.hasCover) {
      var mime = extra.coverExt === "png" ? "image/png" : extra.coverExt === "gif" ? "image/gif" : "image/jpeg";
      manifestOnly("cover-img", "images/cover." + extra.coverExt, mime, "cover-image");
      reading("cover", "cover.xhtml");
    }
    reading("titlepage", "titlepage.xhtml");
    reading("copyright", "copyrightpage.xhtml");
    reading("contents", "contents.xhtml");
    if (extra.hasFront) reading("frontmatter", "frontmatter.xhtml");
    for (var i = 0; i < chapters.length; i++) reading("ch" + (i + 1), chapterFileName(i));
    if (extra.hasBack) reading("backmatter", "backmatter.xhtml");
    var mod = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    var creator = ms.author ? "<dc:creator>" + esc(ms.author) + "</dc:creator>\n  " : "";
    var ident = extra.isbn ? "urn:isbn:" + esc(extra.isbn) : "urn:uuid:" + uuid;
    var pub = extra.publisher ? "    <dc:publisher>" + esc(extra.publisher) + "</dc:publisher>\n" : "";
    var date = extra.edition ? "    <dc:date>" + esc(extra.edition) + "</dc:date>\n" : "";
    var coverMeta = extra.hasCover ? '    <meta name="cover" content="cover-img"/>\n' : "";
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n' +
      "  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n" +
      "    <dc:identifier id=\"bookid\">" + ident + "</dc:identifier>\n" +
      "    <dc:title>" + esc(ms.title || "Untitled") + "</dc:title>\n" +
      "    " + creator +
      pub +
      date +
      "    <dc:language>en</dc:language>\n" +
      coverMeta +
      '    <meta property="dcterms:modified">' + mod + "</meta>\n" +
      '    <meta property="ibooks:version">1.0</meta>\n' +
      "  </metadata>\n" +
      "  <manifest>\n    " + manifest.join("\n    ") + "\n  </manifest>\n" +
      "  <spine>\n    " + spine.join("\n    ") + "\n  </spine>\n" +
      "</package>"
    );
  }

  function navXhtml(ms, chapters) {
    var lis = chapters
      .filter(function (c) { return c.title; })
      .map(function (c) {
        var idx = chapters.indexOf(c);
        var subs = chapterSubs(c).map(function (s) {
          return '<li><a href="' + chapterFileName(idx) + '#' + s.id + '">' + esc(s.text) + "</a></li>";
        });
        var nested = subs.length
          ? "\n      <ol>\n      " + subs.join("\n      ") + "\n      </ol>\n    "
          : "";
        return "<li><a href=\"" + chapterFileName(idx) + "\">" + esc(c.title) + "</a>" + nested + "</li>";
      })
      .join("\n      ");
    var inner = '<nav epub:type="toc" id="toc">\n      <h1>Contents</h1>\n      <ol>\n      ' + lis + "\n      </ol>\n    </nav>";
    return xhtmlShell(ms.title || "Contents", "nav", inner);
  }

  function tocNcx(ms, chapters, uuid) {
    var order = 0;
    var points = chapters
      .filter(function (c) { return c.title; })
      .map(function (c, i) {
        var idx = chapters.indexOf(c);
        order += 1;
        var po = order;
        var nested = chapterSubs(c).map(function (s) {
          order += 1;
          return (
            '<navPoint id="navpoint-sub-' + (i + 1) + "-" + s.id + '" playOrder="' + order + '">' +
            "<navLabel><text>" + esc(s.text) + "</text></navLabel>" +
            '<content src="' + chapterFileName(idx) + '#' + s.id + '"/>' +
            "</navPoint>"
          );
        }).join("");
        return (
          '<navPoint id="navpoint-' + (i + 1) + '" playOrder="' + po + '">' +
          "<navLabel><text>" + esc(c.title) + "</text></navLabel>" +
          '<content src="' + chapterFileName(idx) + '"/>' +
          nested +
          "</navPoint>"
        );
      })
      .join("\n    ");
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
      "  <head>\n" +
      '    <meta name="dtb:uid" content="' + uuid + '"/>\n' +
      '    <meta name="dtb:depth" content="1"/>\n' +
      '    <meta name="dtb:totalPageCount" content="0"/>\n' +
      '    <meta name="dtb:maxPageNumber" content="0"/>\n' +
      "  </head>\n" +
      "  <docTitle><text>" + esc(ms.title || "Untitled") + "</text></docTitle>\n" +
      "  <navMap>\n    " + points + "\n  </navMap>\n" +
      "</ncx>"
    );
  }

  function coverExtOf(cover) {
    var mime = (cover && cover.mime) || "";
    if (/png/i.test(mime)) return "png";
    if (/gif/i.test(mime)) return "gif";
    return "jpg";
  }

  function epubFiles(ms, opts) {
    opts = opts || {};
    var uuid = genUuid();
    var hasFront = ms.frontmatter && ms.frontmatter.length > 0;
    var back = backmatterXhtml(ms);
    var hasBack = !!back;
    var hasCover = !!(opts.cover && opts.cover.dataUrl);
    var files = {};
    files["mimetype"] = "application/epub+zip";
    files["META-INF/container.xml"] =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      "  <rootfiles>\n" +
      '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
      "  </rootfiles>\n" +
      "</container>";
    files["OEBPS/content.opf"] = contentOpf(
      ms,
      ms.chapters,
      {
        hasFront: hasFront,
        hasBack: hasBack,
        hasCover: hasCover,
        coverExt: hasCover ? coverExtOf(opts.cover) : null,
        isbn: opts.isbn || "",
        publisher: opts.publisher || "",
        edition: opts.edition || "",
      },
      uuid
    );
    if (hasCover) {
      var b64 = String(opts.cover.dataUrl).split(",")[1] || "";
      files["OEBPS/images/cover." + coverExtOf(opts.cover)] = { b64: true, data: b64 };
      files["OEBPS/cover.xhtml"] =
        xhtmlShell(ms.title || "Cover", "cover", '<img src="images/cover.' + coverExtOf(opts.cover) + '" alt="Cover"/>');
    }
    files["OEBPS/nav.xhtml"] = navXhtml(ms, ms.chapters);
    files["OEBPS/toc.ncx"] = tocNcx(ms, ms.chapters, uuid);
    files["OEBPS/style.css"] = epubStyle(opts.justify);
    files["OEBPS/titlepage.xhtml"] = titlepageXhtml(ms);
    files["OEBPS/copyrightpage.xhtml"] = copyrightXhtml(ms, opts);
    files["OEBPS/contents.xhtml"] = contentsXhtml(ms, ms.chapters);
    if (hasFront) files["OEBPS/frontmatter.xhtml"] = frontmatterXhtml(ms);
    for (var i = 0; i < ms.chapters.length; i++) {
      files["OEBPS/" + chapterFileName(i)] = chapterXhtml(ms.chapters[i]);
    }
    if (hasBack) files["OEBPS/backmatter.xhtml"] = back;
    return files;
  }

  function buildEpub(ms, opts) {
    var files = epubFiles(ms, opts);
    var JSZipLib = root.JSZip;
    if (!JSZipLib) throw new Error("JSZip not loaded");
    var zip = new JSZipLib();
    zip.file("mimetype", files["mimetype"], { compression: "STORE" });
    zip.file("META-INF/container.xml", files["META-INF/container.xml"]);
    Object.keys(files).forEach(function (path) {
      if (path === "mimetype" || path === "META-INF/container.xml") return;
      var v = files[path];
      zip.file(path, v && v.b64 ? v.data : v, v && v.b64 ? { base64: true } : undefined);
    });
    return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  }

  // ------------------------------------------------------------------
  // DOCX (real Word document via JSZip)
  // ------------------------------------------------------------------
  function wRunTxt(text) {
    return '<w:r><w:t xml:space="preserve">' + escXml(text) + "</w:t></w:r>";
  }
  function wRuns(text, forceItalic) {
    return inlineTokens(text)
      .map(function (t) {
        var rpr = (t.bold ? "<w:b/>" : "") + (t.italics || forceItalic ? "<w:i/>" : "");
        var p = rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "";
        return "<w:r>" + p + '<w:t xml:space="preserve">' + escXml(t.text) + "</w:t></w:r>";
      })
      .join("");
  }
  function wPara(pPr, runsXml) {
    return "<w:p>" + (pPr || "") + runsXml + "</w:p>";
  }
  function wBodyPara(text, extraPPr) {
    return wPara('<w:pPr><w:pStyle w:val="BodyText"/>' + (extraPPr || "") + "</w:pPr>", wRuns(text || ""));
  }

  function docxFiles(ms, opts) {
    opts = opts || {};
    var isPrint = opts.target && (TARGETS[opts.target] || {}).kind === "print";
    var trimInfo = isPrint && opts.trim ? PRINT_TRIMS[opts.trim] || null : null;
    var gutterTwips = 0;
    if (trimInfo) {
      var est = estimatePages(fullText(ms), opts.lineSpacing || (TARGETS[opts.target] || {}).lineSpacing || 1.15, opts.trim);
      gutterTwips = Math.round(gutterFor(est, opts.target) * 1440);
    }
    var pgW = trimInfo ? Math.round(trimInfo.w * 1440) : 12240;
    var pgH = trimInfo ? Math.round(trimInfo.h * 1440) : 15840;
    var body = [];
    function para(style, runs) {
      return wPara('<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>', runs);
    }
    body.push(para("Title", wRunTxt(ms.title || "Untitled")));
    if (ms.subtitle) body.push(para("Subtitle", wRunTxt(ms.subtitle)));
    if (ms.author) body.push(para("Author", wRunTxt(ms.author)));

    // Copyright
    body.push(para("ContentsTitle", wRunTxt("Copyright")));
    body.push(wPara('<w:pPr><w:pStyle w:val="BodyText"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>', wRunTxt(ms.copyright || defaultCopyright(ms))));
    body.push(wPara('<w:pPr><w:pStyle w:val="BodyText"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>', wRunTxt("All rights reserved.")));
    var cpMeta = metaLine(ms, opts);
    if (cpMeta) body.push(wPara('<w:pPr><w:pStyle w:val="BodyText"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>', wRunTxt(cpMeta)));

    // Contents
    body.push(para("ContentsTitle", wRunTxt("Contents")));
    ms.chapters.forEach(function (ch) {
      if (!ch.title) return;
      body.push(para("ContentsText", wRunTxt(ch.title)));
    });

    // Chapters
    ms.chapters.forEach(function (ch) {
      if (ch.label) body.push(para("Heading1", wRunTxt(ch.label)));
      if (ch.subtitle) body.push(para("Heading2", wRunTxt(ch.subtitle)));
bodyParagraphs(ch.paragraphs).forEach(function (item) {
        if (item.sub) {
          body.push(para("Heading3", wRunTxt(item.sub)));
          return;
        }
        if (item.scene) {
          body.push(wPara('<w:pPr><w:pStyle w:val="BodyText"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>', wRunTxt("* * *")));
          return;
        }
        var extra = "", jc = "", forceI = false;
        if (item.kind === "quote") extra = '<w:ind w:left="720" w:firstLine="0"/>';
        else if (item.kind === "dedication" || item.kind === "epigraph") { extra = '<w:ind w:firstLine="0"/>'; jc = '<w:jc w:val="center"/>'; forceI = true; }
        else if (item.noindent) extra = '<w:ind w:firstLine="0"/>';
        body.push(wPara('<w:pPr><w:pStyle w:val="BodyText"/>' + extra + jc + "</w:pPr>", wRuns(item.text, forceI)));
      });
    });

    // Back matter
    if (ms.alsoBy) {
      body.push(para("Heading1", wRunTxt(ms.author ? "Also By " + ms.author : "Also By")));
      ms.alsoBy.split(/\n+/).filter(Boolean).forEach(function (l) { body.push(wBodyPara(l, '<w:ind w:firstLine="0"/>')); });
    }
    if (ms.aboutAuthor) {
      body.push(para("Heading1", wRunTxt("About the Author")));
      ms.aboutAuthor.split(/\n+/).filter(Boolean).forEach(function (l) { body.push(wBodyPara(l, '<w:ind w:firstLine="0"/>')); });
    }

    var documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
      "<w:body>\n" + body.join("\n") + "\n" +
      '<w:sectPr><w:pgSz w:w="' + pgW + '" w:h="' + pgH + '"/><w:pgMar w:left="1080" w:right="1080" w:top="1080" w:bottom="1080" w:gutter="' + gutterTwips + '"/></w:sectPr>' +
      "</w:body>\n</w:document>";

    var stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="Author"><w:name w:val="author"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="480"/></w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:jc w:val="center"/><w:spacing w:before="360" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="26"/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="body text"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="360"/><w:jc w:val="both"/><w:spacing w:line="276" w:lineRule="auto" w:widowControl="1"/></w:pPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="ContentsTitle"><w:name w:val="contents title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>\n' +
      '<w:style w:type="paragraph" w:styleId="ContentsText"><w:name w:val="contents text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>\n' +
      "</w:styles>";

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>";

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";

    return {
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": rootRels,
      "word/document.xml": documentXml,
      "word/styles.xml": stylesXml,
    };
  }

  function buildDocx(ms, opts) {
    var JSZipLib = root.JSZip;
    if (!JSZipLib) throw new Error("JSZip not loaded");
    var zip = new JSZipLib();
    var files = docxFiles(ms, opts);
    Object.keys(files).forEach(function (p) { zip.file(p, files[p]); });
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // ------------------------------------------------------------------
  // PDF (print) via pdfmake
  // ------------------------------------------------------------------
  function pdfDocDefinition(ms, opts, gutterOverride) {
    var target = TARGETS[opts.target] || TARGETS.paperback;
    var trim = PRINT_TRIMS[opts.trim] || PRINT_TRIMS[target.defaultTrim || "6x9"] || PRINT_TRIMS["6x9"];
    var spacing = opts.lineSpacing || target.lineSpacing || 1.15;
    var fontSize = opts.fontSize || 11;
    var estPages = estimatePages(fullText(ms), spacing, opts.trim);
    var gutter = gutterOverride != null ? gutterOverride : gutterFor(estPages, opts.target);
    var margins = [gutter * 72, 0.75 * 72, 0.75 * 72, 0.75 * 72];

    var content = [];

    // Cover page (optional)
    if (opts.cover && opts.cover.dataUrl) {
      content.push({ image: opts.cover.dataUrl, fit: [Math.round(trim.w * 72), Math.round(trim.h * 72)], alignment: "center" });
      content.push({ text: "", pageBreak: "after" });
    }

    // Title page
    content.push({ text: ms.title || "Untitled", style: "titleTitle" });
    if (ms.subtitle) content.push({ text: ms.subtitle, style: "titleSubtitle" });
    content.push({ text: ms.author || "", style: "titleAuthor" });
    content.push({ text: "", pageBreak: "after" });

    // Copyright page
    content.push({ text: "Copyright", style: "sectTitle" });
    content.push({ text: ms.copyright || defaultCopyright(ms), style: "bodyNoIndent", alignment: "center" });
    content.push({ text: "All rights reserved.", style: "bodyNoIndent", alignment: "center" });
    var meta = metaLine(ms, opts);
    if (meta) content.push({ text: meta, style: "bodyNoIndent", alignment: "center" });
    content.push({ text: "", pageBreak: "after" });

    // Front matter (dedication / epigraph)
    if (ms.frontmatter.length) {
      bodyParagraphs(ms.frontmatter).forEach(function (item) {
        if (item.scene) { content.push({ text: "* * *", style: "dinkus" }); return; }
        var st = item.kind === "quote" ? "blockquote" : item.kind === "dedication" || item.kind === "epigraph" ? "dedication" : "bodyNoIndent";
        content.push({ text: renderPdfInline(item.text), style: st });
      });
      content.push({ text: "", pageBreak: "after" });
    }

    // Contents (native pdfmake TOC with page numbers)
    content.push({
      toc: {
        title: { text: "Contents", style: "tocTitle" },
        textStyle: { fontSize: 11, color: "#333" },
      },
    });

    // Chapters
    ms.chapters.forEach(function (ch) {
      if (ch.label) content.push({ text: ch.label, style: "chapterTitle", tocItem: { text: ch.title || ch.label }, pageBreak: "before" });
      if (ch.subtitle) content.push({ text: ch.subtitle, style: "chapterSubtitle" });
      bodyParagraphs(ch.paragraphs).forEach(function (item) {
        if (item.sub) { content.push({ text: renderPdfInline(item.sub), style: "chapterSubheader" }); return; }
        if (item.scene) { content.push({ text: "* * *", style: "dinkus" }); return; }
        if (item.kind === "quote") { content.push({ text: renderPdfInline(item.text), style: "blockquote" }); return; }
        if (item.kind === "dedication" || item.kind === "epigraph") { content.push({ text: renderPdfInline(item.text), style: "dedication" }); return; }
        content.push({ text: renderPdfInline(item.text), style: item.noindent ? "bodyNoIndent" : "body" });
      });
    });

    // Back matter
    if (ms.alsoBy) {
      content.push({ text: ms.author ? "Also By " + ms.author : "Also By", style: "backTitle", tocItem: true, pageBreak: "before" });
      ms.alsoBy.split(/\n+/).filter(Boolean).forEach(function (l) { content.push({ text: l, style: "bodyNoIndent" }); });
    }
    if (ms.aboutAuthor) {
      content.push({ text: "About the Author", style: "backTitle", tocItem: true, pageBreak: "before" });
      ms.aboutAuthor.split(/\n+/).filter(Boolean).forEach(function (l) { content.push({ text: l, style: "bodyNoIndent" }); });
    }

    return {
      pageSize: { width: Math.round(trim.w * 72), height: Math.round(trim.h * 72) },
      pageMargins: margins,
      defaultStyle: {
        font: "Serif",
        fontSize: fontSize,
        lineHeight: spacing,
        color: "#111820",
        alignment: "justify",
        orphans: 2,
        widows: 2,
      },
      content: content,
      styles: {
        titleTitle: { fontSize: 24, bold: true, alignment: "center", margin: [0, 150, 0, 8] },
        titleSubtitle: { fontSize: 13, italics: true, alignment: "center", margin: [0, 0, 0, 12] },
        titleAuthor: { fontSize: 14, alignment: "center", margin: [0, 0, 0, 20] },
        sectTitle: { fontSize: 15, bold: true, alignment: "center", margin: [0, 0, 0, 16] },
        tocTitle: { fontSize: 15, bold: true, alignment: "center", margin: [0, 0, 0, 16] },
        chapterTitle: { fontSize: 16, bold: true, alignment: "center", margin: [0, 0, 0, 4] },
        chapterSubtitle: { fontSize: 13, alignment: "center", margin: [0, 0, 0, 14] },
        chapterSubheader: { fontSize: 12, bold: true, alignment: "left", margin: [0, 10, 0, 4] },
        backTitle: { fontSize: 16, bold: true, alignment: "center", margin: [0, 0, 0, 14] },
        body: { textIndent: Math.round(0.25 * 72), margin: [0, 0, 0, 8] },
        bodyNoIndent: { margin: [0, 0, 0, 8] },
        blockquote: { margin: [24, 0, 24, 10], italics: true },
        dedication: { alignment: "center", italics: true, margin: [0, 6, 0, 14] },
        dinkus: { alignment: "center", margin: [0, 8, 0, 12], fontSize: fontSize },
      },
      header: function (currentPage) {
        if (currentPage === 1) return { text: "", alignment: "center", fontSize: 9 };
        var t = currentPage % 2 === 0 ? (ms.title || "") : (ms.author || "");
        return { text: t || "", alignment: "center", fontSize: 9, color: "#666" };
      },
      footer: function (currentPage) {
        if (currentPage === 1) return { text: "", alignment: "center", fontSize: 9 };
        return { text: String(currentPage - 1), alignment: "center", fontSize: 9, color: "#888" };
      },
    };
  }

  function pageCountFromPdfBuffer(buf) {
    try {
      var s;
      if (typeof TextDecoder !== "undefined") s = new TextDecoder("latin1").decode(new Uint8Array(buf));
      else s = String(buf);
      var n = (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
      return n > 0 ? n : null;
    } catch (e) {
      return null;
    }
  }

  function buildPdf(ms, opts, done) {
    if (!root.pdfMake) throw new Error("pdfmake not loaded");
    var finish = function (gutter) {
      root.pdfMake.createPdf(pdfDocDefinition(ms, opts, gutter)).getBlob(done);
    };
    var fallback = function () { finish(null); };
    if (!root.pdfMake.createPdf || !root.pdfMake.createPdf(pdfDocDefinition(ms, opts, 0.5)).getBuffer) { fallback(); return; }
    try {
      root.pdfMake.createPdf(pdfDocDefinition(ms, opts, 0.5)).getBuffer(
        function (buf) {
          var pages = pageCountFromPdfBuffer(buf) || estimatePages(fullText(ms), opts.lineSpacing || 1.15, opts.trim);
          finish(gutterFor(pages, opts.target));
        },
        fallback
      );
    } catch (e) {
      fallback();
    }
  }

  // ------------------------------------------------------------------
  // Browser UI
  // ------------------------------------------------------------------
  function activate() {
    if (!root.document) return;
    var container = root.document.getElementById("formatter-body");
    if (!container) return;
    if (container.querySelector(".kdp-fmt-root")) return;

    var ui = { target: "kindle", trim: "6x9", spacing: 1.0, lastResult: null };

    container.innerHTML =
      '<div class="kdp-fmt-root">' +
      '<div class="kdp-fmt-scroll">' +
      '<div class="kdp-section">Target format</div>' +
      '<div class="kdp-targets">' +
      Object.keys(TARGETS)
        .map(function (k) {
          return '<button type="button" class="kdp-pill" data-target="' + k + '" aria-pressed="false" title="' + TARGETS[k].label + '">' + TARGETS[k].label + "</button>";
        })
        .join("") +
      "</div>" +
      '<div class="kdp-section">Book</div>' +
      '<div class="kdp-opts">' +
      '<div class="kdp-field"><label for="kdp-fmt-title">Title</label><input id="kdp-fmt-title" type="text" placeholder="Book title" /></div>' +
      '<div class="kdp-field"><label for="kdp-fmt-author">Author</label><input id="kdp-fmt-author" type="text" placeholder="Author name" /></div>' +
      '<div class="kdp-field"><label for="kdp-fmt-subtitle">Subtitle</label><input id="kdp-fmt-subtitle" type="text" /></div>' +
      '<div class="kdp-field" style="grid-column:1 / -1">' +
      '<input type="file" id="kdp-fmt-cover" accept="image/*" hidden />' +
      '<label class="kdp-muted" for="kdp-fmt-cover-btn">Cover image (EPUB/PDF)</label>' +
      '<button type="button" class="kdp-btn" id="kdp-fmt-cover-btn">Add cover</button>' +
      '<div id="kdp-fmt-cover-preview"></div>' +
      "</div>" +
      "</div>" +
      "<details class=\"kdp-about\"><summary>Front &amp; back matter</summary>" +
      '<div class="kdp-opts" style="margin-top:8px">' +
      '<div class="kdp-field"><label for="kdp-fmt-copyright">Copyright line</label><input id="kdp-fmt-copyright" type="text" placeholder="Auto: © <year> <author>" /></div>' +
      '<div class="kdp-field"><label for="kdp-fmt-isbn">ISBN</label><input id="kdp-fmt-isbn" type="text" placeholder="Optional, e.g. 9781234567890" /></div>' +
      '<div class="kdp-field"><label for="kdp-fmt-publisher">Publisher</label><input id="kdp-fmt-publisher" type="text" /></div>' +
      '<div class="kdp-field"><label for="kdp-fmt-edition">Edition / Year</label><input id="kdp-fmt-edition" type="text" placeholder="e.g. First Edition, 2026" /></div>' +
      '<div class="kdp-field" style="grid-column:1 / -1"><label for="kdp-fmt-also">Also By</label><textarea id="kdp-fmt-also" rows="2" placeholder="Optional. E.g., The First Book, The Second Book"></textarea></div>' +
      '<div class="kdp-field" style="grid-column:1 / -1"><label for="kdp-fmt-about">About the Author</label><textarea id="kdp-fmt-about" rows="3" placeholder="Optional bio"></textarea></div>' +
      "</div></details>" +
      '<div class="kdp-section">Content</div>' +
      '<div class="kdp-path">' +
      '<button type="button" class="kdp-path-btn active" data-path="raw">✍️ Paste my manuscript</button>' +
      '<button type="button" class="kdp-path-btn" data-path="ai">🤖 Let AI structure it</button>' +
      "</div>" +
      '<select id="kdp-fmt-mode" hidden><option value="raw">raw</option><option value="ai">ai</option></select>' +
      '<div id="kdp-fmt-wizard" hidden>' +
      '<div class="kdp-wizard-step"><b>1</b> Paste your manuscript below</div>' +
      '<div class="kdp-wizard-step"><b>2</b> Copy the AI prompt, run it in your AI</div>' +
      '<div class="kdp-wizard-step"><b>3</b> Paste the returned HTML below — auto-detected</div>' +
      "</div>" +
      '<textarea id="kdp-fmt-text" rows="10" placeholder="Paste your manuscript here. Chapters: \"Chapter 1\", \"Part I\", \"Prologue\", \"Introduction\" or Markdown # Heading. Result sections: three blank lines (or a line of * * *) between scenes; *italic* and **bold**."></textarea>' +
      '<div class="kdp-tip" id="kdp-fmt-tip">' +
      '<span>New here? Paste your manuscript, pick a format, and hit <b>Format</b> — or let AI structure a messy draft first.</span>' +
      '<button type="button" id="kdp-fmt-tip-dismiss" title="Dismiss">✕</button>' +
      "</div>" +
      '<button type="button" class="kdp-btn" id="kdp-fmt-example">✨ Try an example</button>' +
      '<div class="kdp-wc-row"><span class="kdp-muted" id="kdp-fmt-wc" aria-live="polite"></span></div>' +
      '<div class="kdp-fmt-row">' +
      '<button type="button" class="kdp-btn" id="kdp-fmt-prompt">Copy AI prompt</button>' +
      '<span class="kdp-muted" id="kdp-fmt-prompt-name"></span>' +
      "</div>" +
      '<div class="kdp-section">Options</div>' +
      '<div class="kdp-opts">' +
      '<div class="kdp-field kdp-print-only"><label for="kdp-fmt-trim">Trim size</label><select id="kdp-fmt-trim"></select></div>' +
      '<div class="kdp-field kdp-print-only"><label for="kdp-fmt-spacing">Line spacing</label><select id="kdp-fmt-spacing"><option value="1">Single (1.0)</option><option value="1.15">1.15</option><option value="1.5">1.5</option></select></div>' +
      '<div class="kdp-field kdp-ebook-only"><label class="kdp-check"><input id="kdp-fmt-justify" type="checkbox" checked /> Justify body text</label></div>' +
      "</div>" +
      '<button type="button" class="kdp-btn kdp-btn-primary" id="kdp-fmt-run">Format</button>' +
      '<div id="kdp-fmt-results" hidden>' +
      '<div id="kdp-fmt-summary" class="kdp-summary-row">' +
      '<div class="kdp-summary-text">' +
      '<div id="kdp-fmt-done" class="kdp-alert kdp-alert-success" aria-live="polite"></div>' +
      '<div id="kdp-fmt-notes" aria-live="polite"></div>' +
      '<details id="kdp-fmt-structure" class="kdp-structure" open>' +
      "<summary>Structure</summary>" +
      '<div id="kdp-fmt-structure-body"></div>' +
      "</details>" +
      "</div>" +
      '<button type="button" id="kdp-fmt-summary-dismiss" title="Dismiss summary" aria-label="Dismiss">✕</button>' +
      "</div>" +
      '<div class="kdp-downloads">' +
      '<button type="button" class="kdp-dl" data-ext="docx" disabled>Download DOCX</button>' +
      '<button type="button" class="kdp-dl" data-ext="pdf" disabled>Download PDF</button>' +
      '<button type="button" class="kdp-dl" data-ext="epub" disabled>Download EPUB</button>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";

    var textEl = container.querySelector("#kdp-fmt-text");
    var files = {};
    ["title", "author", "trim", "spacing", "subtitle", "copyright", "isbn", "publisher", "edition", "also", "about"].forEach(function (n) {
      files[n] = container.querySelector("#kdp-fmt-" + n);
    });
    var modeEl = container.querySelector("#kdp-fmt-mode");
    var promptBtn = container.querySelector("#kdp-fmt-prompt");
    var promptRow = promptBtn.parentNode;
    var promptNameEl = container.querySelector("#kdp-fmt-prompt-name");
    var wcEl = container.querySelector("#kdp-fmt-wc");
    var runBtn = container.querySelector("#kdp-fmt-run");
    var resultsEl = container.querySelector("#kdp-fmt-results");
    var doneEl = container.querySelector("#kdp-fmt-done");
    var notesEl = container.querySelector("#kdp-fmt-notes");
    var summaryEl = container.querySelector("#kdp-fmt-summary");
    var summaryDismiss = container.querySelector("#kdp-fmt-summary-dismiss");
    var structureEl = container.querySelector("#kdp-fmt-structure-body");
    var dlButtons = Array.prototype.slice.call(container.querySelectorAll(".kdp-dl"));
    var pillButtons = Array.prototype.slice.call(container.querySelectorAll(".kdp-pill"));
    var pathButtons = Array.prototype.slice.call(container.querySelectorAll(".kdp-path-btn"));
    var wizardEl = container.querySelector("#kdp-fmt-wizard");
    var tipEl = container.querySelector("#kdp-fmt-tip");
    var tipDismiss = container.querySelector("#kdp-fmt-tip-dismiss");
    var exampleBtn = container.querySelector("#kdp-fmt-example");
    var justifyEl = container.querySelector("#kdp-fmt-justify");
    var coverInput = container.querySelector("#kdp-fmt-cover");
    var coverBtn = container.querySelector("#kdp-fmt-cover-btn");
    var coverPreview = container.querySelector("#kdp-fmt-cover-preview");
    var tipDismissed = false;
    var uiCover = null;

    function setPills(targetKey) {
      pillButtons.forEach(function (b) {
        var on = b.dataset.target === targetKey;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function refillTrims() {
      var t = TARGETS[ui.target];
      var list = t.trims && t.trims.length ? t.trims : PRINT_TRIM_ORDER;
      files.trim.innerHTML = list
        .map(function (k) { return '<option value="' + k + '"' + (k === ui.trim ? " selected" : "") + ">Book " + k.replace("x", "×") + "</option>"; })
        .join("");
      if (t.kind === "print" && files.trim.options.length) {
        if (list.indexOf(ui.trim) === -1) ui.trim = list[0];
        files.trim.value = ui.trim;
      }
    }

    function applyModeHint() {
      var ai = modeEl.value === "ai";
      textEl.placeholder = ai
        ? 'Paste the HTML your AI returned. To generate it, switch back to "✍️ Paste my manuscript" and use the AI prompt.'
        : 'Paste your manuscript here. Chapters: "Chapter 1", "Part I", "Prologue", "Introduction" or Markdown # Heading. Result sections: three blank lines (or a line of * * *) between scenes; *italic* and **bold**.';
      syncPathUI();
      updatePrintVisibility();
      updatePromptVisibility();
      updateTip();
    }

    function syncPathUI() {
      pathButtons.forEach(function (b) { b.classList.toggle("active", b.dataset.path === modeEl.value); });
      if (wizardEl) wizardEl.hidden = modeEl.value !== "ai";
      if (exampleBtn) exampleBtn.style.display = modeEl.value === "raw" ? "" : "none";
    }

    function updateTip() {
      if (!tipEl) return;
      var visible = !tipDismissed && modeEl.value === "raw" && !String(textEl.value || "").trim();
      tipEl.style.display = visible ? "" : "none";
    }

    function updatePromptVisibility() {
      // Relevant until HTML is present: hide only for AI-mode with HTML already pasted.
      if (!promptRow) return;
      promptRow.style.display = modeEl.value === "ai" && looksLikeHtml(textEl.value) ? "none" : "";
    }

    function updatePrintVisibility() {
      var isPrint = TARGETS[ui.target].kind === "print";
      files.trim.parentElement.style.display = isPrint ? "" : "none";
      files.spacing.parentElement.style.display = isPrint ? "" : "none";
      if (justifyEl) justifyEl.parentElement.style.display = isPrint ? "none" : "";
    }

    var wcTimer = null;
    function updateWordCount() {
      if (!wcTimer) wcTimer = setTimeout(function () { wcTimer = null; updateWordCountNow(); }, 120);
    }
    function updateWordCountNow() {
      wcEl.textContent = wordCountOf(textEl.value, modeEl.value === "ai") + " words";
    }

    function setModeAuto(txt) {
      if (modeEl.value === "raw" && looksLikeHtml(txt)) {
        modeEl.value = "ai";
        applyModeHint();
        wcEl.textContent = "Detected HTML — input set to AI-formatted HTML.";
      }
    }

    var draftTimer = null;
    function onChange() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveDraft, 500);
    }
    function saveDraft() {
      try {
        chrome.storage.local.set({
          kdpFmtDraft: {
            text: textEl.value,
            mode: modeEl.value,
            target: ui.target,
            trim: ui.trim,
            spacing: ui.spacing,
            justify: justifyEl ? justifyEl.checked : true,
            title: files.title.value.trim(),
            author: files.author.value.trim(),
            subtitle: files.subtitle.value.trim(),
            copyright: files.copyright.value.trim(),
            isbn: files.isbn.value.trim(),
            publisher: files.publisher.value.trim(),
            edition: files.edition.value.trim(),
            also: files.also.value.trim(),
            about: files.about.value.trim(),
          },
        });
      } catch (e) { /* ignore */ }
    }

    function wireDraft() {
      textEl.addEventListener("input", function () { setModeAuto(textEl.value); updateWordCount(); updateTip(); onChange(); });
      ["title", "author", "subtitle", "copyright", "isbn", "publisher", "edition", "also", "about"].forEach(function (n) {
        files[n].addEventListener("input", onChange);
      });
      files.trim.addEventListener("change", function () { ui.trim = files.trim.value; onChange(); });
      files.spacing.addEventListener("change", function () { ui.spacing = parseFloat(files.spacing.value) || 1.15; onChange(); });
      if (justifyEl) justifyEl.addEventListener("change", onChange);
      modeEl.addEventListener("change", function () { applyModeHint(); updateWordCountNow(); onChange(); });
    }

    pathButtons.forEach(function (b) {
      b.addEventListener("click", function () {
        modeEl.value = b.dataset.path;
        applyModeHint();
        updateWordCountNow();
        onChange();
      });
    });

    if (tipDismiss) {
      tipDismiss.addEventListener("click", function () {
        tipDismissed = true;
        updateTip();
        try { chrome.storage.local.set({ kdpFmtTipDismissed: true }); } catch (e) { /* ignore */ }
      });
    }

    if (coverBtn && coverInput) {
      coverBtn.addEventListener("click", function () { coverInput.click(); });
      coverInput.addEventListener("change", function () {
        var file = coverInput.files && coverInput.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          coverPreview.innerHTML = '<span class="kdp-muted">Cover must be under 5 MB.</span>';
          return;
        }
        var reader = new root.FileReader();
        reader.onload = function () {
          uiCover = { dataUrl: reader.result, mime: file.type || "image/jpeg", name: file.name };
          renderCoverPreview();
          onChange();
        };
        reader.readAsDataURL(file);
      });
    }
    function renderCoverPreview() {
      if (!coverPreview) return;
      if (!uiCover) { coverPreview.innerHTML = ""; return; }
      coverPreview.innerHTML =
        '<div class="kdp-cover-preview">' +
        '<img src="' + esc(uiCover.dataUrl) + '" alt="Cover" />' +
        '<div class="kdp-cover-name">' + esc(uiCover.name) + ' <button type="button" id="kdp-fmt-cover-remove" title="Remove cover">✕</button></div>' +
        "</div>";
      var rm = coverPreview.querySelector("#kdp-fmt-cover-remove");
      if (rm) rm.addEventListener("click", function () { uiCover = null; coverInput.value = ""; renderCoverPreview(); });
    }

    if (summaryDismiss && summaryEl) {
      summaryDismiss.addEventListener("click", function () { summaryEl.hidden = true; });
    }

    if (exampleBtn) {
      exampleBtn.addEventListener("click", function () {
        textEl.value = EXAMPLE_MANUSCRIPT;
        modeEl.value = "raw";
        applyModeHint();
        updateWordCountNow();
        formatNow();
      });
    }

    pillButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        ui.target = btn.dataset.target;
        ui.spacing = TARGETS[ui.target].lineSpacing || 1.0;
        files.spacing.value = String(ui.spacing);
        setPills(ui.target);
        refillTrims();
        updatePrintVisibility();
        onChange();
      });
    });

    textEl.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); formatNow(); }
    });

    promptBtn.addEventListener("click", async function () {
      var prompt = buildAiPrompt(
        {
          title: files.title.value.trim(),
          author: files.author.value.trim(),
          subtitle: files.subtitle.value.trim(),
          copyright: files.copyright.value.trim(),
        },
        textEl.value || ""
      );
      try {
        await navigator.clipboard.writeText(prompt);
        promptNameEl.textContent = "Copied ✓ — run it in your AI, then paste the HTML below (input type: AI-formatted HTML).";
      } catch (e) {
        promptNameEl.textContent = "Clipboard blocked — select & copy the prompt manually.";
      }
    });

    function renderNotes(ms, opts) {
      var t = TARGETS[opts.target];
      var text = fullText(ms);
      var info = [];
      var warn = [];
      if (t.kind === "print") {
        var pages = estimatePages(text, opts.lineSpacing, opts.trim);
        var gutter = gutterFor(pages, opts.target);
        info.push("~" + pages + " pages · " + opts.trim.replace("x", "×") + " trim · gutter " + gutter + "″ · page numbers · running heads");
        if (t.minPages && pages < t.minPages) warn.push("Below the " + t.minPages + "-page minimum for " + t.label + ".");
        if (t.maxPages && pages > t.maxPages) warn.push("Over the " + t.maxPages + "-page maximum for " + t.label + ".");
        info.push("PDF is justified but not hyphenated (pdfmake limit) — finish from the DOCX for print-final hyphenation.");
      } else {
        info.push("Reflowable EPUB — no fixed margins or page numbers; chapters start on new pages.");
      }
      notesEl.innerHTML =
        info.map(function (n) { return '<div class="kdp-alert kdp-alert-info">' + escHtml(n) + "</div>"; }).join("") +
        warn.map(function (n) { return '<div class="kdp-alert kdp-alert-warn">' + escHtml(n) + "</div>"; }).join("");
    }

    function showResults(ok) {
      resultsEl.hidden = false;
      if (summaryEl) summaryEl.hidden = false;
      dlButtons.forEach(function (b) { b.disabled = !ok; });
    }

    function buildStructureHtml(ms) {
      var rows = [];
      var scenes = 0, quotes = 0, paras = 0;
      function count(items) {
        (items || []).forEach(function (p) {
          if (!p) return;
          if (p.scene) scenes += 1;
          else if (p.kind === "quote") quotes += 1;
          else if (p.text) paras += 1;
        });
      }
      if (!ms.chapters.length || (ms.chapters.length === 1 && !ms.chapters[0].title)) {
        rows.push('<div class="kdp-muted">No chapters detected — everything was treated as a single section.</div>');
      }
      ms.chapters.forEach(function (ch) {
        var headBits = [];
        if (ch.label) headBits.push(esc(ch.label));
        if (ch.subtitle) headBits.push("<i>" + esc(ch.subtitle) + "</i>");
        var subs = chapterSubs(ch);
        var subRows = subs.map(function (s) { return '<div class="kdp-inspector-sub">' + esc(s.text) + "</div>"; }).join("");
        rows.push(
          "<div class=\"kdp-inspector-ch\"><b>" + (headBits.join(" — ") || esc(ch.title || "Section")) + "</b>" +
          (subRows ? '<div class="kdp-inspector-subs">' + subRows + "</div>" : "") +
          "</div>"
        );
        count(ch.paragraphs);
      });
      count(ms.frontmatter);
      rows.push('<div class="kdp-muted">~' + paras + " paragraphs · " + scenes + " scene break" + (scenes === 1 ? "" : "s") + " · " + quotes + " quote" + (quotes === 1 ? "" : "s") + "</div>");
      return rows.join("");
    }

    function formatNow() {
      var raw = textEl.value;
      if (!String(raw || "").trim()) {
        showResults(false);
        doneEl.innerHTML = "";
        notesEl.innerHTML = '<div class="kdp-alert kdp-alert-err">' + (modeEl.value === "ai" ? "Paste the AI-formatted HTML first." : "Paste some content first.") + "</div>";
        return;
      }
      var opts = {
        target: ui.target,
        trim: ui.trim,
        title: files.title.value.trim(),
        author: files.author.value.trim(),
        subtitle: files.subtitle.value.trim(),
        copyright: files.copyright.value.trim(),
        alsoBy: files.also.value.trim(),
        aboutAuthor: files.about.value.trim(),
        lineSpacing: ui.spacing,
        justify: justifyEl ? justifyEl.checked : true,
        cover: uiCover,
        isbn: files.isbn.value.trim(),
        publisher: files.publisher.value.trim(),
        edition: files.edition.value.trim(),
      };
      var ms = modeEl.value === "ai" ? htmlManuscriptToModel(raw, opts) : parseManuscript(raw, opts);
      if (!fullText(ms)) {
        showResults(false);
        doneEl.innerHTML = "";
        notesEl.innerHTML = '<div class="kdp-alert kdp-alert-err">No content was parsed. For AI HTML, make sure it uses &lt;section class="chapter"&gt; with text; otherwise switch to Raw text / Markdown.</div>';
        return;
      }
      ui.lastResult = { ms: ms, opts: opts };
      doneEl.innerHTML = "Formatted ✓ · " + ms.chapters.length + " chapter" + (ms.chapters.length === 1 ? "" : "s") + " · ~" + countWords(fullText(ms)) + " words";
      renderNotes(ms, opts);
      if (structureEl) structureEl.innerHTML = buildStructureHtml(ms);
      showResults(true);
    }
    runBtn.addEventListener("click", formatNow);

    function saveBlob(blob, filename) {
      var URLlib = root.URL || root.webkitURL;
      var url = URLlib.createObjectURL(blob);
      var a = root.document.createElement("a");
      a.href = url;
      a.download = filename;
      root.document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URLlib.revokeObjectURL(url); }, 1200);
    }

    async function download(ext) {
      if (!ui.lastResult) return;
      // Lazy-loaded formatter libs must be ready before building files.
      if (window.__kdpLibsPromise) await window.__kdpLibsPromise;
      var ms = ui.lastResult.ms;
      var opts = ui.lastResult.opts;
      var base = sanitizeFilename(ms.title || "book");
      var btn = container.querySelector('.kdp-dl[data-ext="' + ext + '"]');
      var orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Building…";
      function saved() {
        btn.textContent = "Saved ✓";
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 1600);
      }
      function failed(e) {
        btn.textContent = orig;
        btn.disabled = false;
        notesEl.innerHTML = '<div class="kdp-alert kdp-alert-err">Download failed: ' + escHtml((e && e.message) || "unknown error") + "</div>";
      }
      try {
        if (ext === "epub") {
          buildEpub(ms, opts).then(function (blob) { saveBlob(blob, base + ".epub"); saved(); }, failed);
        } else if (ext === "pdf") {
          if (!root.pdfMake) return failed(new Error("pdfmake not loaded"));
          buildPdf(ms, opts, function (blob) { saveBlob(blob, base + ".pdf"); saved(); });
        } else if (ext === "docx") {
          buildDocx(ms, opts).then(function (blob) { saveBlob(blob, base + ".docx"); saved(); }, failed);
        }
      } catch (e) {
        failed(e);
      }
    }
    dlButtons.forEach(function (btn) {
      btn.addEventListener("click", function () { download(btn.dataset.ext); });
    });

    setPills(ui.target);
    refillTrims();
    applyModeHint();
    updatePrintVisibility();
    updateWordCountNow();
    wireDraft();

    chrome.storage.local.get({ kdpFmtDraft: null, kdpFmtTipDismissed: false }, function (st) {
      tipDismissed = !!(st && st.kdpFmtTipDismissed);
      var d = st && st.kdpFmtDraft;
      if (!d) return;
      ui.target = TARGETS[d.target] ? d.target : ui.target;
      ui.trim = d.trim || ui.trim;
      ui.spacing = d.spacing != null ? d.spacing : ui.spacing;
      textEl.value = d.text || "";
      modeEl.value = d.mode === "ai" ? "ai" : "raw";
      if (justifyEl && d.justify != null) justifyEl.checked = !!d.justify;
      files.title.value = d.title || "";
      files.author.value = d.author || "";
      files.subtitle.value = d.subtitle || "";
      files.copyright.value = d.copyright || "";
      files.isbn.value = d.isbn || "";
      files.publisher.value = d.publisher || "";
      files.edition.value = d.edition || "";
      files.also.value = d.also || "";
      files.about.value = d.about || "";
      setPills(ui.target);
      refillTrims();
      files.spacing.value = String(ui.spacing);
      applyModeHint();
      updatePrintVisibility();
      updateWordCountNow();
      updateTip();
    });
  }
  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  var api = {
    TARGETS: TARGETS,
    PRINT_TRIMS: PRINT_TRIMS,
    gutterFor: gutterFor,
    normalizeText: normalizeText,
    parseManuscript: parseManuscript,
    countWords: countWords,
    wordCountOf: wordCountOf,
    looksLikeHtml: looksLikeHtml,
    estimatePages: estimatePages,
    fullText: fullText,
    splitChapterHeading: splitChapterHeading,
    htmlManuscriptToModel: htmlManuscriptToModel,
    buildAiPrompt: buildAiPrompt,
    bodyParagraphs: bodyParagraphs,
    inlineTokens: inlineTokens,
    renderHtmlInline: renderHtmlInline,
    renderPdfInline: renderPdfInline,
    epubFiles: epubFiles,
    docxFiles: docxFiles,
    pdfDocDefinition: pdfDocDefinition,
    pageCountFromPdfBuffer: pageCountFromPdfBuffer,
    sanitizeFilename: sanitizeFilename,
    activate: activate,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.KDPFormatter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);