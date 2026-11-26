# Resume HTML support research

HTML is **not enabled** by this styling change. Raw HTML still appears as literal source with a warning in both the preview and PDF. This note describes a possible extension, not a supported input contract.

## What the reference does

Inspected `junian/markdown-resume` at commit `4d6cefc01e37af2eb981c8e3f9dfdef81af9a34c` (default `master` branch):

- [`app/utils/markdown.ts:12–31`](https://github.com/junian/markdown-resume/blob/4d6cefc01e37af2eb981c8e3f9dfdef81af9a34c/app/utils/markdown.ts#L12-L31) enables `markdown-it` with `html: true`, along with definition lists and other extensions.
- [`SmartPages.ts:139–149`](https://github.com/junian/markdown-resume/blob/4d6cefc01e37af2eb981c8e3f9dfdef81af9a34c/app/libs/vue-smart-pages/components/SmartPages.ts#L139-L149) assigns the rendered string to `innerHTML`. The inspected Markdown-to-preview path does not include a sanitizer.
- [`default-resume.css.txt:14–80`](https://github.com/junian/markdown-resume/blob/4d6cefc01e37af2eb981c8e3f9dfdef81af9a34c/app/assets/default-resume.css.txt#L14-L80) provides compact margins, a tracked centered name, thin H1/H2 rules, shallow lists, and flex-based definition lists. The three-column contact/job rows come from definition-list syntax, not HTML support alone.

Kyu borrows the visual proportions, not that HTML injection path. Its PDF adapter renders React PDF primitives, not browser HTML; accepting HTML only in the browser would silently produce different documents on export. Our existing `marked` dependency also explicitly [warns that it does not sanitize output](https://marked.js.org/#usage).

## Recommended extension boundary

Start with a small, explicitly chosen semantic subset rather than arbitrary HTML/CSS:

1. Parse complete HTML fragments with a browser/Node-compatible, non-fetching HTML parser. Inline opening and closing tags may arrive as separate Markdown tokens; do not sanitize individual tokens or attempt tag matching with regular expressions. Preserve existing Markdown/reference handling and literal fallback for unsupported source.
2. Allowlist elements and attributes while lowering the parsed fragments into the existing shared `InlineNode` / `BlockNode` tree. Existing equivalents include `<br>`, `<strong>`, `<em>`, `<code>`, and `<a href>`; `<u>`, `<sup>`, or `<sub>` would require explicit nodes and support in **both** adapters. A generic `<span>` could preserve its text, but must not gain arbitrary styling or icon behavior.
3. Reuse destination validation for links, including entity/control-character checks. Reject event attributes, scripts, styles, forms, frames, embedded objects, resource elements and all unapproved attributes. No user CSS, classes, IDs, `data-*` icon directives, remote images, fonts or SVG.
4. Render only the resulting safe nodes as React elements and PDF primitives. Do not introduce `dangerouslySetInnerHTML`, an iframe, a browser PDF renderer, or independent browser-only sanitization. A sanitized HTML string alone does not supply PDF semantics.
5. Keep unsupported markup visible with clear warnings and keep original Markdown untouched. Define malformed/mixed HTML behavior before implementation; retain document-size and nesting safeguards.

Before enabling any subset, add shared-parser fixtures for nested/malformed tags, mixed Markdown, entities, source fallback, unsafe links and malicious attributes. Verify equivalent HTML/PDF text and semantics, no external resource requests, bounded nesting, and unchanged source import/export. A later layout feature such as contact columns needs its own shared document-tree representation; allowing `<div style="...">` is not a shortcut.
