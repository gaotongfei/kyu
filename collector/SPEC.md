---
id: kyu-collection
type: module-design
status: draft
title: On-demand job collection
parent: kyu-architecture
depends-on: [kyu-database]
---

## Responsibility and configuration

The collector populates one shared PostgreSQL catalog from Hirebase searches and enabled Ashby/Greenhouse/global Lever boards. Execution is explicit CLI work, independent of browser requests. EU Lever, other ATS and arbitrary website crawling are unsupported; there is no scheduled ingestion, upgrade or subscription workflow.

Candidate and search files are versioned; an ignored operator override selects an explicit subset and can replace searches. Candidates remain disabled until locally selected. Strict bounded parsing rejects duplicate JSON keys, duplicate identities, unsupported providers and unsafe identifiers/URLs. Requests are constructed from a provider allowlist and validated identifiers, never contributed URLs. Missing overrides are optional; malformed or unreadable overrides fail closed.

The pinned LastRound AI derivative supplies 9,904 reusable board candidates, not certified employers. Only its compatible identifiers are bundled; strict slug validation is not relaxed to absorb the remaining 31 rows. Employer configuration is bounded to 15,000 boards and 8 MiB; search/local JSON retains its 1 MiB bound. `DIRECTORY.md` owns attribution/provenance and contribution instructions. Explicit imports select identifiers or all compatible rows from a checksum-verified snapshot. Local enable commands add explicit keys or opt into all configured candidates while preserving searches. Import never activates boards; import, enable and validation never probe boards. Every actual board collection revalidates its endpoint and records the observation separately from historical crawl dates.

Each manual invocation processes a deterministic slice of enabled boards sorted by exact `provider:slug`, defaulting to 100 attempts with a maximum of 500. The zero-based offset is operator-controlled rather than a persistent cursor: selections must remain stable between batches, and rerunning a failed/interrupted range is safe through stable upserts. Boards outside the batch receive no refresh/closure update; search re-evaluation remains catalog-wide. Hirebase budgets apply independently to each invocation, not across a board-batch sequence.

## Provider and fact boundary

Adapters use documented APIs, bounded bodies/timeouts/retries and validated envelopes. Ashby and Greenhouse list endpoints have no documented pagination: continuation fields, unknown envelopes, duplicate IDs or inconsistent Greenhouse totals cannot establish a complete refresh. Ashby uses its posting ID, with a fallback only to an exact same-board hosted job path. Unlisted Ashby postings are not retained.

Greenhouse requests structured pay details at most two-wide, with a 2,000-job processing ceiling. Failed details or truncation make the board incomplete; previously collected compensation survives a failed detail with an explicit stale-details marker. Cents and reported currency are preserved without inventing a pay period. Ashby's explicit workplace type is authoritative; its `isRemote` boolean also covers hybrid and is not an eligibility fact.

Global Lever uses offset/limit pagination with at most 2,000 retained jobs and one bounded lookahead at the ceiling. A validated short/empty terminal page establishes completion; duplicate IDs across or within pages, oversized/malformed pages and failed later pages cannot. Valid earlier pages survive later failures as incomplete, never closure evidence. Descriptions combine the provider's opening/body once with all reported lists, closing and salary sections; list headings remain plain text. Lever's top-level country applies only to its primary location, not every additional location. Unsupported posting/update timestamps stay unknown rather than interpreting a creation timestamp as publication.

Descriptions, original links, all reported locations/work arrangements, available compensation and source dates remain source facts. Lever's `hostedUrl` is the original posting and `applyUrl` is the separate application destination; missing links stay unknown rather than becoming fabricated careers URLs. Missing facts stay unknown. Raw Hirebase location text is preserved alongside normalized addresses, even when the normalized list is empty. Only explicit country facts/codes are recognized; a state abbreviation such as CA is not assumed to mean Canada. Source HTML is stored, not injected into the web view.

## Matching and lifecycle

Enabled saved searches are OR'd. Within a search, any normalized title phrase must match, plus a configured country or explicit reported-location phrase, plus an optional work-arrangement filter. Empty geographic criteria explicitly mean unrestricted. Unknown required facts are excluded unless opted in; known foreign geography never becomes unknown, and remote/global work style does not establish a country. Descriptions do not establish eligibility. A country code such as Namibia's NA remains a reported fact, not a missing-value marker.

Only matching jobs persist. Re-evaluation removes out-of-scope content and updates match IDs without calling those jobs closed; disabling all searches therefore clears the catalog on an invocation. Stable `(source, provider job ID)` upserts preserve first observation and advance last observation only for seen jobs. Similar titles/employers or identical application links do not collapse independent source provenance.

Independent source transactions commit successful work despite other source failures. Only a validated, complete refresh of that exact board can deactivate missing listings. Partial boards, failures, disabled boards and all Hirebase search samples cannot close unseen jobs. Reappearance reactivates the same source record. Explicit purge deletes content and leaves an identity-only suppression preventing re-ingestion; required source deletion obligations take precedence over inactive-history retention.

## Hirebase allowance

Before metered work, the unmetered summary must establish known Free semantics: 500 jobs, hard cap, no paid subscription/overage and a UTC-calendar reset. Unknown/legacy/billed-overage accounts fail closed. A response reporting unsafe billing semantics stops all further metered searches, not just that search.

The invocation cap, provider remaining allowance and persistent local UTC-month ceiling all apply. Reservations commit before calls. Every returned record consumes allowance, including duplicates, invalid records and nonmatches; usage is never inferred from unique catalog inserts. Known rejected requests refund their reservation; ambiguous completion retains its full possible spending and stops further work rather than replaying a POST. Usage headers can reduce subsequent spending. Crossing a UTC month stops collection for fresh verification.

Scheduling chooses the least cumulatively charged active search, redistributing exhausted shares toward underallocated searches. Page sizes shrink only to divisors of the consumed offset so redistribution does not skip pagination positions. Tiny invocation allocations rotate from persistent usage to avoid always starting with the first search. Exhausted budgets are explicitly limited samples, never closure evidence.

## Run ownership and reporting

A reserved-session advisory lease excludes concurrent invocations. Every provider attempt and mutation revalidates its original backend PID and lock ownership; a lost lease stays invalid. Every established-run mutation also locks and checks that run's database row. A successor marks interrupted rows while holding the same rows, so old writes either finish before takeover or reject afterward, including when a disconnect happens after preflight.

Startup uses a separate transaction-scoped advisory lock and revalidates the lease after acquiring it, before interrupting records. This prevents a delayed stale startup from interrupting a newer healthy owner. Source transaction locks serialize purge with ingestion without turning the whole run into one rollback unit. Reservations left pending by an interrupted process remain conservatively charged and become uncertain on recovery.

Reports persist source completeness/status, fetched/retained/deactivated counts, safe messages and Hirebase usage. Batch metadata records total enabled boards, offset, limit, attempted count and next offset; older reports may omit it. Progress advances after each attempted board, including failures, and does not advance when no searches are enabled. A null next offset indicates the range ended, not universal success. Status describes only attempted sources, not freshness of all candidates. Retained counts describe upsert observations, not unique new jobs. Incomplete/error runs exit nonzero. SQL diagnostics, keys, raw response dumps and contact data are not report fields.

## Official references

- [Hirebase API documentation index](https://www.hirebase.org/docs/llms.txt) and [unmetered usage summary](https://www.hirebase.org/docs/api-reference/billing/usage-summary.md).
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api).
- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html).
- [Lever public Postings API](https://github.com/lever/postings-api/blob/master/README.md).

## Known verification and rights limits

Hirebase is fixture-verified; no live key was configured for this delivery. The unmetered usage/reset and search contracts were checked against official docs; compatibility checks used three bounded Ashby/Greenhouse requests and one single-posting Lever demo request, without application-database persistence. The directory snapshot checksum was verified, but thousands of candidates were not live-probed. API/dataset access is not blanket permission to redistribute job content. Direct access to Hirebase's application terms page was blocked, so no undocumented retention or republication rights are claimed.

Automated global expiration-feed synchronization is not implemented: the confirmed feed covers only 14 days and can require large scans. Operators must handle source deletion notices with purge and manage stale observations under applicable terms. No paid historical recovery or scheduling is implied.
