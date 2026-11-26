---
id: kyu-assistance
type: module-design
status: draft
title: On-demand application-writing assistance
parent: kyu-architecture
depends-on: [kyu-database, kyu-resume-editor]
---

## Responsibility and entry points

Writing assistance prepares application materials for one explicitly chosen collected job and saved resume. `/prepare` is separate from the editor and the read-only catalog; the catalog supplies only a source-scoped link. One explicit generation produces a complete resume/cover-letter pair, not a fit score, eligibility decision, application submission, Python agent, or background job. The editor remains independently usable.

Ordinary page reads, startup, builds, collection and automated tests never contact AI providers. Explicit connection, model refresh, generation, OAuth callback/renewal and disconnect operations may contact their selected provider. Model generation is never used as a connection check. No provider, model, billing-method or paid-request retry fallback is allowed.

## Connection and credential boundary

One trusted owner configures a private self-hosted instance. There is no new public authentication boundary. Provider/model preferences and versioned AES-256-GCM credential envelopes occupy the singleton settings row owned by `kyu-database`. A server-only 32-byte base64 `KYU_AI_ENCRYPTION_KEY` authenticates separate credential slots and a key-check envelope. Missing configuration blocks writes; wrong keys or damaged envelopes fail closed without replacing credentials. Backups must preserve the installation key as well as the database; key rotation is not automatic.

The browser receives an explicit public settings projection, never saved keys, access/refresh/ID tokens or arbitrary stored JSON. Keys are entered transiently through password controls and cleared after submission, not saved in browser storage. Next automatic request/Server Action logging remains disabled. Errors never reflect SQL, authorization URLs, private source, or provider bodies.

A transaction advisory lock plus row lock serializes settings writes and rotating-token renewal across processes, including creation of the singleton. Inference runs outside that transaction. Removing the active connection clears the selection instead of choosing another billing source. Requests already sent cannot be recalled by removing a key.

## Provider and model selection

OpenAI API and OpenRouter API keys work on supported private computer/server installs. Provider URLs are fixed HTTPS endpoints with redirect refusal, not arbitrary configured base URLs. Connection/model refresh explicitly loads a bounded catalog; OpenRouter uses its authenticated, preference-filtered `/models/user` catalog and advertises structured-output models only. Model selection is saved explicitly. GPT-5.4 mini is merely a suggested default when its exact ID is available; no alternate model is silently selected. Catalog visibility is not a guarantee of inference entitlement or structured-output compatibility.

OpenAI uses the Responses API; OpenRouter uses strict-schema chat completions with parameter support required and upstream fallback disabled. Provider data controls/retention still apply; `store:false` is not a promise of zero retention. OpenRouter receives the selected text and routes it to its model provider, which is stated before generation.

## Local ChatGPT-plan authorization

Eligible same-computer HTTP-loopback installations may use the official Sign in with ChatGPT preview. Remote visits cannot activate, refresh models for, or generate through this connection; their API-key options remain available. This is a provider-preview restriction, not a local-only application architecture. No Codex credentials, coding tools, restricted DevKit source or assumed subscription API credit are used.

The documented OAuth/PKCE flow retains a stable installation host UUID and one issued client/account registration for reconnect. State, nonce, verifier and pending phase are encrypted and short-lived; callbacks are claimed once. The route validates the incoming `127.0.0.1` Host and reconstructs its authority because Next can normalize `request.url` to a different server hostname. The complete callback must match the saved redirect URI and state. A newly issued client ID is committed before code exchange so a failed exchange does not discard registration.

JOSE verifies signature, issuer, audience, issuance/expiry, nonce and returning subject; granted scopes must include `chatgpt.tokens.use.direct`. Trusted discovery/JWKS are obtained before sending a refresh grant, then replacement ID-token verification is local, avoiding metadata-network failures after consuming a rotating refresh token. Renewals commit replacement credentials together. Disconnect attempts trusted session revocation, clears local tokens, retains registration, and reports unconfirmed remote revocation. Account-switch management is not supplied.

The preview requires public Responses API requests with `store:false`, `stream:true`, an input array and a final `response.completed` event. Failed/incomplete/interrupted/refused streams never become drafts. `max_output_tokens` is unsupported for this connection: local timeout/received-output limits do not guarantee a hard plan-usage ceiling. Manage usage links to ChatGPT's own controls. Unsupported model/schema capabilities fail explicitly without falling back to API billing.

## Source, output and draft lifecycle

The generation action loads the exact source-scoped stored job and selected resume UUID/version; a stale/deleted resume requires explicit refresh/reselection before any model request. Each source text is bounded to 20,000 UTF-16 units; title/employer are bounded to 1,000. Empty, malformed or oversized sources fail without truncation. Descriptions remain untrusted data, not model instructions or eligibility evidence.

One structured response has exactly two nonempty Markdown strings, bounded to 20,000 units for the generated resume and 12,000 for the letter. Prompts restrict rewriting to supported source facts, but factual accuracy is not programmatically guaranteed: review guidance remains visible. API-key requests cap generated tokens at 8,000. Each inference transport has a 90-second deadline, bounded bodies/text and no automatic retry. Provider errors preserve existing selections and edited drafts.

Drafts live only in page memory and remain editable as plain source; model HTML is never mounted. Regeneration and same-tab navigation confirm discarding unhandled drafts, and unload warns for unsaved output or pending generation. Saving calls the editor's existing create-only validation/storage path and acknowledges a new UUID; it never updates the source or a previously saved copy. The letter is downloaded, not stored as a resume. Downloads preserve the edited source; manual editing/saving retains the editor's ordinary document bounds. New-tab access to a saved copy leaves drafts open.

## Verification and external limits

Fixture-only transport, encryption, callback/selection, real-signature JOSE and UI tests prohibit live provider use. Disposable PostgreSQL checks prove encrypted persistence, concurrent settings updates, no fallback on removal, wrong-key preservation, idempotent additive migrations and unchanged resume data. Live account sign-in, provider/model acceptance and paid generation remain unverified until explicitly authorized by an operator.

Official contracts: [ChatGPT integration](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [sign-in protocol](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [OpenRouter](https://openrouter.ai/docs).
