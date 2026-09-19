# General agent MVP

P2AT-024A adds a project-independent agent foundation to the desktop application. It does not import Planner state, game data, DOM or Electron from its reusable core.

## Public modules

- `apps/planner-desktop/src/agent-core/base-agent.js`: `BaseAgent` and the first `ChatAgent`.
- `apps/planner-desktop/src/agent-core/base-tool.js`: `BaseTool`, bounded JSON parsing and the schema-validation contract.
- `apps/planner-desktop/src/agent-core/tool-registry.js`: explicit tool allowlist and provider definitions.
- `apps/planner-desktop/src/agent-core/model-provider.js`: injected provider interface.
- `apps/planner-desktop/src/agent-core/agent-runner.js`: bounded model → tool → model loop.
- `apps/planner-desktop/src/agent-core/calculator-tool.js`: the only MVP tool; finite-number arithmetic without `eval` or side effects.
- `apps/planner-desktop/electron/openai-compatible-provider.cjs`: OpenAI-compatible `GET /models` adapter with Chat Completions and Responses wire support.
- `apps/planner-desktop/electron/agent-service.cjs`: in-memory configuration/conversation owner and narrow IPC handlers.

`ModelProvider.complete()` receives `{ model, messages, tools, signal }` and returns `{ content, toolCalls }`. Each tool call has `{ id, name, arguments }`. `BaseTool` exposes `name`, `description`, JSON-schema-style `parameters`, validated arguments and asynchronous `execute(args, { signal })`.

Future Planner integration must add a reviewed tool to `ToolRegistry`; it must not couple Planner state into `agent-core` or bypass `AgentRunner`.

## Loop and limits

The runner makes at most 6 model requests and 12 tool calls per run. It retains at most 80 runner messages, truncates model text at 32,000 characters, tool-call arguments at 16 KiB and each tool result at 8,000 characters. Input is limited to 12,000 characters. The service trims only complete user/tool protocol turns and retains at most 60 conversation messages / 256,000 serialized characters. Provider requests are limited to 512 KiB, responses to 2 MiB, provider requests time out after 90 seconds and the whole run after 120 seconds. One session permits only one active run.

Text without tool calls finishes the run. Tool calls are validated and executed sequentially, appended with the exact call ID, then returned to the model. Unknown tools, malformed JSON/schema arguments and execution errors become controlled tool results. Cancellation and timeouts propagate through provider and tool signals. No automatic paid retry is performed.

## Provider compatibility boundary

The first adapter follows the OpenAI Chat Completions and Responses tool-call shapes plus the Models list shape. When a responses-only relay returns its HTML frontend or a 404 for Chat Completions, the provider switches to `/responses` and remembers that protocol for the active connection. Bounded JSON and server-sent-event responses are accepted. Compatible vendors may differ. A successful model listing does not prove tool support. A model/service that rejects tools produces an explicit message; users can disable the calculator and use ordinary chat. Model IDs are treated only as inert display/request values.

Implementation references: OpenAI [Models API](https://platform.openai.com/docs/api-reference/models) and [API authentication/reference](https://platform.openai.com/docs/api-reference). The adapter intentionally remains separate because other “compatible” vendors may implement only a subset or vary error behavior.

Only HTTPS base URLs are accepted, except explicit HTTP loopback (`localhost`, `127.0.0.1`, `::1`). Private/link-local IP literals other than loopback, credentials, fragments and query strings are rejected. Redirects are never followed with the key. TLS verification is not disabled. A user-entered DNS hostname remains an explicit trust decision; the MVP does not pin DNS answers.

## Key and session lifecycle

The API Key is accepted only by a password input, submitted through narrow IPC, and immediately removed from the renderer input. Electron `safeStorage` encrypts it with the operating-system credential facility before a versioned cache is written under the application's local user-data directory. The renderer never receives either plaintext or ciphertext. There is no plaintext fallback when OS encryption is unavailable. Status responses expose only connection state, target host, and whether a credential is cached. The key is never logged or included in prompts/tool arguments/results. **清除 Key** removes both the active in-memory credential and its encrypted local cache; changing the API address clears the active connection until the new address and key have been saved successfully.

Conversation history is memory-only. New session, cancellation and configuration generation checks prevent late responses from entering a replacement conversation.

## Run and review

From `apps/planner-desktop`:

```bash
npm ci
npm start
```

Open **智能体**, enter the service URL and key locally, connect, fetch or manually type a model, then send a message. No real-service claim is made without a user-supplied key. Automated tests use explicit mock providers and HTTP responses.

The no-secret preview is stored at `docs/assets/screenshots/agent-mvp.png`. It is captured while Planner data is unavailable to verify that the Agent view is not gated by tree initialization.

### Live compatibility acceptance (2026-09-19)

A user-authorized, low-limit third-party OpenAI-compatible relay was used for live acceptance. `GET /v1/models` returned three selectable models. `deepseek-v4-flash` completed ordinary Chinese chat and the full two-request calculator loop (`123 × 456 = 56088`) with the exact tool call ID preserved. One advertised model returned HTTP 402 and another returned an empty HTTP-200 message for ordinary chat / truncated text after a tool result; these are now surfaced as provider failures rather than presented as successful empty replies. This evidence validates the application loop and also demonstrates why listing a model cannot be treated as a capability guarantee. Credential-cache tests use synthetic secrets and verify that plaintext is absent from disk, encrypted credentials restore in a fresh store instance, clearing removes the cache, and unavailable OS encryption fails closed.
