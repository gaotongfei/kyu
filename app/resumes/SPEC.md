---
id: kyu-resume-editor
type: module-design
title: Resume editor
status: draft
parent: job-landing-goals
---

# Resume editor

A private, single-operator editor for named resumes made of ordered generic Markdown sections. This module owns editing, document actions, transient import drafts, and source/PDF exports. Database declarations remain in `db/schema.ts`; the existing postgres-js/Drizzle client owns connections. There is no account, ownership, public-service access control, AI service, or separate backend. Run only on a trusted private machine/network; bind local services to loopback. Robots directives and no-store responses are privacy hygiene, not authentication.

## Source and persistence

One `resumes` row owns a document's plain-text name, UUID, ordered JSONB sections, Classic theme key, positive integer version, and timezone-aware timestamps. A section has a stable UUID, optional single-line Markdown title, and Markdown body. No fixed employment/education schema exists. HTML, PDFs, and uploaded files are never document source. Atomic document writes preserve section order and identity without a second table or independent section lifecycle.

Actions validate names, section identity, single-line titles, and document bounds before persistence: names at most 120 UTF-16 units, 100 sections, titles 500 units, and total Markdown 500,000 units. Update and delete compare the acknowledged version in the same SQL statement that changes the row. A stale/deleted row fails rather than silently overwriting another tab.

The client debounces edits, serializes writes, and coalesces changes made during an in-flight request. It advances versions only after acknowledgement and never labels newer pending text as saved. Switching, creating, deleting, renaming, and exporting flush the queue before proceeding; transition/export controls lock input until the operation finishes. Failure retains the open document and local edits, blocks automatic retries, and exposes explicit retry plus an unsaved Markdown backup. Leaving with dirty content triggers the browser's unload warning. There is no persistent browser copy of personal documents. The selected UUID travels in the URL so reload restores the selected document without storing its content client-side.

## Markdown and import drafts

Markdown imports split top-level single-line level-two headings outside code into sections and keep leading material as an untitled block. Single-line setext headings are recognized; multiline setext headings remain unchanged in the body because section titles are single-line. Token offsets are mapped back to original line endings so body whitespace, including CRLF, survives. Export joins titles and bodies into readable Markdown; application identities/theme metadata and exact heading delimiter spelling are not a portable format. Cross-section reference-link definitions resolve document-wide in PDF rendering.

Import handlers bound multipart input and return reviewable drafts, not database writes. Only confirmation creates a new resume; no import overwrites an existing document. UTF-8 Markdown is limited by document bounds. PDF uploads are at most 10 MiB and 20 pages. Local unpdf/PDF.js extraction rejects invalid, encrypted (including empty-user-password encryption), and entirely textless PDFs, and warns about pages without recovered text. Extracted text is conservatively escaped into one editable Markdown block, with no inferred section structure, OCR, layout reconstruction, external calls, or promise of reading-order fidelity. Original bytes remain transient. These bounds are not public-upload sandboxing.

## Classic PDF and preview

A Node-only allowlisted marked-token traversal generates Letter PDFs using React PDF and bundled OFL-licensed Lato faces. Headings, paragraphs, emphasis, bold, lists, links, quotes, rules, and code are supported. Unsupported Markdown remains in source and is displayed as literal text with warnings, rather than silently discarded. Raw HTML is never injected or executed; Markdown cannot select remote image/font/resource fetches. Only HTTP(S) and mailto destinations become PDF links. Normal words stay intact; long identifiers can wrap by grapheme chunks rather than clipping or shrinking the document. Longer content flows naturally across pages with selectable text. Lato's glyph coverage is not universal.

Preview and download call the same renderer against a requested saved version. Export flushes current edits first; handlers reject a version mismatch. Preview requests are aborted/ignored when superseded, are labeled while edits await save, and use transient blob URLs released on replacement/unmount. The embedded viewer receives the actual generated PDF; open/download links remain available when browser embedding is unavailable. Rendering/extraction/database code does not enter the client bundle, and document responses use private/no-store headers. Next automatic logging is disabled: its development Server Function tracing otherwise serializes action arguments (including document names/content), and request logs expose document identifiers. Application errors remain generic and do not log resume source. Fonts are explicitly included in Next output tracing; no browser binary is needed by the server.

## Presentation boundary

The current title opens a transient document dropdown containing choices, New, and Import. Rename/Delete live in the current document's overflow menu; export actions remain on the right. There is no persistent document list/sidebar, full-document source mode, drag-and-drop framework, theme gallery, or live job/profile/AI navigation.

Canonical Kyu semantic tokens style a centered editor-specific 80rem/1280px frame **including** 30px gutters (22px at 650px and below). The navbar contents, navbar bottom rule, document title/actions and both equal-width panes share this frame. This is the user-approved exception to the original default 55rem frame: wider editing and preview space must not become a full-width dashboard or persistent sidebar. The two panes use all interior width, shrink with available space and stack on narrow screens. Mantine's stylesheet/provider and root font size remain intact. The root color-scheme script and provider both default to `auto`, resolving the system preference before hydration and following preference changes while open. Scoped Kyu semantic tokens use that resolved scheme for the canvas, controls, and portaled menus/dialogs; Classic PDF paper and exported colors remain independent of the UI scheme. Native semantics, focus restoration, visible focus, coarse-pointer 44px targets, reduced motion, zoom, and a 320px no-page-overflow layout govern the editor and its overlays.

## Verification boundaries

Unit tests cover coalescing, acknowledged versions, transport failures, failed-switch preservation, and stale previews. Generated PDF fixtures verify actual text, font embedding, page geometry/flow, links, unsafe/unsupported source, and extraction errors. The database integration runner creates a new ephemeral loopback PostgreSQL container, applies committed migrations, proves CRUD/order and competing-version writes, and removes only that container. Browser tests exercise actual server actions, imports, exports, two-tab conflicts, document selection/reload, and desktop/narrow keyboard/touch/text-scaling behavior. Browser PDF support varies; fallback behavior remains part of the contract.
