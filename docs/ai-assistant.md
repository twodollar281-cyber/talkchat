# TalkChat AI assistant

The authenticated TalkChat assistant uses the Cloudflare Workers AI REST API and the @cf/zai-org/glm-4.7-flash model. It sends the current prompt plus up to 12 recent assistant-chat messages, capped at 8,000 prior-context characters, and limits generated output to 600 completion tokens. It has no tools and cannot read TalkChat profiles, messages, files, or other account data.

## Server configuration and billing safety

Set these only in the Render server environment; never add credentials to GitHub, browser code, request payloads, logs, or client bundles:

- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_API_TOKEN
- AI_ENABLED=false (set to true only after owner verification)
- CLOUDFLARE_OWNER_VERIFIED=false (set to true only after billing is verified)

The assistant is disabled unless both opt-in flags are exactly true. Before setting them, an adult Cloudflare account owner must verify the account's plan, billing method, AI Gateway credits/routing, and usage limits. If a no-charge configuration cannot be confirmed, leave both flags unset. This repository cannot inspect or change the Cloudflare account's billing settings.

Cloudflare documents a 10,000-Neuron daily free allocation; usage above it is billed on Workers Paid at the published rate, while requests exceeding the free allocation fail on Workers Free. Model usage is metered by tokens/neurons, so request-count caps are defense in depth, not a hard dollar ceiling. No paid plan, payment method, fallback provider, or automatic retry is enabled by this code.

The server-side limits default to 8 requests per account per UTC day and 3 requests per authenticated username per minute. Configure AI_ASSISTANT_DAILY_LIMIT from 1–40 and AI_ASSISTANT_PER_MINUTE_LIMIT from 1–6; invalid settings use conservative defaults and values above the hard caps are clamped. Prompts are limited to 2,000 characters, prior context to 8,000 characters, each stored message to 10,000 characters, and model output to 600 completion tokens. Request quotas use the existing database/storage helpers. They are not atomic across multiple app instances, so Cloudflare account-level free/no-charge settings remain necessary.

Quota, authorization, billing, and model-availability errors are shown as friendly messages and are not retried. The server never falls back to another provider or model. Configure the account credentials and flags only after the owner has verified billing settings; no key is needed in the browser.

## History and privacy

Assistant history remains in the existing application store under aiAssistant.json, keyed by the authenticated TalkChat username. Each account can read or clear only its own history. The existing server-side database helpers are reused; no new database or dependency is added.

The request sets store: false. Cloudflare's Workers AI data-usage documentation says standard inference requests that do not use a stateful feature are not retained after processing and that prompt content is not used to train AI models; it also describes limited exceptions and retained operational metadata. TalkChat's delete-history action clears TalkChat's stored history and does not purport to delete provider-side data. Do not enter passwords, API keys, or other secrets.

References: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [GLM-4.7-Flash model](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/), [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).
