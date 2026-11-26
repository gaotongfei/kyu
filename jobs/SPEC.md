---
id: kyu-catalog
type: module-design
status: draft
title: Read-only collected job catalog
parent: kyu-architecture
depends-on: [kyu-database]
references: [kyu-collection]
---

## Read-only boundary

The `/jobs` page displays persisted collection records, never live provider results; `/` redirects there. The guarded server adapter calls the shared lazy `getDb()` accessor and supplies a repeatable-read PostgreSQL snapshot; pure filters/types can be shared with presentation without importing credentials, filesystem configuration or adapters. No catalog route changes jobs or invokes collection.

Role/company and reported-location GET filters are bounded, SQL-parameterized literal searches, not wildcard programs. Active records are the default; inactive inclusion is explicit. Pagination is bounded, 25 rows per page, ordered by last observation with stable source/ID ties, and clamped to the available page count. Independent provenance remains visible rather than fuzzy-merged.

## Presentation contract

The shared navbar, page frame and system-aware palette are defined by `kyu-architecture`; the editor's app-owned semantic tokens survive private-reference removal. The catalog opens directly with filters, without a promotional title or instance subtitle. Catalog styling inherits the resolved scheme without changing the root provider or overriding editor colors. Native disclosures expand job details inline. Original/application anchors are siblings of the summary, never actions nested inside an interactive row. The view renders plain description text rather than trusting stored HTML and validates link protocols independently.

Collapsed rows show job title with the employer beneath it, salary and reported location, using aligned columns on desktop and the same fact groups stacked on narrow screens. Every provider uses the same text-only employer treatment, without logos, initials or placeholder icons. Work-arrangement labels, source IDs, timestamps and repeated disclosure hints stay out of the scan path. Opening the native row reveals employment and active/inactive state, description, application/original links, reported work arrangement, source identity, exact observation/source dates and eligibility caveats. Independent source observations remain separate rows, even when their visible summaries match.

Summary pay uses compact amounts without currency conversion or discarding reported precision; expanded compensation keeps exact numbers and every component. Currency, period, component-kind distinctions and missing facts remain explicit rather than inferring yearly base salary. Failed/partial refreshes and incomplete pay details have a labeled warning icon beside summary pay and full warning text inside the expanded row, so reduced visual clutter does not imply fresh verification. Hirebase observations remain identified as search samples in details, not full employer-board refreshes.

No accounts, fit scores, saving, swipe interactions, AI preparation, application submission or web-based collection/admin controls are supplied by this catalog. Catalog GET forms and pagination/reset links target `/jobs` directly so filters are not lost through the root redirect. The existing editor remains independently usable at `/resumes`; catalog changes do not rewrite its UI.

## Failure and access states

Collection freshness shares the result-count toolbar as a compact icon and short status, with a timestamp when space permits, not a permanently expanded operator report. The partial state only flags potential stale observations; per-job warning cues remain visible before expansion. A default-collapsed native Details disclosure exposes factual source outcomes, coverage, safe failure messages, exact dates and Hirebase usage without explanatory paragraphs. Status names accompany distinct symbols so color is never the only cue; running animation respects reduced motion. Routine subtitle/filter/footer narration is omitted.

No run, unfinished/interrupted runs, failed/partial/skipped sources, intentional budget limits, missing database configuration, database errors, empty catalog and filtered-empty results remain distinguishable. Keep actionable setup, error and recovery guidance; database errors do not expose SQL or credentials. A production build needs neither a database connection nor a provider key; reads occur dynamically at request time.

Visible keyboard focus, native filter labels/GET semantics, browser zoom, 320px wrapping, essential mobile metadata, 44px coarse-pointer controls and reduced motion are preserved. Loading is a quiet text status with no fabricated listings. Automated component tests use explicit fixtures; real-browser QA used a separate disposable database with clearly labeled fixture content, not production seed jobs.
