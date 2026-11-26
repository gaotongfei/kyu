---
id: kyu-architecture
type: architecture-design
status: draft
title: Kyu application and collection boundaries
parent: job-landing-goals
references: [kyu-resume-editor]
---

## Application boundary

Kyu keeps the root Next.js App Router, React and Mantine foundation. PostgreSQL/Drizzle is the shared persistence boundary; no separate backend, queue or scheduler is required for collection. The resume editor (`kyu-resume-editor`) and collection/catalog share this foundation while retaining their own domain contracts.

The trusted, on-demand collector (`kyu-collection`) and the read-only catalog (`kyu-catalog`) both depend on `kyu-database`. The catalog shares only pure filters and job/report types with collection; it never invokes adapters, reads provider credentials or imports configuration containing filesystem operations. The browser submits GET filters; only the collector CLI contacts providers or changes collection data.

The Next.js database boundary retains the editor's lazy `getDb()` accessor and `server-only` guard. The CLI uses the narrow shared connection core described by `kyu-database`, rather than disabling Next's guard. Environment values have no browser-facing configuration endpoint. The root route redirects to `/jobs`; the Markdown editor remains at `/resumes`.

## Operator and presentation

A single trusted operator configures one shared catalog. The instance is intended for a private network; no authentication or publicly exposed administrative interface is provided. Public hosting requires a separately designed security boundary.

The catalog uses Kyu's default centered 880px frame including 30px desktop/22px narrow gutters, system sans-serif, separator rows and inline details. The editor retains its approved 1280px frame exception. Both use the editor branch's shared semantic tokens and Mantine `auto` color scheme, including its neutral black/gray dark palette; catalog CSS must not force the root scheme or override editor tokens. Mantine's reset/provider and unrestricted browser zoom remain intact. Neither feature adds a shared dashboard or placeholder navigation.

Product/source-rights principles remain owned by `job-landing-goals`; operational detail lives with the relevant module. The editor's source, preview/PDF, privacy/logging, system-color and lazy-database decisions remain authoritative after integration. Database migration lineage and preservation rules belong to `kyu-database`.
