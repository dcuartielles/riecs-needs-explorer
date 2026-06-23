# Data provenance

This repository visualises a **controlled vocabulary and its derived structure**
from the RIECS-Concept project. It contains **no personal data and no raw user
stories** — only aggregate counts and the labels/needs/themes taxonomy.

## Where the data comes from

- **Project:** RIECS-Concept — *Towards a pan-European Research Infrastructure
  for Excellent Citizen Science* (Horizon Europe, Grant Agreement Nº 101188210).
- **Source evidence:** user stories gathered through the project's WP4 engagement
  activities (workshops, an online questionnaire and related engagements) and
  labelled by 13 consortium partners in a collaborative labelling session
  (May 2026) against a shared *labelbook*.
- **Labels:** the labelbook sublabels (shown as `Group › Sublabel`).
- **Needs (N01–N29):** clusters derived from the co-occurrence of labels across
  stories, grouped into **9 themes**.

## How `docs/data/graph.json` is built

`build_graph.py` reads two project files (kept **outside** this repository):

- the story master spreadsheet (one row per labelled, non-rejected user story,
  with its labels and need IDs), and
- the curated needs table (`needs.csv`: each need's name, theme and member labels).

From these it derives:

- **label → need** edges from **story co-occurrence** (a label and a need are
  linked when they appear together on a story); the edge **weight is the number
  of stories** in which they co-occur. This is a **many-to-many** relationship.
- **need → theme** edges from the curated grouping (one theme per need).
- **node size** = number of stories carrying that label / need / theme.
- node positions (`col`, `order`) baked for a stable, low-crossing layout.

Only the **aggregated** result (`graph.json`) is published. The underlying
spreadsheets, user-story texts and any participant information are **never**
included (see `.gitignore`).

## Scope and status

- Only the **29 themed core needs (N01–N29)** are shown. The framework also
  contains N30–N37, which do not yet have a theme assigned and are therefore
  excluded; add a theme to those needs and re-run `build_graph.py` to include them.
- The label→need links and the clustering are an **AI-assisted first pass and
  are pending consortium validation**. Treat the map as an exploratory aid, not
  a validated result.

## Current figures

141 labels · 29 needs · 9 themes · 2,336 label→need edges (+ 29 need→theme).

## Reuse

Software in this repository is licensed under the **GNU GPL v3** (see `LICENSE`).
The vocabulary and aggregate figures are RIECS-Concept project material; please
credit *RIECS-Concept (GA 101188210)* if you reuse them.
