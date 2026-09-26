# Campsite Calls

Calls, recordings and transcripts on Convex + Cloudflare RealtimeKit, written
with Effect, served by TanStack Start and provisioned with Alchemy. See
[`docs/calls`](../../docs/calls) for the lifecycle spec and architecture.

## Setup

This app installs on its own, outside the monorepo workspace (see below):

```sh
cd apps/calls
pnpm install --ignore-workspace
pnpm dev        # Convex dev backend + TanStack Start dev server
```

`pnpm dev` asks you to log in to Convex or use a local deployment. For a
throwaway local backend with no account:

```sh
CONVEX_AGENT_MODE=anonymous pnpm dev
```

## Scripts

- `pnpm test` runs Convex functions in-process with `convex-test`
- `pnpm typecheck`
- `pnpm build` builds the TanStack Start app (client and server)

## Why it's outside the workspace

A monorepo install requires Tiptap Pro registry credentials
(`packages/editor`). This app shares no code with the rest of the monorepo, so
it keeps its own lockfile and is excluded in `pnpm-workspace.yaml`. When it
needs `packages/ui`, fold it back in.

## Deploying

Two deploys, Convex first so the webhook has somewhere to land:

1. **Convex:** `npx convex deploy`. Then set Convex Auth's keys on the
   production deployment (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`), per
   https://labs.convex.dev/auth/setup/manual.
2. **Cloudflare:** `pnpm deploy` (Alchemy). First run needs a Cloudflare
   profile: `npx alchemy profile edit --profile default --add Cloudflare`.
   RealtimeKit must be enabled on the account (it's in beta).

The Alchemy deploy reads these from `.env` (or the shell):

| Variable | Used for |
|---|---|
| `CONVEX_SITE_URL` | Webhook target: `<CONVEX_SITE_URL>/realtimekit/webhook` |
| `VITE_CONVEX_URL` | Baked into the TanStack Start client build |
| `CONVEX_DEPLOY_KEY` | Lets the stack run `convex env set` on that deployment |

It creates the RealtimeKit app, the `participant` preset, the webhook, and an
API token scoped to Realtime Admin, then sets `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `REALTIMEKIT_APP_ID` and `REALTIMEKIT_PRESET` on the
Convex deployment. Optional: pin the webhook signing key with
`REALTIMEKIT_WEBHOOK_PUBLIC_KEY`; otherwise it's fetched from RealtimeKit.

RealtimeKit has no delete API for apps yet, so `pnpm destroy` forgets the app
rather than removing it.
