# Employer candidates and saved searches

`employers.json` contains **9,904 disabled board candidates**, not live-verified employers: 2,855 Ashby, 4,966 Greenhouse and 2,083 global Lever boards. They are derived from [LastRound AI's ATS company directory](https://github.com/fyrosofttech/lastroundai-hiring-data/blob/2816bfadd65b7bbec23701dd036bcc7496c729db/ats-directory/lastroundai-ats-company-directory-2026-08.csv), pinned to commit `2816bfadd65b7bbec23701dd036bcc7496c729db`. Credit: **LastRound AI**, [2026 salary transparency study](https://lastroundai.com/blog/salary-transparency-study-2026). The upstream dataset is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); its notice is reproduced verbatim below.

Changes from upstream: select all supported, compatible identifiers from 9,935 rows (exclude one Ashby and 30 Lever slugs that fail the existing no-dot identifier rule); convert CSV to JSON; add canonical board URLs, disabled flags and per-record provenance. The original seven records remain unchanged. `lastCrawled` retains the upstream July/August 2026 observation, **not** a verification by this project. The pinned CSV SHA-256 is `e637a04d06561bb3839dbf95a291e5fd11ac26b8f2858dc207939c1b723974a3`.

These are unverified **candidates**. No vendor certification, employer-legitimacy certification or endorsement is claimed. The directory license does not grant rights to the jobs, descriptions, trademarks or other third-party content. Revalidate each enabled board during collection and follow provider/source terms for storage, display and deletion.

## Configuration

`loadConfig(projectRoot = process.cwd())` reads `collector/employers.json`, `collector/searches.json`, and an optional **project-root** `collector.local.json`. It performs no network requests. Keep the local override out of version control; do not put credentials in any of these files. A missing override is fine; malformed/unreadable overrides fail closed.

All committed candidates must have `enabled: false`; only the local override enables boards. All three shipped searches are disabled examples, not recommendations or universal eligibility claims. Operators must choose their own phrases, geography and work styles before enabling collection.

Example local override (the `searches` array replaces, rather than merges with, the committed searches; omitting it preserves those searches):

```json
{
  "enabledBoards": ["ashby:ashby", "greenhouse:anthropic"],
  "searches": [
    {
      "id": "my-software-search",
      "name": "My configured software search",
      "enabled": true,
      "titlePhrases": ["software engineer", "software developer"],
      "countries": ["US", "Canada"],
      "locationPhrases": [],
      "allowUnknownLocation": false,
      "workArrangements": ["remote", "hybrid"],
      "allowUnknownWorkArrangement": false
    }
  ]
}
```

- JSON files contain arrays of boards/searches. Unknown fields, missing required fields, wrong types, duplicate JSON object keys (even escaped equivalents), duplicate board keys/search IDs, duplicate normalized phrases/countries/work styles and duplicate/unknown enabled board keys are rejected. `enabledBoards` is required in a local override; an empty list enables nothing.
- Only `ashby`, `greenhouse` and global `lever` are supported. EU Lever, other ATS and arbitrary URL targets are rejected. Board slugs and search IDs start with an ASCII alphanumeric character and contain only ASCII alphanumerics, `-` or `_`, up to 80 characters. No dots, paths, encodings, query strings or URL targets.
- `boardKey(board)` is exactly `provider:slug`. `boardUrl(provider, slug)` constructs exactly `https://jobs.ashbyhq.com/{slug}`, `https://boards.greenhouse.io/{slug}` or `https://jobs.lever.co/{slug}`. Contributed `boardUrl` must equal that value byte-for-byte. Outbound requests must use validated provider/slug construction, **never contributed URLs**, including provenance URLs. Attribution URLs are metadata only.
- Limits: 8 MiB for employer JSON, 1 MiB each for search/local JSON, 16 nesting levels, 15,000 boards, 50 searches, 30 phrases per phrase list, 120 characters per phrase, 200 per company/search name, 2 countries and 3 work styles. Board provenance requires an HTTPS attribution URL (up to 2048 characters, no credentials), nullable full lowercase commit hash, nullable valid `YYYY-MM-DD` crawl date and nullable license label (up to 120 characters).
- Searches require `id`, `name`, boolean `enabled`, a nonempty `titlePhrases` array, `countries`, `locationPhrases`, and boolean `allowUnknownLocation`. Only exact US/USA/United States/United States of America and CA/CAN/Canada aliases are supported in search countries (case/whitespace normalized). `workArrangements` and `allowUnknownWorkArrangement` may be omitted, defaulting to `[]` and `false`; otherwise they must have the correct types. Work styles are `remote`, `hybrid`, `onsite`.
- Within a search: any whole title phrase **AND** any configured structured country or explicit location phrase **AND** the optional work-style filter. Matching is case-insensitive with Unicode/whitespace/punctuation normalization and word boundaries (`AI` does not match `paid`). Enabled searches are OR'd, yielding their IDs in configuration order.
- Country matching uses reported structured country facts, never description text. Every reported location is considered. Location phrases are explicit operator alternatives to country matching, not inferred eligibility; e.g. configuring `remote` as a location phrase deliberately admits that reported text without claiming a country. Both location criteria arrays empty explicitly means unrestricted geography (including unknown). Otherwise unknown geography requires `allowUnknownLocation: true`, and only when **no** usable geographic fact exists anywhere on the job. A known foreign country/city/region is never made unknown just because it fails the filters. Remote/work-style/global-only labels establish no country.
- An empty work-style list means no work-style filter; otherwise an unknown arrangement requires `allowUnknownWorkArrangement: true`. A known excluded arrangement never passes via the unknown option. No work authorization, sponsorship or personal eligibility is inferred.
- `normalizeCountry` canonicalizes US/Canada aliases and preserves other nonempty countries as uppercase reported facts, rather than discarding foreign countries as unknown. `locationText(job)` retains all reported location text/city/region/country fields for storage/filtering, not descriptions or inferred geography.

## Bulk selection and import

Configuration commands never fetch job postings. All compatible candidates are already bundled; `import --all` is only needed to merge missing candidates from the same checksum-pinned CSV. Import does not enable them.

```sh
yarn collect:config import --all
yarn collect:config import ashby:SELECTED_SLUG lever:SELECTED_SLUG
# Explicit local opt-in, preserving existing board selections and saved searches:
yarn collect:config enable ashby:ashby lever:spotify
yarn collect:config enable --all
yarn collect:config validate
```

`enable --all` writes all configured keys to the ignored local override. Without a preexisting override, it creates only the board selection; bundled searches remain disabled. Configure an enabled search before running collection. Explicit import/enable keys must be distinct and known; bulk import alone filters incompatible identifiers. Malformed metadata fails closed. Remove local `enabledBoards` entries to disable them. Collection remains manually batched; see [operations](README.md).

## Contributions

Propose candidate records through a reviewed pull request, with source provenance, attribution and original crawl date. Keep candidates disabled, preserve upstream attribution, run the fixture validation/matching tests and CI checks, and obtain maintainer review before an operator enables anything. A successful API response is not certification or a grant of job-content rights. Do not sweep live boards or replace the pinned source without an explicit decision. Bulk import downloads only the pinned directory; it never probes or activates its boards.

## Upstream license notice (verbatim)

```text
Creative Commons Attribution 4.0 International (CC BY 4.0)

Copyright (c) 2026 LastRound AI

The datasets and documentation in this repository are licensed under the
Creative Commons Attribution 4.0 International License.

You are free to share and adapt the material for any purpose, including
commercially, provided you give appropriate credit to LastRound AI and link to
https://lastroundai.com/blog/salary-transparency-study-2026

Full licence text: https://creativecommons.org/licenses/by/4.0/legalcode

Contact: contact@lastroundai.com
```
