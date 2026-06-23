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

SEP = re.compile(r"\s*›\s*")          # labelbook separator is "›" (U+203A)
def short(name):                                       # "Group › Sublabel" -> "Sublabel"
    parts = SEP.split(name, maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else name.strip()
def group_of(name):                                    # "Group › Sublabel" -> "Group"
    return SEP.split(name, maxsplit=1)[0].strip()

def lid(label): return "L:" + re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
def tid(theme): return "T:" + re.sub(r"[^a-z0-9]+", "-", theme.lower()).strip("-")

# ---- needs.csv: need -> theme, need name, theme order ------------------------
needs = list(csv.DictReader(open(NEEDS_CSV, encoding="utf-8-sig")))
need_theme = {n["need_id"]: n["theme"].strip() for n in needs}
need_name  = {n["need_id"]: n["name"].strip() for n in needs}
VALID = set(need_theme)                                # N01..N29

# member_labels = the labels that *make up* (define) each need. Two forms:
#   explicit  "Group › Sublabel"  -> that label is a member of the need
#   wildcard  "Group › (any)"     -> ANY sublabel of that group is a member
# Explicit memberships take precedence; wildcards are expanded later (once the
# set of real story labels is known) so e.g. N28 picks up every
# "Scalability & Performance › …" label instead of nothing.
explicit_members = {}                                   # label -> need
wildcard_groups = []                                    # (group, need)
for n in needs:
    for m in (n["member_labels"] or "").split("|"):
        m = m.strip()
        if not m:
            continue
        if m.lower().endswith("(any)"):
            wildcard_groups.append((group_of(m), n["need_id"]))
        else:
            explicit_members[m] = n["need_id"]

# theme order: by number of needs (desc), then name
theme_nneeds = Counter(need_theme.values())
themes = sorted(theme_nneeds, key=lambda t: (-theme_nneeds[t], t))
theme_order = {t: i for i, t in enumerate(themes)}

# ---- stories: co-occurrence label<->need, and per-node story counts ----------
wb = openpyxl.load_workbook(STORIES, data_only=True)
ws = wb["RIECS_stories_master_filterable"]
rows = list(ws.iter_rows(values_only=True))
H = {h: i for i, h in enumerate(rows[0]) if h and h != "None"}

label_count = Counter()                 # stories per label (both audiences)
need_count = Counter()                  # stories per need (both)
ln = Counter()                          # (label, need) co-occurrence (both)
# per-audience splits: key "42" (citizens / D4.2) and "43" (stakeholders / D4.3)
label_count_a = {"42": Counter(), "43": Counter()}
need_count_a = {"42": Counter(), "43": Counter()}
ln_a = {"42": Counter(), "43": Counter()}
for r in rows[1:]:
    if not any(r) or r[H["rejected"]]:
        continue
    aud_raw = str(r[H["deliverable_audience"]] or "")
    aud = "42" if aud_raw.startswith("D4.2") else "43" if aud_raw.startswith("D4.3") else None
    if aud is None:
        continue
    raw_labels = r[H["labels"]]
    raw_needs = r[H["need_ids"]]
    labs = [x.strip() for x in str(raw_labels or "").split("|") if x.strip()]
    nds = [x.strip() for x in re.split(r"[\s,;]+", str(raw_needs or "")) if x.strip() in VALID]
    for l in set(labs):
        label_count[l] += 1; label_count_a[aud][l] += 1
    for n in set(nds):
        need_count[n] += 1; need_count_a[aud][n] += 1
    for l in set(labs):
        for n in set(nds):
            ln[(l, n)] += 1; ln_a[aud][(l, n)] += 1

# 1) explicit members: keep those that are real story labels
member_of = {l: n for l, n in explicit_members.items() if l in label_count}
dropped = sorted(l for l in explicit_members if l not in label_count)
if dropped:
    print(f"  [info] dropped {len(dropped)} explicit member labels not present in stories:")
    for l in dropped:
        print("       -", l)
# 2) expand "(any)" wildcards: every real label in the group becomes a member of
#    the wildcard's need, unless it is already an explicit member of another need
group_labels = defaultdict(list)
for l in label_count:
    group_labels[group_of(l)].append(l)
for grp, need in wildcard_groups:
    hits = group_labels.get(grp, [])
    added = 0
    for l in hits:
        if l not in member_of:
            member_of[l] = need
            added += 1
    print(f"  [info] wildcard '{grp} › (any)' -> {need}: {added} labels "
          f"({'no labels found for group' if not hits else 'group has %d labels' % len(hits)})")
# needs still without any member label
from collections import Counter as _C
mc = _C(member_of.values())
empty = sorted(VALID - set(mc))
if empty:
    print("  [info] needs with no member label:", ", ".join(empty))

# labels shown = those that co-occur with a valid need OR are a member of one
linked_labels = {l for (l, n) in ln} | set(member_of)

# ---- positions --------------------------------------------------------------
# needs: grouped by theme order, then by count desc
needs_sorted = sorted(VALID, key=lambda n: (theme_order[need_theme[n]], -need_count[n], n))
need_pos = {n: i for i, n in enumerate(needs_sorted)}

# a label's anchor need = the need it is a MEMBER of (its definitional parent);
# for the few labels with no member need, fall back to the strongest co-occurrence.
def dominant_cooc(l):
    cands = [(w, n) for (ll, n), w in ln.items() if ll == l]
    return max(cands)[1] if cands else "N99"
def anchor_need(l):
    return member_of.get(l) or dominant_cooc(l)
labels_sorted = sorted(linked_labels,
                       key=lambda l: (need_pos.get(anchor_need(l), 999), -label_count.get(l, 0), l))
label_pos = {l: i for i, l in enumerate(labels_sorted)}

# themes: by theme order (counts split by audience)
theme_count = Counter(); theme_count_a = {"42": Counter(), "43": Counter()}
for n in VALID:
    theme_count[need_theme[n]] += need_count[n]
    for a in ("42", "43"):
        theme_count_a[a][need_theme[n]] += need_count_a[a][n]

# ---- assemble nodes / edges -------------------------------------------------
nodes, edges = [], []
for l in labels_sorted:
    nodes.append({"id": lid(l), "type": "label", "name": short(l), "full": l,
                  "theme": need_theme.get(anchor_need(l), ""), "count": label_count.get(l, 0),
                  "c42": label_count_a["42"].get(l, 0), "c43": label_count_a["43"].get(l, 0),
                  "member_of": member_of.get(l, ""), "col": 0, "order": label_pos[l]})
for n in needs_sorted:
    nodes.append({"id": n, "type": "need", "name": need_name[n], "full": f'{n} — {need_name[n]}',
                  "theme": need_theme[n], "count": need_count[n],
                  "c42": need_count_a["42"].get(n, 0), "c43": need_count_a["43"].get(n, 0),
                  "col": 1, "order": need_pos[n]})
for t in themes:
    nodes.append({"id": tid(t), "type": "theme", "name": t, "full": t, "theme": t,
                  "count": theme_count[t], "c42": theme_count_a["42"][t], "c43": theme_count_a["43"][t],
                  "col": 2, "order": theme_order[t]})

# label->need edges (kind "ln"); a "member" flag marks the definitional pairs.
# A member pair also co-occurs, so it stays in the co-occurrence view too.
# w42/w43 = co-occurrence weight per audience (0 if the pair doesn't co-occur there).
member_pairs = {(l, n) for l, n in member_of.items()}
n_member = 0
for (l, n), w in ln.items():
    is_m = (l, n) in member_pairs
    n_member += is_m
    edges.append({"s": lid(l), "t": n, "w": w, "w42": ln_a["42"][(l, n)],
                  "w43": ln_a["43"][(l, n)], "kind": "ln", "member": is_m})
# members that never co-occurred in any story (weight unknown -> 1)
for (l, n) in member_pairs:
    if (l, n) not in ln:
        edges.append({"s": lid(l), "t": n, "w": 1, "w42": 0, "w43": 0,
                      "kind": "ln", "member": True})
        n_member += 1
# need->theme edges (mode-independent; weight split by audience)
for n in needs_sorted:
    edges.append({"s": n, "t": tid(need_theme[n]), "w": need_count[n],
                  "w42": need_count_a["42"][n], "w43": need_count_a["43"][n], "kind": "theme"})

data = {
    "meta": {"labels": len(labels_sorted), "needs": len(needs_sorted), "themes": len(themes),
             "edges_member": n_member, "edges_cooc": len(ln) - n_member,
             "edges_need_theme": len(needs_sorted),
             "source": "RIECS_stories_master_filterable.xlsx (non-rejected) + work/needs.csv",
             "note": "label->need has two kinds: 'member' = labels that MAKE UP the need "
                     "(curated member_labels); 'cooc' = labels that CO-OCCUR on the need's stories "
                     "(weight = #stories). need->theme kind='theme'. Counts/weights are split by "
                     "audience: c42/w42 = D4.2 (citizens), c43/w43 = D4.3 (stakeholders); "
                     "totals are both. AI-derived, for validation."},
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
