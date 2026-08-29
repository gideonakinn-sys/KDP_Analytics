"""
KDP Book Analytics — MVP
=========================
A single-file Streamlit app that estimates Amazon KDP book performance
(sales, revenue, competition) from a public book URL/ASIN.

IMPORTANT NOTE ON SCRAPING
---------------------------
Amazon actively blocks automated scraping and its markup changes constantly,
so live scraping here is best-effort: it will work sometimes, from some IPs,
for some pages, and will fail (timeout / CAPTCHA page / layout change)
other times. This app NEVER attempts to bypass CAPTCHAs or bot-detection,
and it NEVER fabricates data: if Amazon blocks the request, or a required
field (like list price) can't be read, the app tells you and asks for the
missing value instead of making one up. For production use you'd want a
paid scraping/data API (Keepa, Rainforest API, etc.) behind this same engine.

Run:
    pip install streamlit requests beautifulsoup4 plotly lxml
    streamlit run kdp_analytics_app.py
"""

import re
import time
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup
import plotly.graph_objects as go
import streamlit as st

# --------------------------------------------------------------------------
# 1. ASIN PARSING
# --------------------------------------------------------------------------

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")

def extract_asin(raw: str) -> Optional[str]:
    """Extract a 10-character ASIN from a raw ASIN string or various Amazon URL formats."""
    if not raw:
        return None
    raw = raw.strip()

    # If it's already a bare ASIN
    if ASIN_RE.match(raw.upper()):
        return raw.upper()

    # Common URL patterns: /dp/ASIN, /gp/product/ASIN, /product/ASIN, ?asin=ASIN
    patterns = [
        r"/dp/([A-Z0-9]{10})",
        r"/gp/product/([A-Z0-9]{10})",
        r"/product/([A-Z0-9]{10})",
        r"/gp/aw/d/([A-Z0-9]{10})",
        r"[?&]asin=([A-Z0-9]{10})",
        r"/([A-Z0-9]{10})(?:[/?]|$)",
    ]
    for pattern in patterns:
        m = re.search(pattern, raw, re.IGNORECASE)
        if m:
            candidate = m.group(1).upper()
            if ASIN_RE.match(candidate):
                return candidate
    return None


# --------------------------------------------------------------------------
# 2. DATA MODEL
# --------------------------------------------------------------------------

PRICE_SOURCE_LABELS = {
    "live": "Scraped from Amazon",
    "manual": "Manual entry",
    "missing": "Not found",
}


@dataclass
class BookData:
    asin: str
    title: str
    author: str
    format: str
    price: float
    rating: float
    review_count: int
    bsr: int
    bsr_category: str
    price_source: str = "missing"  # "live" | "manual" | "missing"
    page_count: Optional[int] = None
    subtitle: str = ""
    categories: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# 3. SCRAPER (best-effort, with graceful fallback)
# --------------------------------------------------------------------------

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]

HEADERS = {
    "User-Agent": USER_AGENTS[0],
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
}


def _headers(call_number: int) -> dict:
    return {**HEADERS, "User-Agent": USER_AGENTS[call_number % len(USER_AGENTS)]}


# Markers that indicate Amazon served us a bot check / CAPTCHA instead of the
# product page. We never try to solve them — we just bail out and report it.
BLOCK_MARKERS = [
    "api-services-support@amazon.com",
    "enter the characters you see below",
    "captcha",
    "robot check",
    "to discuss automated access to amazon data",
]


PRICE_SELECTORS = [
    ".a-price .a-offscreen",
    "#corePrice_feature_div .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "span[data-a-color='price'] .a-offscreen",
    "#kindle-price",
    "#ebook-price",
    "#price",
]


def _parse_price(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"[\d,]+\.\d{2}", text)
    if m:
        return float(m.group(0).replace(",", ""))
    m = re.search(r"\$?\s*([\d,]+)(?:\s|$|[^\d.])", text)
    if m:
        return float(m.group(1).replace(",", ""))
    return None


def _parse_int(text: str) -> Optional[int]:
    if not text:
        return None
    m = re.search(r"[\d,]+", text)
    if m:
        return int(m.group(0).replace(",", ""))
    return None


def scrape_amazon_book(asin: str, timeout: int = 8, attempts: int = 2) -> tuple[Optional[BookData], Optional[str]]:
    """
    Best-effort live scrape of a public Amazon product page.
    Returns (book, None) on success or (None, reason) on failure where
    reason is one of: "timeout", "http <status>", "blocked", "layout".
    Sanity: never fabricate data — on failure, the caller should tell
    the user, not invent numbers.
    """
    url = f"https://www.amazon.com/dp/{asin}"
    for attempt in range(attempts):
        try:
            resp = requests.get(url, headers=_headers(attempt), timeout=timeout)
        except requests.RequestException:
            if attempt == attempts - 1:
                return None, "timeout"
            time.sleep(0.8)
            continue

        if resp.status_code != 200:
            return None, f"http {resp.status_code}"

        lowered = resp.text.lower()
        if any(marker in lowered for marker in BLOCK_MARKERS):
            if attempt == attempts - 1:
                return None, "blocked"
            time.sleep(0.8)
            continue

        book = _parse_book_page(resp.text, asin)
        if book is None:
            if attempt == attempts - 1:
                return None, "layout"
            time.sleep(0.8)
            continue
        return book, None
    return None, "unknown"


def _parse_book_page(html: str, asin: str) -> Optional[BookData]:
    soup = BeautifulSoup(html, "lxml")

    title_el = soup.select_one("#productTitle")
    title = title_el.get_text(strip=True) if title_el else None

    subtitle_el = soup.select_one("#productSubtitle")
    subtitle = subtitle_el.get_text(strip=True) if subtitle_el else ""

    author_el = soup.select_one(".author .a-link-normal, #bylineInfo")
    author = author_el.get_text(strip=True) if author_el else None

    price = None
    for sel in PRICE_SELECTORS:
        el = soup.select_one(sel)
        if el:
            price = _parse_price(el.get_text(strip=True))
            if price:
                break

    rating = None
    rating_el = soup.select_one("span.a-icon-alt")
    if rating_el:
        m = re.search(r"([\d.]+) out of 5", rating_el.get_text(strip=True))
        if m:
            rating = float(m.group(1))

    review_count = None
    reviews_el = soup.select_one("#acrCustomerReviewText")
    if reviews_el:
        review_count = _parse_int(reviews_el.get_text(strip=True))

    bsr = None
    bsr_category = None
    page_count = None
    detail_bullets = soup.select_one("#detailBullets_feature_div") or soup.select_one("#productDetails_detailBullets_sections1")
    details_text = detail_bullets.get_text(" ", strip=True) if detail_bullets else ""
    if details_text:
        m = re.search(r"#([\d,]+)\s+in\s+([A-Za-z0-9 &.']+)", details_text)
        if m:
            bsr = _parse_int(m.group(1))
            bsr_category = m.group(2).strip()
        pl = re.search(r"print\s+length[:\s]*([\d,]+)\s*pages?", details_text, re.IGNORECASE)
        if pl:
            page_count = _parse_int(pl.group(1))
    # Some layouts put "Print length" in the classic product-details table instead.
    if page_count is None:
        classic = soup.select_one("#productDetails_techSpec_section_1, #productDetailsTable")
        if classic:
            pl = re.search(r"print\s+length[:\s]*([\d,]+)\s*pages?", classic.get_text(" ", strip=True), re.IGNORECASE)
            if pl:
                page_count = _parse_int(pl.group(1))

    categories = []
    breadcrumbs = soup.select_one("#wayfinding-breadcrumbs_feature_div")
    if breadcrumbs:
        categories = [li.get_text(strip=True) for li in breadcrumbs.select("li") if li.get_text(strip=True)]

    html_lower = html.lower()[:20000]
    if "kindle" in html_lower:
        fmt = "Kindle"
    elif "hardcover" in html_lower:
        fmt = "Hardcover"
    else:
        fmt = "Paperback"

    if not title or bsr is None:
        # Not enough data reliably parsed — treat as a failed scrape
        return None

    return BookData(
        asin=asin,
        title=title,
        author=author or "Unknown",
        format=fmt,
        price=price or 0.0,
        rating=rating or 0.0,
        review_count=review_count or 0,
        bsr=bsr,
        bsr_category=bsr_category or "Books",
        price_source="live" if price else "missing",
        page_count=page_count,
        subtitle=subtitle,
        categories=categories,
    )


# --------------------------------------------------------------------------
# 4. ESTIMATION ENGINE
# --------------------------------------------------------------------------

# Reference points (BSR -> approximate daily unit sales) used as anchors for
# a log-log interpolated power-law curve. These are widely-circulated rough
# approximations (the kind used by public BSR calculators), NOT Amazon's
# actual algorithm — treat all outputs as directional estimates only.
_BSR_ANCHORS = [
    (1, 3000),
    (10, 1000),
    (100, 200),
    (500, 70),
    (1_000, 35),
    (5_000, 12),
    (10_000, 7),
    (50_000, 2.2),
    (100_000, 1.1),
    (250_000, 0.5),
    (500_000, 0.22),
    (1_000_000, 0.06),
]


def estimate_daily_sales(bsr: int) -> float:
    if bsr is None or bsr <= 0:
        return 0.0
    if bsr <= _BSR_ANCHORS[0][0]:
        return _BSR_ANCHORS[0][1]
    if bsr >= _BSR_ANCHORS[-1][0]:
        # extrapolate a long tail rather than hard-zero
        last_rank, last_sales = _BSR_ANCHORS[-1]
        return max(last_sales * (last_rank / bsr) ** 1.2, 0.01)

    for (r1, s1), (r2, s2) in zip(_BSR_ANCHORS, _BSR_ANCHORS[1:]):
        if r1 <= bsr <= r2:
            # log-log linear interpolation (power-law segment)
            import math
            log_r1, log_r2 = math.log(r1), math.log(r2)
            log_s1, log_s2 = math.log(s1), math.log(s2)
            t = (math.log(bsr) - log_r1) / (log_r2 - log_r1)
            log_s = log_s1 + t * (log_s2 - log_s1)
            return math.exp(log_s)
    return 0.0


# KDP print costs (Amazon.com, black ink, regular trim) from KDP's published
# "Paperback Printing Cost" / "Hardcover Printing Cost" help pages:
#   Paperback: 24–110 pages → fixed $2.30; 110–828 pages → $1.00 + $0.012/page
#   Hardcover: 75–108 pages → fixed $6.80; 110–550 pages → $5.65 + $0.012/page
# A missing page count means NO estimated print royalty (see print_cost_for).
PRINT_COST_RULES = {
    "Paperback": {"fixed_low": 2.30, "low_max_pages": 110, "fixed": 1.00, "per_page": 0.012},
    "Hardcover": {"fixed_low": 6.80, "low_max_pages": 108, "fixed": 5.65, "per_page": 0.012},
}


def print_cost_for(fmt: str, page_count: Optional[int] = None) -> Optional[float]:
    """
    KDP printing cost per unit (Amazon.com, black ink, regular trim).
    Returns None when the page count is unknown (print royalty can't be
    estimated without it — the app never silently assumes a page count).
    """
    rule = PRINT_COST_RULES.get(fmt)
    if not rule:
        return None
    pages = page_count if page_count and page_count > 0 else None
    if pages is None:
        return None
    if pages <= rule["low_max_pages"]:
        return rule["fixed_low"]
    return rule["fixed"] + rule["per_page"] * pages


def estimate_royalty_per_unit(price: float, fmt: str, page_count: Optional[int] = None) -> Optional[float]:
    """Approximate KDP royalty per unit sold. None means 'unknown' (a print
    book with no page count), which the UI renders as '—' rather than a guess."""
    if price <= 0:
        return 0.0

    if fmt == "Kindle":
        if 2.99 <= price <= 9.99:
            # 70% royalty tier, minus an approximate delivery fee
            # (a flat ~$0.15 assumes a ~1MB ebook; KDP charges per MB)
            delivery_fee = 0.15
            royalty = price * 0.70 - delivery_fee
        else:
            # 35% royalty tier, no delivery fee
            royalty = price * 0.35
        return max(royalty, 0.0)

    # Print royalty ≈ 60% of list price minus KDP's actual printing cost.
    # Page count is required for print — no count, no estimated royalty.
    cost = print_cost_for(fmt, page_count)
    if cost is None:
        return None
    return max(price * 0.60 - cost, 0.0)


def competition_score(review_count: int, bsr: int) -> tuple[int, str]:
    """
    Returns (score 0-100, label). Lower score = easier niche to compete in.
    Heuristic: high review counts among top-ranked competitors + a low BSR
    (meaning the book already sells well) both push competition up.
    """
    review_component = min(review_count / 2000, 1.0) * 60  # up to 60 pts
    bsr_component = 0
    if bsr and bsr > 0:
        # a very low (good) BSR next to lots of reviews = tough niche leader
        bsr_component = max(0, (1 - min(bsr, 200_000) / 200_000)) * 40  # up to 40 pts
    score = round(review_component + bsr_component)
    score = max(0, min(100, score))

    if score < 30:
        label = "Low Competition"
    elif score < 60:
        label = "Moderate Competition"
    else:
        label = "High Competition"
    return score, label


# --------------------------------------------------------------------------
# 5. KEYWORD EXTRACTION & RELATED SEARCHES
# --------------------------------------------------------------------------

STOPWORDS = set(
    """
    a an and are as at be been being but by can could did do does for from had
    has have he her his how i if in into is it its me more most my no not of on
    or our out over so some than that the their them then there these they this
    to too under up us was we were what when where which who why will with you
    your
    """.split()
)

SOURCE_WEIGHTS = {"Title": 1.0, "Subtitle": 0.7, "Category": 0.5}


@dataclass
class KeywordHit:
    keyword: str
    source: str
    count: int
    confidence: float


def _keyword_tokens(text: str) -> list[str]:
    """Lowercase tokens from text (keeps hyphenated / '&' terms, drops 1-char)."""
    return re.findall(r"[a-z][a-z0-9'&+-]{1,}", (text or "").lower())


def _ngrams(tokens: list[str], n: int) -> list[str]:
    return [" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]


def extract_keywords(book: BookData) -> list[KeywordHit]:
    """
    Rank the keywords a book is indexed for, inferred from its title,
    subtitle and category path (Amazon's strongest on-page relevance signals).
    This is an estimate of on-page indexing terms — not the book's KDP backend
    keywords, which Amazon does not expose publicly.
    """
    sources = {
        "Title": book.title,
        "Subtitle": book.subtitle,
        "Category": " > ".join(book.categories),
    }

    agg: dict[str, dict] = {}
    asin_tok = book.asin.lower()
    for source, text in sources.items():
        if not text:
            continue
        tokens = _keyword_tokens(text)
        weight = SOURCE_WEIGHTS[source]
        # Phrases (bigrams) are the stronger relevance signal; unigrams fill in.
        for n, boost in ((2, 1.0), (1, 0.6)):
            for phrase in _ngrams(tokens, n):
                words = phrase.split()
                if asin_tok in words:
                    continue
                if any(w in STOPWORDS for w in words):
                    continue
                entry = agg.setdefault(phrase, {"count": 0, "best_weight": 0.0, "sources": set()})
                entry["count"] += 1
                entry["best_weight"] = max(entry["best_weight"], weight * boost)
                entry["sources"].add(source)

    hits = []
    for keyword, entry in agg.items():
        confidence = 0.45 + 0.45 * entry["best_weight"]
        if len(entry["sources"]) > 1:
            confidence += 0.05
        confidence = min(0.95, confidence)
        hits.append(KeywordHit(
            keyword=keyword,
            source=" / ".join(sorted(entry["sources"])),
            count=entry["count"],
            confidence=round(confidence, 2),
        ))

    hits.sort(key=lambda h: (-h.confidence, -h.count, h.keyword))
    return hits[:20]


@st.cache_data(ttl=3600, show_spinner=False)
def fetch_related_searches(query: str, timeout: int = 5) -> list[str]:
    """
    Best-effort pull of Amazon's public autocomplete suggestions for a query
    (the same endpoint the search box uses). Returns [] if blocked or empty —
    callers should treat it as optional enrichment, never as "this book ranks
    for these terms".
    """
    if not query or not query.strip():
        return []
    prefix = query.strip()[:50]
    try:
        resp = requests.get(
            "https://completion.amazon.com/api/2017/suggestions",
            params={"limit": 11, "prefix": prefix, "alias": "aps", "mid": "ATVPDKIKX0DER"},
            headers=HEADERS,
            timeout=timeout,
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        return [s.get("value", "") for s in data.get("suggestions", []) if s.get("value")]
    except Exception:
        # Autocomplete is pure enrichment — it must never crash the app.
        return []


# --------------------------------------------------------------------------
# 6. STREAMLIT UI
# --------------------------------------------------------------------------

st.set_page_config(page_title="KDP Book Analytics", page_icon="📚", layout="wide")

st.markdown(
    """
    <style>
    .metric-card {
        background: #ffffff;
        border: 1px solid #e6e6e6;
        border-radius: 12px;
        padding: 18px 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .metric-label { font-size: 0.8rem; color: #6b7280; text-transform: uppercase; letter-spacing: .04em;}
    .metric-value { font-size: 1.7rem; font-weight: 700; color: #111827; }
    </style>
    """,
    unsafe_allow_html=True,
)

st.title("📚 KDP Book Analytics — MVP")
st.caption(
    "Estimate sales, revenue and competition for any Amazon book from its URL or ASIN. "
    "Live scraping is best-effort; if Amazon blocks the request, the app tells you instead of showing guesses."
)

with st.sidebar:
    st.header("🔎 Look up a book")
    raw_input = st.text_input(
        "Amazon Book URL or ASIN",
        placeholder="https://www.amazon.com/dp/B0XXXXXXXXX  or  B0XXXXXXXXX",
    )
    st.subheader("Price & format")
    manual_price = st.number_input(
        "List price ($)",
        min_value=0.0,
        value=0.0,
        step=0.5,
        help="Required for royalty/revenue estimates. Fill in when Amazon's price wasn't scraped.",
    )
    format_override = st.selectbox(
        "Format",
        ["Auto (from data)", "Kindle", "Paperback", "Hardcover"],
        help="Override the detected book format for royalty calculations.",
    )
    page_count_input = st.number_input(
        "Page count",
        min_value=0,
        value=0,
        step=1,
        help="Required for print royalty (KDP's fixed + per-page cost). Leave at 0 to auto-detect, or enter it if the scrape misses it.",
    )
    run = st.button("Analyze Book", type="primary", use_container_width=True)

if "book_data" not in st.session_state:
    st.session_state.book_data = None

if run:
    asin = extract_asin(raw_input)
    if not asin:
        st.error("Couldn't find a valid 10-character ASIN in that input. Paste a full Amazon product URL or a bare ASIN like `B0CXXXXXXX`.")
    else:
        book = None
        reason = "unknown"
        with st.spinner(f"Attempting live fetch for ASIN {asin}..."):
            try:
                book, reason = scrape_amazon_book(asin)
            except Exception:
                book, reason = None, "unknown"
            time.sleep(0.3)

        if book is None:
            messages = {
                "timeout": "Amazon didn't respond in time. Check the ASIN and try again.",
                "blocked": "Amazon blocked the automated request (CAPTCHA / bot detection) from this server's IP — common on shared hosting. No data was fabricated. Try again, or run the app locally where live scraping is more likely to work.",
                "layout": "The page loaded but its layout couldn't be parsed (Amazon changed its markup), so no data was generated.",
            }
            st.error(messages.get(reason or "unknown", f"Couldn't fetch data from Amazon ({reason}). Try again."))
            st.session_state.book_data = None
        else:
            if format_override != "Auto (from data)":
                book.format = format_override

            if page_count_input and page_count_input > 0:
                book.page_count = int(page_count_input)

            if manual_price > 0:
                book.price = manual_price
                book.price_source = "manual"

            st.session_state.book_data = book

book: Optional[BookData] = st.session_state.book_data

if book is None:
    st.info("Enter a book URL or ASIN in the sidebar and click **Analyze Book** to get started.")
    st.stop()

# --- Run estimation engine ---
price_missing = book.price <= 0
page_count_missing = (
    book.format in ("Paperback", "Hardcover")
    and not (book.page_count and book.page_count > 0)
)
royalty_unknown = price_missing or page_count_missing

royalty_per_unit = estimate_royalty_per_unit(book.price, book.format, book.page_count)
print_cost = print_cost_for(book.format, book.page_count) if book.format in ("Paperback", "Hardcover") else None
daily_sales = estimate_daily_sales(book.bsr)
monthly_sales = daily_sales * 30
daily_royalty = None if royalty_per_unit is None else daily_sales * royalty_per_unit
monthly_royalty = None if royalty_per_unit is None else monthly_sales * royalty_per_unit
gross_monthly_revenue = monthly_sales * book.price
comp_score, comp_label = competition_score(book.review_count, book.bsr)

price_badge = PRICE_SOURCE_LABELS.get(book.price_source, book.price_source)
st.markdown(f"### {book.title}")
st.caption(
    f"by {book.author} · {book.format} · ASIN `{book.asin}` · Price: {price_badge}"
)

if price_missing:
    st.warning(
        "**List price not found.** Amazon didn't expose a price for this book. "
        "Enter a list price in the sidebar and re-analyze to see royalty and revenue estimates."
    )
elif page_count_missing:
    st.warning(
        "**Page count not found.** Print royalty needs it (KDP charges a per-page print cost). "
        "Enter a page count in the sidebar and re-analyze to see royalty and revenue estimates."
    )

st.divider()

# --- Metric cards ---
c1, c2, c3, c4, c5 = st.columns(5)
with c1:
    st.metric("📈 Est. Daily Sales", f"{daily_sales:,.1f} units")
with c2:
    st.metric("🗓️ Est. Monthly Sales", f"{monthly_sales:,.0f} units")
with c3:
    st.metric("💰 Est. Daily Royalty", "—" if royalty_unknown else f"${daily_royalty:,.2f}")
with c4:
    st.metric("💰 Est. Monthly Royalty", "—" if royalty_unknown else f"${monthly_royalty:,.2f}")
with c5:
    st.metric("🏆 Best Sellers Rank", f"#{book.bsr:,}" if book.bsr else "N/A")

if (
        not royalty_unknown
        and monthly_royalty is not None
        and monthly_royalty <= 0
        and monthly_sales > 0
    ):
    st.warning(
        "Royalty is $0 because this list price is too low for the format's printing cost. "
        "Raise the list price in the sidebar and re-analyze."
    )

st.divider()

left, right = st.columns([1.1, 1])

with left:
    st.subheader("Book Details")
    details = {
        "ASIN": book.asin,
        "Format": book.format,
        "List Price": "—" if price_missing else f"${book.price:,.2f}",
        "Price Source": PRICE_SOURCE_LABELS.get(book.price_source, book.price_source),
        "Page Count": f"{book.page_count:,}" if book.page_count else ("Required (print)" if page_count_missing else "Unknown"),
        "Rating": f"{book.rating} / 5.0",
        "Review Count": f"{book.review_count:,}",
        "BSR Category": book.bsr_category,
        "Est. Print Cost / Unit": (
            "—" if print_cost is None else f"${print_cost:,.2f}"
        ),
        "Est. Royalty / Unit": "—" if royalty_unknown else f"${royalty_per_unit:,.2f}",
        "Est. Daily Royalty": "—" if royalty_unknown else f"${daily_royalty:,.2f}",
        "Est. Monthly Royalty": "—" if royalty_unknown else f"${monthly_royalty:,.2f}",
        "Gross Monthly Revenue": "—" if price_missing else f"${gross_monthly_revenue:,.2f}",
    }
    st.table(details)

    with st.expander("How are these numbers calculated?"):
        st.markdown(
            """
- **Daily/Monthly sales**: interpolated from a log-log power-law curve fit to
  publicly circulated BSR→sales reference points. This is a *directional
  estimate*, not Amazon's real algorithm — treat it as a rough sanity check,
  not a guarantee.
- **Royalty per unit**: Kindle books priced **$2.99–$9.99** use the 70%
  royalty tier minus an approximate delivery fee; books outside that range
  use the 35% tier. Paperbacks/hardcovers pay **60% of list price minus KDP's
  actual printing cost** (fixed cost + per-page cost from KDP's published
  pricing). A page count is **required** for print books — if it isn't scraped
  or entered, royalty shows **"—"** rather than a guess.
- **Revenue vs royalty**: royalty per unit × sales = **your earnings**
  (daily/monthly royalty); list price × sales = **gross revenue** (what Amazon
  collects). Both are shown.
- **Competition score**: weighted combination of the review count (social
  proof / entrenchment) and how low (good) the BSR is (an already
  well-selling book at the top of a niche = harder to unseat).
            """
        )

with right:
    st.subheader("Niche Competition Level")
    fig = go.Figure(
        go.Indicator(
            mode="gauge+number",
            value=comp_score,
            number={"suffix": " / 100"},
            title={"text": comp_label},
            gauge={
                "axis": {"range": [0, 100]},
                "bar": {"color": "#111827"},
                "steps": [
                    {"range": [0, 30], "color": "#bbf7d0"},
                    {"range": [30, 60], "color": "#fde68a"},
                    {"range": [60, 100], "color": "#fecaca"},
                ],
            },
        )
    )
    fig.update_layout(height=320, margin=dict(t=40, b=0, l=20, r=20))
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("Sales Estimate Curve")
    sample_ranks = [max(1, int(book.bsr * m)) for m in [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5]]
    sample_sales = [estimate_daily_sales(r) for r in sample_ranks]
    curve_fig = go.Figure(
        go.Scatter(x=sample_ranks, y=sample_sales, mode="lines+markers", line=dict(color="#111827"))
    )
    curve_fig.update_layout(
        height=260,
        margin=dict(t=10, b=10, l=10, r=10),
        xaxis_title="BSR",
        yaxis_title="Est. Daily Sales",
        xaxis_type="log",
    )
    st.plotly_chart(curve_fig, use_container_width=True)

st.divider()
st.subheader("🔑 Keywords & Ranking")

keywords = extract_keywords(book)
if keywords:
    kw_col, tag_col = st.columns([1.1, 1])
    with kw_col:
        st.markdown("**Ranked keywords (inferred from title / subtitle / category)**")
        st.dataframe(
            [
                {"Keyword": k.keyword, "Source": k.source, "Relevance": f"{k.confidence:.0%}"}
                for k in keywords
            ],
            width="stretch",
            hide_index=True,
        )
    with tag_col:
        st.markdown("**Tag cloud**")
        chips = []
        for k in keywords:
            if k.confidence >= 0.80:
                bg = "#fef3c7"
            elif k.confidence >= 0.65:
                bg = "#e0e7ff"
            else:
                bg = "#e5e7eb"
            font_size = 12 + int(8 * k.confidence)
            chips.append(
                f'<span style="display:inline-block;background:{bg};border-radius:12px;'
                f'padding:4px 10px;margin:3px;font-size:{font_size}px;color:#111827;">{k.keyword}</span>'
            )
        st.markdown(" ".join(chips), unsafe_allow_html=True)
        st.caption("Size and color reflect estimated relevance.")
else:
    st.caption("No keywords could be inferred from the scraped title, subtitle, or category.")

related = fetch_related_searches(book.title)
if related:
    st.markdown("**Related searches (live Amazon autocomplete)**")
    st.write(" · ".join(f"“{r}”" for r in related[:10]))
    st.caption(
        "These are searches shoppers actually type, pulled from Amazon's search box. They indicate "
        "demand — not that this book ranks for them."
    )
else:
    st.caption("Amazon autocomplete suggestions couldn't be fetched (blocked or offline); showing on-page keywords only.")

st.divider()
st.caption(
    "⚠️ For informational/prototyping purposes only. Sales and revenue figures are algorithmic "
    "estimates based on publicly-known BSR heuristics and KDP's published royalty structure — "
    "they are not sourced from Amazon's internal sales data and will not exactly match real payouts."
)
