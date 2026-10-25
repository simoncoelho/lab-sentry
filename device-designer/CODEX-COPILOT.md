# Classifier copilot

Run `npm run dev` with Node 24+ and the Codex CLI available on PATH. Sign in with `codex login` first. `CODEX_BIN` can point to an alternate Codex executable. No API key is required.

The Vite development server exposes a local `/classifier-api/chat` endpoint. Each request launches a short-lived Codex app-server over stdio using the existing local Codex account and configured model. It supplies the approved classifier and conversation, requests structured JSON, and validates the proposed definition before showing it. The conversation is kept in the current UI session; applied definitions are saved/exported with the workspace. No camera frames are sent.

Apply draft adopts a proposal; Save design persists it. Manual editing remains available under Edit definition. Requests can be stopped or retried. Changes made during a request prevent applying a stale proposal. A new conversation clears chat context without changing the definition.

This endpoint is part of the local development server, not the static production bundle. Hosted deployment requires a separately authenticated server adapter. Do not expose this local service publicly. Requests have origin, size, concurrency and timeout limits. Codex runs with read-only sandboxing, no approvals, and instructions to use no tools or hardware.

Protocol reference: https://learn.chatgpt.com/docs/app-server
