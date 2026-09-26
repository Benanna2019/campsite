# Calls: architecture

The calls slice is a standalone app in `apps/calls`. It reimplements calls,
recordings and transcripts (see [lifecycle.md](./lifecycle.md)) on:

- **Convex** for data, server logic, realtime reads, scheduling and webhook
  endpoints.
- **Cloudflare RealtimeKit** for the media: meetings, participants, recording,
  transcription and summaries.
- **Effect** for everything that talks to the outside world.
- **Alchemy** to provision the Cloudflare side as code.

## Decisions

### Convex is the only backend

Rails runs three systems for calls: MySQL, Sidekiq and Pusher. Convex replaces
all three. Queries are reactive, so the `trigger_stale` calls scattered through
the Rails handlers have no equivalent here; a client watching a call sees the
change when the mutation commits. Scheduled functions replace Sidekiq.

There is no Worker in the request path. RealtimeKit webhooks land on a Convex
HTTP action. A Worker would be a second backend with nothing to do.

### Effect at the edges, plain Convex in the core

Mutations and queries are deterministic, transactional database code. Convex
already gives them the properties Effect would add (atomicity, typed args), so
they stay plain.

Effect is used where things can fail in interesting ways:

- the RealtimeKit REST client (typed errors, retry policy, decoded responses),
- webhook verification and decoding (one `Schema` union for every event),
- the recording pipeline (download, parse, match, store, as one program).

Actions build their Effect program and run it at the boundary with
`Effect.runPromise`. Nothing outside `convex/lib` needs to know Effect is there.

### Idempotent upserts keyed by remote ids

RealtimeKit delivers webhooks unordered and retries on `5xx`. Every handler
upserts by the remote id (session, peer, recording), mirroring Rails'
`create_or_find_by!`. Out-of-order arrival (a join before `meeting.started`)
creates the parent call on demand.

### Webhook inbox

The HTTP action verifies the signature, decodes the event, and writes it to a
`webhookEvents` table in the same mutation that applies it. It returns `200`
only after that commit. Anything slow (downloading a transcript) is scheduled,
never done inline. The inbox gives replay and debugging for free.

### Tokens are minted server-side

A Convex action calls RealtimeKit's add-participant endpoint with our user id as
`custom_participant_id`. The browser only ever sees its own participant token.
There is no equivalent of the 100ms app secret on the client, and none in Convex
beyond the Cloudflare API token.

### Effect 4

Alchemy v2 requires Effect 4, so the app pins the same Effect release as the
infrastructure code. Versions are pinned exactly; both are pre-1.0 APIs.
