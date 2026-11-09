# TalkChat AI assistant

The assistant is an authenticated TalkChat feature backed by OpenAI's Responses API. It uses `gpt-4.1-mini`, sends the current prompt plus up to 12 recent assistant-chat messages, and limits output to 600 tokens. It has no tools and cannot read users' TalkChat messages, profiles, files, or other account data.

## Server configuration

- The server reads `OPENAI_API_KEY` from `process.env` only when an authenticated user sends an assistant request.
- Configure the variable in the Render service's environment settings and restart/redeploy the service. Do not put the key in Replit, GitHub, browser code, request payloads, or logs.
- If the variable is absent, the UI displays a configuration error and the server does not send a request.
- No OpenAI SDK or other package was added; the server uses Node's built-in `fetch`.

## Data, privacy, and limits

- Assistant history is stored in the existing application database under `aiAssistant.json`, keyed by the authenticated TalkChat username. Each account can read and clear only its own history. At most 60 messages are retained per account.
- Prompts and recent assistant history are sent to OpenAI to generate an answer. OpenAI response storage is disabled with `store: false`; this does not change OpenAI's processing or data-control policies. Do not enter passwords, API keys, or other secrets.
- Each user is limited to 6 requests per minute and 40 per UTC day. A request counts once it is accepted for forwarding to OpenAI, including attempts that later fail. Output is capped at 600 tokens and prompts at 2,000 characters. These controls limit usage but are not a guarantee of a specific dollar ceiling; configure an appropriate usage budget in the OpenAI account as an additional safeguard.
- OpenAI API usage is billed separately from TalkChat hosting and depends on the current model pricing and token usage. Check [OpenAI API pricing](https://openai.com/api/pricing/) and the account's usage dashboard for current charges.
