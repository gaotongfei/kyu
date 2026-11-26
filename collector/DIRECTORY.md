# Employer candidates and saved searches

`employers.json` is a **derivative subset**, not a live verification or a complete employer directory. Its seven records were selected from [LastRound AI's ATS company directory](https://github.com/fyrosofttech/lastroundai-hiring-data/blob/2816bfadd65b7bbec23701dd036bcc7496c729db/ats-directory/lastroundai-ats-company-directory-2026-08.csv), pinned to commit `2816bfadd65b7bbec23701dd036bcc7496c729db`. Credit: **LastRound AI**, [2026 salary transparency study](https://lastroundai.com/blog/salary-transparency-study-2026). The upstream dataset is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); its notice is reproduced verbatim below.

Changes from upstream: select seven rows; convert CSV to JSON; add canonical board URLs, disabled flags and per-record provenance. `lastCrawled` is the original dataset observation, **not** a verification by this project:

| Provider | Slug | Company | Upstream last crawled |
| --- | --- | --- | --- |
| ashby | ashby | Ashby | 2026-07-12 |
| ashby | linear | Linear | 2026-07-17 |
| ashby | notion | Notion | 2026-07-17 |
| ashby | openai | OpenAI | 2026-07-17 |
| greenhouse | anthropic | Anthropic | 2026-07-17 |
| greenhouse | figma | Figma | 2026-07-17 |
| greenhouse | stripe | Stripe | 2026-07-17 |

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
- Only `ashby` and `greenhouse` are supported. Lever and arbitrary URL targets are rejected. Board slugs and search IDs start with an ASCII alphanumeric character and contain only ASCII alphanumerics, `-` or `_`, up to 80 characters. No dots, paths, encodings, query strings or URL targets.
- `boardKey(board)` is exactly `provider:slug`. `boardUrl(provider, slug)` constructs exactly `https://jobs.ashbyhq.com/{slug}` or `https://boards.greenhouse.io/{slug}`. Contributed `boardUrl` must equal that value byte-for-byte. Outbound requests must use validated provider/slug construction, **never contributed URLs**, including provenance URLs. Attribution URLs are metadata only.
- Limits: 1 MiB per JSON file, 16 nesting levels, 500 boards, 50 searches, 30 phrases per phrase list, 120 characters per phrase, 200 per company/search name, 2 countries and 3 work styles. Board provenance requires an HTTPS attribution URL (up to 2048 characters, no credentials), nullable full lowercase commit hash, nullable valid `YYYY-MM-DD` crawl date and nullable license label (up to 120 characters).
- Searches require `id`, `name`, boolean `enabled`, a nonempty `titlePhrases` array, `countries`, `locationPhrases`, and boolean `allowUnknownLocation`. Only exact US/USA/United States/United States of America and CA/CAN/Canada aliases are supported in search countries (case/whitespace normalized). `workArrangements` and `allowUnknownWorkArrangement` may be omitted, defaulting to `[]` and `false`; otherwise they must have the correct types. Work styles are `remote`, `hybrid`, `onsite`.
- Within a search: any whole title phrase **AND** any configured structured country or explicit location phrase **AND** the optional work-style filter. Matching is case-insensitive with Unicode/whitespace/punctuation normalization and word boundaries (`AI` does not match `paid`). Enabled searches are OR'd, yielding their IDs in configuration order.
- Country matching uses reported structured country facts, never description text. Every reported location is considered. Location phrases are explicit operator alternatives to country matching, not inferred eligibility; e.g. configuring `remote` as a location phrase deliberately admits that reported text without claiming a country. Both location criteria arrays empty explicitly means unrestricted geography (including unknown). Otherwise unknown geography requires `allowUnknownLocation: true`, and only when **no** usable geographic fact exists anywhere on the job. A known foreign country/city/region is never made unknown just because it fails the filters. Remote/work-style/global-only labels establish no country.
- An empty work-style list means no work-style filter; otherwise an unknown arrangement requires `allowUnknownWorkArrangement: true`. A known excluded arrangement never passes via the unknown option. No work authorization, sponsorship or personal eligibility is inferred.
- `normalizeCountry` canonicalizes US/Canada aliases and preserves other nonempty countries as uppercase reported facts, rather than discarding foreign countries as unknown. `locationText(job)` retains all reported location text/city/region/country fields for storage/filtering, not descriptions or inferred geography.

## Contributions

Propose candidate records through a reviewed pull request, with source provenance, attribution and original crawl date. Keep candidates disabled, preserve upstream attribution, run the fixture validation/matching tests and CI checks, and obtain maintainer review before an operator enables anything. A successful API response is not certification or a grant of job-content rights. Do not sweep the upstream directory, import Lever, or replace the pinned source without an explicit decision.

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
