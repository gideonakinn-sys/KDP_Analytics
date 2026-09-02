// KDP Book Analytics — side panel page logic.
// Asks the active Amazon tab's content script for the DOM-extracted book data
// (no network fetch of Amazon), computes estimates with KDPEngine, and renders.
//
// Rendering is split into a top block (title, caption, inputs — rebuilt only
// when a new book loads) and a results region (#kdp-results — rebuilt on every
// input change), so editing a price/format never steals focus.
(() => {
  "use strict";
  const ENGINE = window.KDPEngine;
  const body = document.getElementById("kdp-body");
  const refreshBtn = document.getElementById("kdp-refresh");

  // Fixed approximate FX rates (USD base) for the royalty math. Labeled as
  // approximate in the panel; used so £/€/¥/C$/A$ pages aren't silently
  // labelled as dollars.
  const FX_RATES = { USD: 1, GBP: 1.25, EUR: 1.08, JPY: 0.0067, CAD: 0.74, AUD: 0.66 };

  let pageData = null;
  let lastReason = "no-product";
  let overrides = { price: 0, format: "Auto", pageCount: 0 };
  let resultsEl = null;
  let retryArmed = false;
  const relatedCache = new Map();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function saveState() {
    try {
      chrome.storage.local.set({ kdpOverrides: overrides });
    } catch (e) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------
  // Fetching data from the active tab
  // ------------------------------------------------------------------
  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  async function requestBookData(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "get-book-data" });
    } catch (e) {
      return null; // no content script on this tab
    }
  }

  // ------------------------------------------------------------------
  // Engine + currency
  // ------------------------------------------------------------------
  function currency() {
    return (pageData && pageData.currency) || { code: "USD", symbol: "$" };
  }

  // KDP 70% Kindle tier bands + delivery fees, per marketplace (local currency).
  // US values are from KDP's published help; others are the commonly-published
  // marketplace bands (verify when adding a new marketplace).
  const MARKET_TIERS = {
    USD: { min: 2.99, max: 9.99, delivery: 0.15 },
    GBP: { min: 2.99, max: 9.99, delivery: 0.1 },
    EUR: { min: 2.99, max: 9.99, delivery: 0.12 },
    CAD: { min: 2.99, max: 9.99, delivery: 0.15 },
    AUD: { min: 2.99, max: 9.99, delivery: 0.2 },
    JPY: { min: 250, max: 1250, delivery: 20 },
  };

  function engineRun() {
    const cur = currency();
    const fx = FX_RATES[cur.code] || 1;
    const d = {
      ...pageData,
      price: overrides.price > 0 ? overrides.price : pageData.price,
      format: overrides.format !== "Auto" ? overrides.format : pageData.format,
      pageCount: overrides.pageCount > 0 ? overrides.pageCount : pageData.pageCount,
    };
    // Kindle: compute in the page's local currency against that marketplace's
    // 70% band (KDP tiers are per-marketplace). Print: engine is USD-anchored,
    // so convert to USD and back.
    const tier = MARKET_TIERS[cur.code] || MARKET_TIERS.USD;
    const a =
      d.format === "Kindle"
        ? ENGINE.computeAnalytics({ ...d, price: d.price }, { tierMin: tier.min, tierMax: tier.max, deliveryFee: tier.delivery })
        : ENGINE.computeAnalytics({ ...d, price: d.price / fx });
    const loc = (v) => (d.format === "Kindle" ? v : v * fx);
    const dec = cur.code === "JPY" ? 0 : 2;
    const sym = cur.symbol;
    const money = (v) => sym + Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const fmt = (v) => (a.royaltyUnknown ? "—" : money(loc(v)));
    const fmtSales = (v, monthly) =>
      monthly ? Math.round(v).toLocaleString() + " units" : v.toFixed(1) + " units";
    return { a, loc, money, fmt, fmtSales, cur, tier };
  }

  function priceSourceLabel() {
    if (overrides.price > 0) return "Manual entry";
    if (pageData.price > 0) return "Scraped from Amazon";
    return "Not found";
  }

  // ------------------------------------------------------------------
  // Related searches (best-effort; extension page can fetch with host perm)
  // ------------------------------------------------------------------
  async function relatedSearches(query) {
    const key = String(query || "").slice(0, 60);
    if (relatedCache.has(key)) return relatedCache.get(key);
    const p = (async () => {
      try {
        const url =
          "https://completion.amazon.com/api/2017/suggestions?limit=11&alias=aps&mid=ATVPDKIKX0DER&prefix=" +
          encodeURIComponent(String(query || "").slice(0, 50));
        const r = await fetch(url, { method: "GET", credentials: "omit" });
        if (!r.ok) return [];
        const j = await r.json();
        return ((j && j.suggestions) || []).map((s) => s.value).filter(Boolean);
      } catch (e) {
        return [];
      }
    })();
    relatedCache.set(key, p);
    return p;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function chipClass(conf) {
    if (conf >= 0.8) return "kdp-chip kdp-chip-high";
    if (conf >= 0.65) return "kdp-chip kdp-chip-mid";
    return "kdp-chip kdp-chip-low";
  }

  function row(key, val) {
    return `<div class="kdp-row"><span class="kdp-row-key">${esc(key)}</span><span class="kdp-row-val">${val}</span></div>`;
  }

  function aboutHTML() {
    return (
      `<details class="kdp-about"><summary>How is this estimated?</summary><ul>` +
      `<li>Daily/monthly sales come from a public BSR→sales heuristic — a directional estimate (typically within ±2×), not Amazon's real numbers.</li>` +
      `<li>Royalty: Kindle uses the 70% tier for prices inside the marketplace's 70% band (e.g. $/£/€2.99–9.99) minus an approximate per-MB delivery fee, otherwise 35%. Print pays 60% of list minus KDP's fixed + per-page print cost, which is why print books need a page count (missing → "—"). Kindle royalty ignores page count.</li>` +
      `<li>Royalty = your payout; gross revenue = list price × sales. A missing price shows "—" on purpose — nothing here is fabricated.</li>` +
      `<li>Non-USD prices display in ${cur.symbol} (approximate fixed FX rates are used only for the USD-side print math); Kindle tiers use the local marketplace band.</li>` +
      `</ul></details>`
    );
  }

  function renderTop() {
    const cur = currency();
    body.innerHTML =
      `<div class="kdp-book-title">${esc(pageData.title)}</div>` +
      `<div class="kdp-meta">by ${esc(pageData.author)} · ${esc(pageData.format)} · ASIN <code id="kdp-asin-copy" title="Copy ASIN" data-asin="${esc(pageData.asin || "")}">${esc(pageData.asin || "")}</code></div>` +
      `<div class="kdp-inputs">` +
      `<div class="kdp-field"><label for="kdp-price">List price (${cur.symbol})</label><input id="kdp-price" type="number" min="0" step="0.5" value="${overrides.price || ""}" placeholder="Auto" inputmode="decimal" /></div>` +
      `<div class="kdp-field"><label for="kdp-format">Format</label><select id="kdp-format">` +
      ["Auto", "Kindle", "Paperback", "Hardcover"]
        .map((f) => `<option ${overrides.format === f ? "selected" : ""}>${f}</option>`)
        .join("") +
      `</select></div>` +
      `<div class="kdp-field"><label for="kdp-pages">Page count</label><input id="kdp-pages" type="number" min="0" step="1" value="${overrides.pageCount || ""}" placeholder="Auto" /></div>` +
      `</div>` +
      `<div class="kdp-inputs-note"><span class="kdp-muted">Recalculates automatically · remembered</span><button id="kdp-reset" class="kdp-link" type="button">Reset</button></div>` +
      `<div id="kdp-results"></div>` +
      `<div id="kdp-related"></div>` +
      aboutHTML();

    resultsEl = body.querySelector("#kdp-results");

    body.querySelector("#kdp-price").addEventListener("input", (e) => {
      overrides.price = parseFloat(e.target.value) || 0;
      saveState();
      renderResults();
    });
    body.querySelector("#kdp-format").addEventListener("change", (e) => {
      overrides.format = e.target.value;
      saveState();
      renderResults();
    });
    body.querySelector("#kdp-pages").addEventListener("change", (e) => {
      overrides.pageCount = parseInt(e.target.value, 10) || 0;
      saveState();
      renderResults();
    });
    body.querySelector("#kdp-reset").addEventListener("click", () => {
      overrides = { price: 0, format: "Auto", pageCount: 0 };
      saveState();
      renderTop();
    });
    body.querySelector("#kdp-asin-copy").addEventListener("click", copyAsin);

    initRelated();
    renderResults();

    // Auto-focus whichever value is missing: price first, then page count.
    const effectivePrice = overrides.price > 0 ? overrides.price : pageData.price;
    const effectivePages = overrides.pageCount > 0 ? overrides.pageCount : pageData.pageCount;
    const fmtIsPrint = effectiveFormatIsPrint();
    setTimeout(() => {
      const p = body.querySelector("#kdp-price");
      const pg = body.querySelector("#kdp-pages");
      if (effectivePrice <= 0 && p) p.focus();
      else if (fmtIsPrint && !(effectivePages > 0) && pg) pg.focus();
    }, 150);
  }

  function effectiveFormatIsPrint() {
    const f = overrides.format !== "Auto" ? overrides.format : pageData.format;
    return f === "Paperback" || f === "Hardcover";
  }

  function renderResults() {
    if (!resultsEl) return;
    const { a, loc, fmt, fmtSales, money, tier } = engineRun();
    const d = {
      ...pageData,
      price: overrides.price > 0 ? overrides.price : pageData.price,
      format: overrides.format !== "Auto" ? overrides.format : pageData.format,
      pageCount: overrides.pageCount > 0 ? overrides.pageCount : pageData.pageCount,
    };
    const isPrint = d.format === "Paperback" || d.format === "Hardcover";

    let warn = "";
    if (a.priceMissing) {
      warn =
        `<div class="kdp-alert kdp-alert-warn"><b>List price not found.</b> ` +
        `Enter a price above to see royalty and revenue estimates.</div>`;
    } else if (a.pageCountMissing) {
      warn =
        `<div class="kdp-alert kdp-alert-warn"><b>Page count not found.</b> Print royalty needs it ` +
        `(KDP charges a per-page print cost) — enter a page count above to see royalty and revenue.</div>`;
    } else if (a.royaltyPerUnit <= 0 && a.monthlySales > 0) {
      warn =
        `<div class="kdp-alert kdp-alert-warn">Royalty is $0 because this price is too low for the ` +
        `format's printing cost. Raise the list price above.</div>`;
    }

    const card = (label, value) =>
      `<div class="kdp-card"><div class="kdp-card-label">${label}</div><div class="kdp-card-value">${value}</div></div>`;

    const grid =
      card("Est. Daily Sales", fmtSales(a.dailySales, false)) +
      card("Est. Monthly Sales", fmtSales(a.monthlySales, true)) +
      card("Est. Daily Royalty", fmt(a.dailyRoyalty)) +
      card("Est. Monthly Royalty", fmt(a.monthlyRoyalty)) +
      `<div class="kdp-card kdp-card-wide"><div class="kdp-card-label">Best Sellers Rank</div>` +
      `<div class="kdp-card-value">#${Number(pageData.bsr).toLocaleString()}</div>` +
      `<div class="kdp-card-sub">in ${esc(d.bsrCategory)}</div></div>`;

    const compColor = a.comp.score < 30 ? "#16a34a" : a.comp.score < 60 ? "#d97706" : "#dc2626";

    const kwItems = a.keywords
      .slice(0, 10)
      .map(
        (k) =>
          `<li><span><b>${esc(k.keyword)}</b> <span class="kdp-kw-src">(${esc(k.source)})</span></span><span>${Math.round(k.confidence * 100)}%</span></li>`
      )
      .join("");
    const chips = a.keywords
      .slice(0, 14)
      .map((k) => `<span class="${chipClass(k.confidence)}">${esc(k.keyword)}</span>`)
      .join("");

    const printCostRow = isPrint
      ? row("Est. Print Cost / Unit", a.printCost === null ? "—" : money(loc(a.printCost)))
      : "";

    let tierRow = row("Royalty Tier", "—");
    if (!a.royaltyUnknown) {
      if (d.format === "Kindle") {
        tierRow = row(
          "Royalty Tier",
          d.price >= tier.min && d.price <= tier.max ? "70% − delivery " + money(tier.delivery) : "35%"
        );
      } else {
        tierRow = row("Royalty Tier", a.printCost === null ? "60% − print cost (unknown)" : "60% − print cost " + money(loc(a.printCost)));
      }
    }

    resultsEl.innerHTML =
      warn +
      `<div class="kdp-grid">${grid}</div>` +
      `<div class="kdp-section">Book Details</div>` +
      `<div class="kdp-list">` +
      row("List Price", a.priceMissing ? "—" : money(d.price)) +
      row("Price Source", priceSourceLabel()) +
      row("Page Count", d.pageCount ? Number(d.pageCount).toLocaleString() : isPrint ? "Required (print)" : "Unknown") +
      row("Rating", d.rating ? `${Number(d.rating).toFixed(1)} / 5.0` : "Unknown") +
      row("Review Count", Number(d.reviewCount).toLocaleString()) +
      row("BSR Category", esc(d.bsrCategory)) +
      printCostRow +
      tierRow +
      row("Est. Royalty / Unit", fmt(a.royaltyPerUnit)) +
      row("Est. Daily Royalty", fmt(a.dailyRoyalty)) +
      row("Est. Monthly Royalty", fmt(a.monthlyRoyalty)) +
      row("Gross Monthly Revenue", a.priceMissing ? "—" : money(loc(a.grossMonthlyRevenue))) +
      `</div>` +
      `<div class="kdp-section">Niche Competition</div>` +
      `<div class="kdp-comp-label">${esc(a.comp.label)} — ${a.comp.score}/100</div>` +
      `<div class="kdp-comp-bar"><div class="kdp-comp-fill" style="width:${a.comp.score}%;background:${compColor}"></div></div>` +
      `<div class="kdp-section">Keywords &amp; Ranking</div>` +
      (a.keywords.length
        ? `<ul class="kdp-kw-list">${kwItems}</ul><div class="kdp-chips">${chips}</div>`
        : `<p class="kdp-muted">No keywords could be inferred from the title, subtitle, or category.</p>`);
  }

  function initRelated() {
    const el = body.querySelector("#kdp-related");
    if (!el) return;
    el.innerHTML = `<div class="kdp-section">Related Searches</div><p class="kdp-muted">Loading…</p>`;
    relatedSearches(pageData.title).then((list) => {
      if (!el.isConnected) return;
      if (!list || !list.length) {
        el.innerHTML = `<div class="kdp-section">Related Searches</div><p class="kdp-muted">Couldn't fetch autocomplete suggestions (blocked or offline).</p>`;
        return;
      }
      el.innerHTML =
        `<div class="kdp-section">Related Searches</div><ul class="kdp-related">` +
        list.slice(0, 8).map((s) => `<li>“${esc(s)}”</li>`).join("") +
        `</ul><p class="kdp-muted">What shoppers search — demand, not proof this book ranks for them.</p>`;
    });
  }

  function renderEmpty(reason) {
    const unparseable = reason === "unparseable";
    body.innerHTML =
      `<div class="kdp-empty">` +
      `<div style="font-size:1.15rem;font-weight:700;color:var(--fg)">` +
      (unparseable ? "Couldn't read this listing" : "Not an Amazon book page") +
      `</div>` +
      `<div style="margin-top:4px">` +
      (unparseable
        ? "A book page was detected, but nothing could be read (Amazon may have changed its layout). Press ↻ refresh or reopen the page."
        : "Open a book on <code>amazon.com/dp/…</code> and the panel updates automatically, or jump to one:") +
      `</div>` +
      (unparseable ? "" : `<input id="kdp-asin-input" placeholder="Enter ASIN (e.g. B0XXXXXXX)" />`) +
      (unparseable ? "" : `<button id="kdp-asin-open">Open book page</button>`) +
      `</div>`;
    if (!unparseable) {
      body.querySelector("#kdp-asin-open").addEventListener("click", () => {
        const val = (body.querySelector("#kdp-asin-input").value || "").trim().toUpperCase();
        if (/^[A-Z0-9]{10}$/.test(val)) chrome.tabs.create({ url: "https://www.amazon.com/dp/" + val });
      });
    }
  }

  function render() {
    if (!pageData) {
      renderEmpty(lastReason);
      return;
    }
    renderTop();
  }

  async function copyAsin(e) {
    const el = e.currentTarget;
    const asin = el.getAttribute("data-asin") || "";
    if (!asin) return;
    try {
      await navigator.clipboard.writeText(asin);
      const orig = el.textContent;
      el.textContent = "Copied";
      setTimeout(() => {
        el.textContent = orig;
      }, 1200);
    } catch (_) {
      /* clipboard unavailable */
    }
  }

  // ------------------------------------------------------------------
  // Refresh from the active tab (spin + single retry when script isn't ready)
  // ------------------------------------------------------------------
  async function refresh() {
    refreshBtn && refreshBtn.classList.add("kdp-spinning");
    try {
      const tab = await getActiveTab();
      if (!tab || tab.id === undefined) {
        pageData = null;
        lastReason = "no-product";
        renderEmpty("no-product");
        return;
      }
      let res = await requestBookData(tab.id);
      if ((!res || !res.data) && !retryArmed) {
        retryArmed = true;
        await sleep(900);
        res = await requestBookData(tab.id);
      }
      retryArmed = false;
      pageData = res && res.data ? res.data : null;
      lastReason = res && res.reason ? res.reason : res && res.data ? "ok" : "no-product";
      render();
    } catch (e) {
      body.innerHTML = `<div class="kdp-empty">Couldn't read the page (${esc((e && e.message) || "unknown error")}).</div>`;
    } finally {
      refreshBtn && refreshBtn.classList.remove("kdp-spinning");
    }
  }

  // ------------------------------------------------------------------
  // Tabs (Analytics | Formatter)
  // ------------------------------------------------------------------
  // Lazy-load the formatter libraries (jszip/pdfmake/vfs) on first use so
  // Analytics-only users don't pay the ~3.2MB JS cost at panel startup.
  let formatterLibsPromise = null;
  function loadFormatterLibs() {
    if (formatterLibsPromise) return formatterLibsPromise;
    const scripts = ["lib/jszip.min.js", "lib/pdfmake.min.js", "lib/vfs_fonts.js", "lib/vfs_serif.js"];
    formatterLibsPromise = new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (i >= scripts.length) return resolve();
        const s = document.createElement("script");
        s.src = scripts[i];
        s.onload = next;
        s.onerror = next; // keep going even if one lib fails
        document.head.appendChild(s);
        i += 1;
      };
      next();
    });
    return formatterLibsPromise;
  }

  function initTabs() {
    const bar = document.getElementById("kdp-tabs");
    const analytics = document.getElementById("kdp-body");
    const formatter = document.getElementById("formatter-body");
    if (!bar || !analytics || !formatter) return;
    const buttons = bar.querySelectorAll("button[data-tab]");
    function switchTab(tab) {
      const isFmt = tab === "formatter";
      analytics.hidden = isFmt;
      formatter.hidden = !isFmt;
      buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      if (refreshBtn) refreshBtn.style.visibility = isFmt ? "hidden" : "";
      if (isFmt) {
        loadFormatterLibs();
        if (window.KDPFormatter) window.KDPFormatter.activate();
      }
      try {
        chrome.storage.local.set({ kdpTab: tab });
      } catch (e) {
        /* ignore */
      }
    }
    buttons.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    chrome.storage.local.get({ kdpTab: "analytics" }, (st) => {
      switchTab(st && st.kdpTab === "formatter" ? "formatter" : "analytics");
    });
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  refreshBtn.addEventListener("click", refresh);
  initTabs();

  chrome.storage.local.get({ kdpOverrides: { price: 0, format: "Auto", pageCount: 0 } }, (st) => {
    if (st && st.kdpOverrides) overrides = st.kdpOverrides;
    refresh();
  });

  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener((_tabId, info) => {
    if (info.status === "complete") refresh();
  });
  chrome.windows.onFocusChanged.addListener((winId) => {
    if (winId !== chrome.windows.WINDOW_ID_NONE) refresh();
  });
})();