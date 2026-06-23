#!/usr/bin/env python3
"""Build docs/data/graph.json for the RIECS labels-needs-themes explorer.

Tripartite many-to-many graph:
  labels  --(story co-occurrence)-->  needs  --(curated theme)-->  themes

- label->need edges: derived from the story master; weight = number of
  (non-rejected) stories in which the label and the need_id co-occur.
- need->theme edges: from work/needs.csv (the 29 themed core needs, 9 themes).
- node positions (col, order) are baked here for a stable hierarchical layout.
"""
import csv, json, re
from collections import Counter, defaultdict
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[2]
NEEDS_CSV = ROOT / "work" / "needs.csv"
STORIES = ROOT / "inputs" / "04 - 20260622 updates and requests" / "RIECS_stories_master_filterable.xlsx"
OUT = Path(__file__).resolve().parent / "docs" / "data" / "graph.json"

SEP = re.compile(r"\s*[—–\-]\s*")          # em / en / hyphen dash
def short(name):                                       # "Group — Sublabel" -> "Sublabel"
    parts = SEP.split(name, maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else name.strip()

def lid(label): return "L:" + re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
def tid(theme): return "T:" + re.sub(r"[^a-z0-9]+", "-", theme.lower()).strip("-")

# ---- needs.csv: need -> theme, need name, theme order ------------------------
needs = list(csv.DictReader(open(NEEDS_CSV, encoding="utf-8-sig")))
need_theme = {n["need_id"]: n["theme"].strip() for n in needs}
need_name  = {n["need_id"]: n["name"].strip() for n in needs}
VALID = set(need_theme)                                # N01..N29

# theme order: by number of needs (desc), then name
theme_nneeds = Counter(need_theme.values())
themes = sorted(theme_nneeds, key=lambda t: (-theme_nneeds[t], t))
theme_order = {t: i for i, t in enumerate(themes)}

# ---- stories: co-occurrence label<->need, and per-node story counts ----------
wb = openpyxl.load_workbook(STORIES, data_only=True)
ws = wb["RIECS_stories_master_filterable"]
rows = list(ws.iter_rows(values_only=True))
H = {h: i for i, h in enumerate(rows[0]) if h and h != "None"}

label_count = Counter()                 # stories per label
need_count = Counter()                  # stories per need
ln = Counter()                          # (label, need) co-occurrence
for r in rows[1:]:
    if not any(r) or r[H["rejected"]]:
        continue
    raw_labels = r[H["labels"]]
    raw_needs = r[H["need_ids"]]
    labs = [x.strip() for x in str(raw_labels or "").split("|") if x.strip()]
    nds = [x.strip() for x in re.split(r"[\s,;]+", str(raw_needs or "")) if x.strip() in VALID]
    for l in set(labs):
        label_count[l] += 1
    for n in set(nds):
        need_count[n] += 1
    for l in set(labs):
        for n in set(nds):
            ln[(l, n)] += 1

# keep only labels that actually link to a valid need
linked_labels = {l for (l, n) in ln}

# ---- positions --------------------------------------------------------------
# needs: grouped by theme order, then by count desc
needs_sorted = sorted(VALID, key=lambda n: (theme_order[need_theme[n]], -need_count[n], n))
need_pos = {n: i for i, n in enumerate(needs_sorted)}

# labels: ordered by their dominant need's position (then weight desc)
def dominant_need(l):
    cands = [(w, n) for (ll, n), w in ln.items() if ll == l]
    return max(cands)[1] if cands else "N99"
labels_sorted = sorted(linked_labels,
                       key=lambda l: (need_pos.get(dominant_need(l), 999), -label_count[l], l))
label_pos = {l: i for i, l in enumerate(labels_sorted)}

# themes: by theme order
theme_count = Counter()
for n in VALID:
    theme_count[need_theme[n]] += need_count[n]

# ---- assemble nodes / edges -------------------------------------------------
nodes, edges = [], []
for l in labels_sorted:
    nodes.append({"id": lid(l), "type": "label", "name": short(l), "full": l,
                  "theme": need_theme.get(dominant_need(l), ""), "count": label_count[l],
                  "col": 0, "order": label_pos[l]})
for n in needs_sorted:
    nodes.append({"id": n, "type": "need", "name": need_name[n], "full": f'{n} — {need_name[n]}',
                  "theme": need_theme[n], "count": need_count[n],
                  "col": 1, "order": need_pos[n]})
for t in themes:
    nodes.append({"id": tid(t), "type": "theme", "name": t, "full": t, "theme": t,
                  "count": theme_count[t], "col": 2, "order": theme_order[t]})

for (l, n), w in ln.items():
    edges.append({"s": lid(l), "t": n, "w": w})
for n in needs_sorted:
    edges.append({"s": n, "t": tid(need_theme[n]), "w": need_count[n]})

data = {
    "meta": {"labels": len(labels_sorted), "needs": len(needs_sorted), "themes": len(themes),
             "edges_label_need": len(ln), "edges_need_theme": len(needs_sorted),
             "source": "RIECS_stories_master_filterable.xlsx (non-rejected) + work/needs.csv",
             "note": "label->need = story co-occurrence (many-to-many); counts = #stories. AI-derived, for validation."},
    "themes": themes,
    "nodes": nodes,
    "edges": edges,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", OUT)
print("meta:", data["meta"])
print("max label-need degree:",
      max(Counter(e["s"] for e in edges if e["t"] in VALID).values()))
