# Campsite Calls

Calls, recordings and transcripts on Convex + Cloudflare RealtimeKit, written
with Effect and provisioned with Alchemy. See
[`docs/calls`](../../docs/calls) for the lifecycle spec and architecture.

## Setup

This app installs on its own, outside the monorepo workspace (see below):

```sh
cd apps/calls
pnpm install --ignore-workspace
pnpm dev        # Convex dev backend + Vite
```

`pnpm dev` asks you to log in to Convex or use a local deployment. For a
throwaway local backend with no account:

```sh
CONVEX_AGENT_MODE=anonymous pnpm dev
```

## Scripts

- `pnpm test` runs Convex functions in-process with `convex-test`
- `pnpm typecheck`
- `pnpm build`

## Why it's outside the workspace

A monorepo install requires Tiptap Pro registry credentials
(`packages/editor`). This app shares no code with the rest of the monorepo, so
it keeps its own lockfile and is excluded in `pnpm-workspace.yaml`. When it
needs `packages/ui`, fold it back in.
