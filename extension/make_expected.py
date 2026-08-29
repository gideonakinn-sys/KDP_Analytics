"""
Generates `expected.json`: ground-truth outputs from the *Python* engine
(picked up from kdp_analytics_app.py). The Node parity test (engine.test.js)
recomputes the same values in JS and asserts they match within 1e-9.
"""
import json
import os
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "kdp_analytics_app.py")

src = open(APP, encoding="utf-8").read()
ns = {}
exec(src[:src.index("st.set_page_config(")], ns)

estimate_daily_sales = ns["estimate_daily_sales"]
estimate_royalty_per_unit = ns["estimate_royalty_per_unit"]
competition_score = ns["competition_score"]
extract_keywords = ns["extract_keywords"]
print_cost_for = ns["print_cost_for"]

BOOKS = [
    {"asin": "B0X1", "title": "The Complete Marketing Playbook", "subtitle": "A Practical Handbook", "format": "Paperback", "price": 12.99, "rating": 4.5, "review_count": 1230, "bsr": 12345, "page_count": 320, "categories": ["Books", "Business & Money", "Marketing"]},
    {"asin": "B0X2", "title": "Deep Work Habits", "subtitle": "Proven Strategies for Focus", "format": "Kindle", "price": 9.99, "rating": 4.8, "review_count": 5000, "bsr": 1, "page_count": 240, "categories": ["Books", "Self-Help"]},
    {"asin": "B0X3", "title": "Cooking on a Budget", "subtitle": "Simple Meals That Work", "format": "Kindle", "price": 15.00, "rating": 4.2, "review_count": 88, "bsr": 500000, "page_count": 220, "categories": ["Books", "Cooking"]},
    {"asin": "B0X4", "title": "Fitness Foundations", "subtitle": "An Essential Resource", "format": "Hardcover", "price": 24.99, "rating": 4.6, "review_count": 900, "bsr": 500, "page_count": 200, "categories": ["Books", "Health & Fitness"]},
    {"asin": "B0X5", "title": "Budget Investments", "subtitle": "Practical Money How-To", "format": "Hardcover", "price": 14.99, "rating": 3.9, "review_count": 12, "bsr": 95000, "page_count": 500, "categories": ["Books", "Business & Money", "Personal Finance"]},
    {"asin": "B0X6", "title": "Tiny Plays for Kids", "subtitle": "Short Skits to Perform", "format": "Paperback", "price": 2.99, "rating": 4.0, "review_count": 41, "bsr": 200000, "page_count": 300, "categories": ["Books", "Arts & Photography"]},
    {"asin": "B0X7", "title": "Tiny Tales", "subtitle": "A Small Book of Stories", "format": "Paperback", "price": 2.99, "rating": 4.0, "review_count": 5, "bsr": 89900, "page_count": 90, "categories": ["Books", "Literature & Fiction"]},
    {"asin": "B0X8", "title": "Word of Mouth Sales", "subtitle": "Proven Sales Tactics", "format": "Kindle", "price": 2.99, "rating": 4.7, "review_count": 30000, "bsr": 10, "page_count": 160, "categories": ["Books", "Business & Money", "Sales"]},
    {"asin": "B0X9", "title": "Long Tail Marketing", "subtitle": "How to Succeed at Scale", "format": "Kindle", "price": 8.99, "rating": 4.4, "review_count": 2600, "bsr": 1000000, "page_count": 300, "categories": ["Books", "Business & Money", "Marketing"]},
    {"asin": "B0X10", "title": "Niche Ideas", "subtitle": "Find a Market That Works", "format": "Kindle", "price": 0.0, "rating": 4.1, "review_count": 77, "bsr": 15000, "page_count": 200, "categories": ["Books", "Business & Money"]},
    {"asin": "B0X11", "title": "Classic Reprint", "subtitle": "A Short Anthology", "format": "Paperback", "price": 11.50, "rating": 4.3, "review_count": 420, "bsr": 250000, "page_count": None, "categories": ["Books", "Literature & Fiction"]},
    {"asin": "B0X12", "title": "Marketing Mastery", "subtitle": "The Step-by-Step Playbook You Need", "format": "Hardcover", "price": 29.99, "rating": 4.9, "review_count": 60000, "bsr": 120, "page_count": 420, "categories": ["Books", "Business & Money", "Marketing"]},
]


def build(book):
    p = book["price"]
    f = book["format"]
    pc = book["page_count"]
    bsr = book["bsr"]
    rc = book["review_count"]
    price_missing = p <= 0
    page_count_missing = f in ("Paperback", "Hardcover") and not (pc and pc > 0)
    royalty_unknown = price_missing or page_count_missing
    daily_sales = estimate_daily_sales(bsr)
    monthly_sales = daily_sales * 30
    royalty_per_unit = estimate_royalty_per_unit(p, f, pc)
    daily_royalty = None if royalty_unknown else daily_sales * royalty_per_unit
    monthly_royalty = None if royalty_unknown else monthly_sales * royalty_per_unit
    gross = monthly_sales * p
    comp_score, comp_label = competition_score(rc, bsr)
    kw_book = SimpleNamespace(
        title=book["title"],
        subtitle=book["subtitle"],
        categories=book["categories"],
        asin=book["asin"],
    )
    kws = [{"keyword": k.keyword, "source": k.source, "count": k.count, "confidence": k.confidence}
           for k in extract_keywords(kw_book)]
    return {
        "dailySales": daily_sales,
        "monthlySales": monthly_sales,
        "royaltyPerUnit": royalty_per_unit,
        "dailyRoyalty": daily_royalty,
        "monthlyRoyalty": monthly_royalty,
        "grossMonthlyRevenue": gross,
        "compScore": comp_score,
        "compLabel": comp_label,
        "priceMissing": price_missing,
        "pageCountMissing": page_count_missing,
        "royaltyUnknown": royalty_unknown,
        "printCost": print_cost_for(f, pc),
        "keywords": kws,
    }


def _camel(b: dict) -> dict:
    return {
        "asin": b["asin"],
        "title": b["title"],
        "subtitle": b["subtitle"],
        "categories": b["categories"],
        "format": b["format"],
        "price": b["price"],
        "rating": b["rating"],
        "reviewCount": b["review_count"],
        "bsr": b["bsr"],
        "pageCount": b["page_count"],
    }


fixtures = [{"input": _camel(b), "expected": build(b)} for b in BOOKS]

out = os.path.join(HERE, "expected.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump(fixtures, fh, indent=2)
print(f"wrote {len(fixtures)} fixtures -> {os.path.relpath(out)}")