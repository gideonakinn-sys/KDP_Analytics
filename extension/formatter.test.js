#!/usr/bin/env node
"use strict";
const assert = require("assert");
const F = require("./formatter.js");

let count = 0;
function ok(cond, msg) {
  count++;
  assert(cond, msg);
}

// ---- normalize ----
const norm = F.normalizeText("  Hello   world\n\n\n\nChapter 1\n");
ok(norm === "Hello world\n\nChapter 1", "normalize collapses blanks + trims");
ok(F.normalizeText('He said "hi"') === 'He said \u201chi\u201d', "smart quotes");

// ---- scene breaks ----
let ms = F.parseManuscript("P1.\n\nP2.\n\n\n\nP3.", {});
ok(ms.chapters[0].paragraphs.length === 4, "3+ blank lines = scene break (got " + ms.chapters[0].paragraphs.length + ")");
ok(ms.chapters[0].paragraphs[2].scene === true, "scene marker from big blank run");
ok(ms.chapters[0].paragraphs[0].text === "P1.", "first para text");

ms = F.parseManuscript("P1.\n\n* * *\n\nP2.", {});
ok(ms.chapters[0].paragraphs.length === 3 && ms.chapters[0].paragraphs[1].scene === true, "* * * marker = scene break");

// ---- manuscript ----
ms = F.parseManuscript(
  "Dedication here\n\nChapter One: The Beginning\n\nIt was a dark night.\n\nChapter 2\n\nMore text.",
  { title: "T", author: "A", subtitle: "Sub", copyright: "© 2024 X", alsoBy: "Book 1\nBook 2", aboutAuthor: "Bio." }
);
ok(ms.chapters.length === 2, "chapter count");
ok(ms.chapters[0].title === "Chapter One: The Beginning", "chapter1 title");
ok(ms.chapters[0].paragraphs[0].text === "It was a dark night.", "chapter1 para");
ok(ms.chapters[1].title === "Chapter 2", "chapter2 title");
ok(ms.frontmatter.length === 1 && ms.frontmatter[0].text === "Dedication here", "frontmatter");
ok(ms.subtitle === "Sub" && ms.copyright === "© 2024 X" && ms.alsoBy === "Book 1\nBook 2" && ms.aboutAuthor === "Bio.", "front/back matter opts");

const md = F.parseManuscript("# Intro\n\nP1.\n\n# Chapter 1\n\nP2.", {});
ok(md.chapters.length === 2 && md.chapters[0].title === "Intro", "markdown headings");

const flat = F.parseManuscript("Plain text.\n\nNo chapters at all.");
ok(flat.chapters.length === 1 && flat.chapters[0].title === "" && flat.chapters[0].paragraphs.length === 2, "single-section fallback");

// ---- bodyParagraphs ----
const bp = F.bodyParagraphs([{ text: "a" }, { scene: true }, { text: "b" }]);
ok(bp[0].noindent === true && bp[0].scene !== true, "first para noindent");
ok(bp[1].scene === true, "scene passthrough");
ok(bp[2].noindent === true, "after-scene noindent");

// ---- inline emphasis ----
ok(F.renderHtmlInline("a *b* c **d** _e_") === 'a <em>b</em> c <strong>d</strong> <em>e</em>', "html inline");
const runs = F.renderPdfInline("a *b* c **d**");
ok(runs[1].italics === true && runs[1].text === "b", "pdf italic run");
ok(runs[3].bold === true && runs[3].text === "d", "pdf bold run");

// ---- counts ----
ok(F.countWords("a b c") === 3, "countWords");
ok(F.estimatePages("word ".repeat(3000), 1.15, "6x9") > 0, "estimatePages");
ok(F.gutterFor(100, "paperback") === 0.375 && F.gutterFor(200, "paperback") === 0.5 && F.gutterFor(600, "paperback") === 0.75, "gutter bounds");
ok(F.gutterFor(100, "hardcover") === 0.5, "hardcover gutter larger");

// ---- EPUB ----
ms = F.parseManuscript("Chapter One\n\nIt was a dark night.\n\nChapter 2\n\nMore.", { title: "T", author: "A" });
const files = F.epubFiles(ms);
ok(files["mimetype"] === "application/epub+zip", "epub mimetype");
ok(!!files["OEBPS/contents.xhtml"], "epub contents page");
ok(!!files["OEBPS/copyrightpage.xhtml"], "epub copyright page");
ok(files["OEBPS/contents.xhtml"].includes('href="chapter-1.xhtml"'), "contents links chapters");
const opf = files["OEBPS/content.opf"];
const spine = ["titlepage", "copyright", "contents", "ch1"].map((id) => opf.indexOf('idref="' + id + '"'));
ok(spine.every((i) => i >= 0) && spine[0] < spine[1] && spine[1] < spine[2] && spine[2] < spine[3], "spine order title→copyright→contents→chapters");
ok(files["OEBPS/toc.ncx"].includes("<navPoint"), "ncx navPoints");
ok(files["OEBPS/chapter-1.xhtml"].includes("<h1>Chapter One</h1>"), "chapter heading");
ok(files["OEBPS/style.css"].includes("text-align: justify"), "epub justify");
ok(files["OEBPS/style.css"].includes("p.noindent"), "epub noindent class");
ok(files["OEBPS/style.css"].includes("p.scene"), "epub scene class");

// ---- DOCX ----
const docx = F.docxFiles(ms);
ok(!!docx["[Content_Types].xml"] && !!docx["word/document.xml"] && !!docx["word/styles.xml"], "docx parts");
const doc = docx["word/document.xml"];
ok(doc.includes('<w:pStyle w:val="Title"/>'), "docx Title style");
ok(doc.includes('<w:pStyle w:val="Heading1"/>'), "docx Heading1 style");
ok(doc.includes('<w:pStyle w:val="BodyText"/>'), "docx BodyText style");
ok(doc.includes('<w:jc w:val="both"/>') || docx["word/styles.xml"].includes('<w:jc w:val="both"/>'), "docx justified body");
ok(docx["word/styles.xml"].includes("<w:pageBreakBefore/>"), "docx chapter page breaks");
ok(doc.includes("Chapter One"), "docx chapter title text");
ok(doc.includes("Contents"), "docx contents block");
const emph = F.docxFiles(F.parseManuscript("Some *italic* and **bold** words.", {}));
ok(emph["word/document.xml"].includes("<w:i/>"), "docx italic run");
ok(emph["word/document.xml"].includes("<w:b/>"), "docx bold run");

// ---- PDF ----
const def = F.pdfDocDefinition(ms, { target: "paperback", trim: "6x9", lineSpacing: 1.15, fontSize: 11 });
ok(def.pageSize.width === 432 && def.pageSize.height === 648, "6x9 points");
ok(def.content.some((c) => c.toc), "pdf native toc");
ok(def.content.some((c) => c.tocItem && c.style === "chapterTitle"), "chapter tocItem");
ok(typeof def.content.find((c) => c.tocItem && c.style === "chapterTitle").tocItem === "object", "chapter tocItem is an object");
ok(
  def.content.filter((c) => c.style === "chapterTitle" && c.tocItem).every((c) => c.pageBreak === "before"),
  "chapter pageBreak on the node, not just the style"
);
ok(!("pageBreak" in def.styles.chapterTitle) && !("pageBreak" in def.styles.backTitle), "no silent pageBreak in styles");
ok(def.defaultStyle.alignment === "justify", "pdf justify");
ok(def.defaultStyle.orphans === 2 && def.defaultStyle.widows === 2, "pdf widows/orphans");
ok(!!def.styles.bodyNoIndent && !!def.styles.dinkus, "pdf styles");
ok(typeof def.header === "function" && typeof def.footer === "function", "pdf header/footer");

// ---- pdf page-count from buffer ----
const buf = Buffer.from("A /Type /Page x /Type /Page y /Type /Pages z /Type /Page end", "latin1");
ok(F.pageCountFromPdfBuffer(buf) === 3, "page count excludes /Pages");

// ---- misc ----
ok(F.sanitizeFilename("A: B? C*/") === "A- B- C-", "sanitize filename");

// ---- AI semantic-HTML import ----
const AI_HTML =
  '<body><h1 class="book-title">The Great Novel</h1>' +
  '<p class="book-author">Jane Doe</p><p class="book-subtitle">A Subtitle</p><p class="copyright">Copyright © 2026 Jane Doe</p>' +
  '<section class="frontmatter"><h1>Dedication</h1><p class="dedication">For my family.</p></section>' +
  '<section class="chapter"><h1>Chapter One</h1>' +
  '<p>It was a dark night with <em>sharp</em> and <strong>heavy</strong> tension.</p>' +
  '<div class="scene"></div><p>Scene two.</p><blockquote>Quoted words.</blockquote></section>' +
  '<section class="chapter"><h1>Chapter Two</h1><p>More.</p></section>' +
  '<section class="backmatter"><h1>About the Author</h1><p>Jane writes.</p><h1>Also By</h1><p>Book One</p></section></body>';
const aim = F.htmlManuscriptToModel(AI_HTML, {});
ok(aim.title === "The Great Novel" && aim.author === "Jane Doe" && aim.subtitle === "A Subtitle", "html meta");
ok(aim.chapters.length === 2 && aim.chapters[0].title === "Chapter One" && aim.chapters[1].title === "Chapter Two", "html chapters");
ok(aim.frontmatter.length === 1 && aim.frontmatter[0].kind === "dedication", "html frontmatter dedication");
const ach1 = aim.chapters[0].paragraphs;
ok(ach1[0].text === "It was a dark night with *sharp* and **heavy** tension.", "html emphasis preserved");
ok(ach1[1].scene === true, "html scene div");
ok(ach1[3].kind === "quote", "html blockquote kind");
ok(aim.aboutAuthor === "Jane writes." && aim.alsoBy === "Book One", "html backmatter routing");

// ---- kind rendering in outputs ----
const bookWithKinds = { title: "T", author: "A", frontmatter: [], chapters: [{ title: "Ch", paragraphs: [{ text: "q", kind: "quote" }, { text: "d", kind: "dedication" }] }] };
const epubK = F.epubFiles(bookWithKinds);
ok(epubK["OEBPS/chapter-1.xhtml"].includes("<blockquote>"), "epub blockquote");
ok(epubK["OEBPS/chapter-1.xhtml"].includes('class="dedication"'), "epub dedication class");
const docxK = F.docxFiles(bookWithKinds);
ok(docxK["word/document.xml"].includes('<w:ind w:left="720"'), "docx quote indent");
const pdfK = F.pdfDocDefinition(bookWithKinds, { target: "paperback", trim: "6x9", lineSpacing: 1.15, fontSize: 11 });
ok(!!pdfK.styles.blockquote && !!pdfK.styles.dedication, "pdf kind styles");

// ---- AI prompt template ----
const pr = F.buildAiPrompt({ title: "T", author: "A" }, "MANUSCRIPT TEXT");
ok(pr.includes('class="book-title"') && pr.includes("class=\"chapter\"") && pr.includes("MANUSCRIPT TEXT"), "ai prompt schema + manuscript");

// ---- chapter number + title split ----
ok(F.splitChapterHeading("Chapter 1: The Beginning").label === "Chapter 1" && F.splitChapterHeading("Chapter 1: The Beginning").subtitle === "The Beginning", "split chapter:title");
ok(F.splitChapterHeading("chapter 1: title").label === "Chapter 1", "title-case label");
const partSplit = F.splitChapterHeading("Part II — Origins");
ok(partSplit.label === "Part II" && partSplit.subtitle === "Origins", "split part em-dash");
ok(F.splitChapterHeading("Chapter One").label === "Chapter One" && F.splitChapterHeading("Chapter One").subtitle === "", "no-separator chapter");
ok(F.splitChapterHeading("The Beginning").label === "The Beginning" && F.splitChapterHeading("The Beginning").subtitle === "", "bare title -> label only");
ok(F.splitChapterHeading("Prologue: Dawn").label === "Prologue" && F.splitChapterHeading("Prologue: Dawn").subtitle === "Dawn", "prologue split");

// label/subtitle flow into outputs
const msS = F.parseManuscript("Chapter One: The Beginning\n\nBody text here.\n\nChapter Two\n\nMore text.", {});
ok(msS.chapters[0].label === "Chapter One" && msS.chapters[0].subtitle === "The Beginning", "raw parse labels");
ok(msS.chapters[1].label === "Chapter Two" && !msS.chapters[1].subtitle, "raw parse chapter two");
const epubS = F.epubFiles(msS);
ok(epubS["OEBPS/chapter-1.xhtml"].includes('<h1 class="with-sub">Chapter One</h1>') && epubS["OEBPS/chapter-1.xhtml"].includes("<h2>The Beginning</h2>"), "epub h1+h2");
ok(epubS["OEBPS/nav.xhtml"].includes(">Chapter One: The Beginning</a>"), "epub nav combined");
const docxS = F.docxFiles(msS);
ok(docxS["word/document.xml"].includes('<w:pStyle w:val="Heading1"/>') && docxS["word/document.xml"].includes('<w:pStyle w:val="Heading2"/>'), "docx heading styles");
ok(docxS["word/document.xml"].includes('<w:t xml:space="preserve">Chapter One</w:t>') && docxS["word/document.xml"].includes('<w:t xml:space="preserve">The Beginning</w:t>'), "docx label+subtitle text");
const pdfS = F.pdfDocDefinition(msS, { target: "paperback", trim: "6x9", lineSpacing: 1.15, fontSize: 11 });
const headNodes = pdfS.content.filter((c) => c.style === "chapterTitle");
ok(headNodes[0].text === "Chapter One" && headNodes[0].tocItem.text === "Chapter One: The Beginning", "pdf split header + combined toc text");
ok(pdfS.content.some((c) => c.style === "chapterSubtitle" && c.text === "The Beginning"), "pdf subtitle node");
ok(!!pdfS.styles.chapterSubtitle, "pdf subtitle style");

// AI-HTML also splits chapter headings
const aimS = F.htmlManuscriptToModel('<body><section class="chapter"><h1>Chapter Three: The End</h1><p>Done.</p></section></body>', {});
ok(aimS.chapters[0].label === "Chapter Three" && aimS.chapters[0].subtitle === "The End", "ai html split");

// EPUB justify toggle
ok(F.epubFiles(msS, { justify: false })["OEBPS/style.css"].includes("text-align: left"), "epub justify off -> left");
ok(F.epubFiles(msS, { justify: true })["OEBPS/style.css"].includes("text-align: justify"), "epub justify on -> justify");
ok(F.epubFiles(msS, {})["OEBPS/style.css"].includes("text-align: justify"), "epub default justify");

// ---- in-chapter subheaders ----
const subMs = F.parseManuscript("Chapter One\n\n## Morning\n\nThe light came.\n\n### Deeper\n\nMore words.", {});
ok(subMs.chapters[0].paragraphs.some((p) => p.sub === "Morning"), "raw ## -> sub");
ok(subMs.chapters[0].paragraphs.some((p) => p.sub === "Deeper"), "raw ### -> sub");
ok(subMs.chapters[0].subs.length === 2, "chapter.subs collected");
ok(F.parseManuscript("# Top\n\nBody.", {}).chapters[0].label === "Top", "single-hash still chapter");
const leadMs = F.parseManuscript("## Lead\n\nChapter One\n\nBody.", {});
ok(leadMs.chapters.length === 1 && leadMs.chapters[0].paragraphs.length === 1 && !leadMs.chapters[0].paragraphs[0].sub, "## before chapter -> plain paragraph");
const subEpub = F.epubFiles(subMs);
ok(subEpub["OEBPS/chapter-1.xhtml"].includes('<h3 id="s1">Morning</h3>'), "epub h3 with id");
ok(subEpub["OEBPS/chapter-1.xhtml"].includes('<h3 id="s2">Deeper</h3>'), "epub h3 second id");
ok(subEpub["OEBPS/nav.xhtml"].includes("chapter-1.xhtml#s1"), "nav nested sub link");
ok(subEpub["OEBPS/toc.ncx"].includes('src="chapter-1.xhtml#s1"'), "ncx nested sub");
ok(subEpub["OEBPS/contents.xhtml"].includes("chapter-1.xhtml#s1"), "contents nested sub link");
const subDocx = F.docxFiles(subMs);
ok(subDocx["word/document.xml"].includes('<w:pStyle w:val="Heading3"/>') && subDocx["word/document.xml"].includes("Morning"), "docx Heading3 + text");
const subPdf = F.pdfDocDefinition(subMs, { target: "paperback", trim: "6x9", lineSpacing: 1.15, fontSize: 11 });
const subH = subPdf.content.find((c) => c.style === "chapterSubheader");
ok(!!subH && JSON.stringify(subH.text).indexOf("Morning") !== -1, "pdf subheader node");
ok(!!subPdf.styles.chapterSubheader, "pdf subheader style");
// AI-HTML h4 inside a chapter -> sub (not a new chapter)
const aiSub = F.htmlManuscriptToModel('<body><section class="chapter"><h1>Ch One</h1><h4>Note</h4><p>Body.</p></section><section class="chapter"><h1>Ch Two</h1><p>x</p></section></body>', {});
ok(aiSub.chapters.length === 2 && aiSub.chapters[0].paragraphs.some((p) => p.sub === "Note"), "ai h4 -> sub, no extra chapter");
// EPUB CSS polish
const cs = F.epubFiles(subMs, { justify: true })["OEBPS/style.css"];
ok(cs.includes("line-height: 1.4"), "epub line-height 1.4");
ok(cs.includes("text-indent: 1.2em; margin: 0"), "epub indent-only paragraphs");
ok(cs.includes("h1.with-sub"), "epub with-sub rule");
ok(!/#111/.test(cs), "epub no fixed dark link color");
ok(cs.includes("text-align: left; margin: 1.2em 0 .4em"), "epub h3 left style");

// ---- cover + metadata (P2) ----
const coverOpts = { justify: true, cover: { dataUrl: "data:image/jpeg;base64,AAAA", mime: "image/jpeg", name: "c.jpg" }, isbn: "9781234567890", publisher: "Acme Press", edition: "2026" };
const cEpub = F.epubFiles(msS, coverOpts);
ok(!!cEpub["OEBPS/cover.xhtml"] && !!cEpub["OEBPS/images/cover.jpg"], "cover files present");
ok(cEpub["OEBPS/content.opf"].includes('name="cover" content="cover-img"'), "opf cover meta");
ok(cEpub["OEBPS/content.opf"].includes("urn:isbn:9781234567890"), "opf isbn");
ok(cEpub["OEBPS/content.opf"].includes("<dc:publisher>Acme Press</dc:publisher>"), "opf publisher");
ok(cEpub["OEBPS/content.opf"].includes("<dc:date>2026</dc:date>"), "opf edition/date");
ok(cEpub["OEBPS/content.opf"].includes('idref="cover"') && cEpub["OEBPS/content.opf"].indexOf('idref="cover"') < cEpub["OEBPS/content.opf"].indexOf('idref="titlepage"'), "cover first in spine");
const cDocx = F.docxFiles(msS, { target: "paperback", trim: "6x9", lineSpacing: 1.15 });
ok(cDocx["word/document.xml"].includes('<w:pgSz w:w="8640" w:h="12960"'), "docx trim page size (6x9)");
ok(cDocx["word/document.xml"].includes('<w:pgMar w:left="1080" w:right="1080" w:top="1080" w:bottom="1080" w:gutter="'), "docx gutter present");
const cDocxMeta = F.docxFiles(msS, coverOpts);
ok(cDocxMeta["word/document.xml"].includes("ISBN 9781234567890"), "docx copyright isbn line");
const cPdf = F.pdfDocDefinition(msS, Object.assign({ target: "paperback" }, coverOpts));
ok(!!cPdf.content[0].image && String(cPdf.content[0].image).indexOf("data:image/jpeg") === 0, "pdf cover image page first");
ok(cPdf.content.some((c) => c.text && c.text.indexOf("ISBN 9781234567890") === 0), "pdf copyright isbn line");

// ---- helpers ----
ok(F.looksLikeHtml('<section class="chapter"><p>x</p></section>') === true, "detect html");
ok(F.looksLikeHtml('Just plain prose.') === false, "plain text not html");
ok(F.looksLikeHtml('# Heading\n\nPlain.') === false, "markdown not html");
ok(F.wordCountOf("a <p>b</p> c", true) === 3, "html word count strips tags");

console.log("FORMATTER OK — " + count + " assertions passed");