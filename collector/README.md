# Collector operations

Run migrations and configure the ignored project-root `collector.local.json` before invoking collection. [DIRECTORY.md](DIRECTORY.md) documents the candidate registry, saved-search fields, matching and licensed source attribution. Nothing is scheduled or invoked by the browser.

## Configure and invoke

```sh
test -f collector.local.json || cp collector.local.example.json collector.local.json
# Choose explicit enabledBoards and searches; defaults are disabled.
yarn collect:config validate
yarn collect --hirebase-budget 0           # enabled boards only
yarn collect --hirebase-budget 2           # small Hirebase result allocation
yarn collect --hirebase-budget available   # explicitly use remaining Free capacity
```

For Hirebase, add `HIREBASE_API_KEY` only to this workspace's server environment. A requested search without a key is skipped and the run is incomplete. Use `enabledBoards: []` to run Hirebase alone. Unknown, legacy, paid or billed-overage allowances fail closed; nothing upgrades a plan.

Free currently allows **500 returned records/month**, resetting on the first UTC day. Duplicates, nonmatches and repeat observations consume capacity. Provider remaining allowance, the invocation cap and persistent local accounting all apply. Ambiguous spending remains reserved and is not blindly retried. `available` can exhaust the month's allowance.

The local `searches` list replaces the bundled list. Unknown required facts are excluded unless opted in; remote is not country/work-authorization evidence. Search edits prune nonmatching content on the next invocation: **disabling every search clears the catalog**. Previously excluded jobs require a refetch to be included.

## Reports, partial results and deletion

The JSON report includes source completeness/counts/messages and requested/reserved/returned/uncertain Hirebase usage. Retained counts mean upsert observations, not unique new jobs. Exit codes are `0` success, `2` incomplete/report failure and `1` setup/execution exception. Successful sources commit independently, and interrupted spending is not reset.

Only complete same-board refreshes close missing listings. Partial sources preserve old observations, including previously collected compensation when a pay-detail lookup fails. Hirebase search absence never proves closure. The page exposes dates and stale/incomplete-source notices. A lost database lease stops new calls/writes; row fencing prevents stale runs overwriting a newer invocation.

```sh
# Small, explicitly incomplete board sample; cannot close missing jobs:
yarn collect --hirebase-budget 0 --max-board-jobs 5
# Delete source content and suppress re-ingestion of that identity:
yarn collect purge --source hirebase --job-id PROVIDER_JOB_ID --confirm delete
# Import only selected identifiers from the pinned directory; no board probing/activation:
yarn collect:config import ashby:SELECTED_SLUG greenhouse:SELECTED_SLUG
```

Purge uses the exact source/ID shown in job details (`hirebase`, `ashby:BOARD`, `greenhouse:BOARD`). Follow source deletion notices and terms. Directory/API access is not blanket permission to redistribute job content. Global Hirebase expiration-feed synchronization is not implemented; its 14-day feed cannot recover arbitrary stale history. Candidate contributions remain disabled and require validation plus maintainer review. Lever and arbitrary URL crawling are unsupported.

## Verification boundaries

`yarn test:collection:postgres` creates a uniquely labeled PostgreSQL 18 container on a random loopback port with temporary storage. It checks ownership before cleanup and never drops an existing database/volume; `postgres:18-alpine` is pulled if absent. All automated provider responses are fixtures, regardless of environment keys.

Initial live compatibility checks used only one Ashby list, one Greenhouse list and one Greenhouse pay detail, without application-database persistence. **Hirebase remains fixture-verified: no live key/request was used.** Official docs were reviewed, but direct access to its application terms page was blocked; verify current plan/source terms before use. No deployment, publishing or provider subscription is part of collection.
