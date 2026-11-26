---
id: job-landing-goals
type: goal-and-requirements
status: draft
title: Private job discovery and application preparation
---

## Goal

Kyu helps one trusted operator discover collected jobs and prepare application documents on a self-hosted computer or private server. The job catalog and resume editor remain useful without any AI connection. There is no public-service authentication or multi-user ownership boundary; exposing the instance publicly requires a separate security design.

## Capabilities

Named resumes have one freely editable Markdown source, version-aware persistence, reviewed Markdown/PDF imports, a local HTML preview, and explicit Markdown/PDF exports. Document source and existing resumes are preserved rather than reconstructed into fixed application-managed sections.

Job collection is explicit operator CLI work with bounded provider access and billing safeguards. The browser reads the persisted catalog; saved-search matching uses reported facts, not model-generated eligibility or fit scores. Independent source provenance and incomplete/stale observations remain visible.

Optional writing assistance uses one explicitly chosen collected job and saved resume to generate reviewable resume and cover-letter drafts. Connections and models are configurable; API-key connections support private self-hosting, while ChatGPT-plan access is limited to officially supported local installations. Nothing is generated automatically for each job. Saving a tailored resume creates a new document, never overwrites the source, and requires human review of generated claims.

## Privacy and source rights

Provider calls occur only for explicit operator operations. Secrets stay server-side; private document text is sent for writing assistance only after an explicit generation action with a selected-provider notice. Local previews/imports/exports do not require an AI provider. Provider access does not establish permission to redistribute source job content; deletion obligations and source terms still apply.

Automatic applications, AI job ranking, background agent execution, and a hosted multi-user service are outside this product boundary.
