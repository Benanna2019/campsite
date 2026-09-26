// The calls app's Cloudflare side, as code: the RealtimeKit app, the preset
// participants join with, the webhook into Convex, a least-privilege API token
// for Convex to call RealtimeKit with, and the TanStack Start site.
//
// Convex itself deploys with `npx convex deploy`; this stack pushes the values
// Convex needs (app id, preset, token) into its environment so one
// `alchemy deploy` leaves both sides configured. See README "Deploying".
import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Every event lifecycle.ts handles (docs/calls/lifecycle.md). */
const WEBHOOK_EVENTS = [
  'meeting.started',
  'meeting.ended',
  'meeting.participantJoined',
  'meeting.participantLeft',
  'meeting.chatSynced',
  'recording.statusUpdate',
  'meeting.transcript',
  'meeting.summary',
] as const

const PRESET_NAME = 'participant'

/**
 * Sets RealtimeKit settings on the Convex deployment named by
 * CONVEX_DEPLOY_KEY (or CONVEX_DEPLOYMENT). Re-runs only when an input
 * changes, e.g. the token rotates.
 */
const ConfigureConvex = Alchemy.Action(
  'ConfigureConvex',
  (input: { accountId: string; appId: string; preset: string; apiToken: Redacted.Redacted<string> }) =>
    Effect.gen(function* () {
      const vars: Record<string, string> = {
        CLOUDFLARE_ACCOUNT_ID: input.accountId,
        REALTIMEKIT_APP_ID: input.appId,
        REALTIMEKIT_PRESET: input.preset,
        CLOUDFLARE_API_TOKEN: Redacted.value(input.apiToken),
      }
      for (const [name, value] of Object.entries(vars)) {
        yield* Effect.tryPromise({
          try: () => run('npx', ['convex', 'env', 'set', name, value], { env: process.env }),
          catch: (cause) => new Error(`convex env set ${name} failed: ${String(cause)}`),
        })
      }
      yield* Effect.log(`Configured Convex with RealtimeKit app ${input.appId}`)
      return { appId: input.appId }
    })
)

/** The TanStack Start app, built by Vite and served from a Worker. */
export class Web extends Cloudflare.Website.Vite<Web>()('Web', {}) {}

export default Alchemy.Stack(
  'CampsiteCalls',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // Where RealtimeKit delivers webhooks: the Convex deployment's HTTP actions.
    const convexSiteUrl = yield* Config.String('CONVEX_SITE_URL')
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment

    const app = yield* Cloudflare.RealtimeKit.App('Calls', {})

    // Default attendee permissions: audio, video and screenshare allowed, no
    // recording. Recording is started by Convex, never by a client (spec §7).
    yield* Cloudflare.RealtimeKit.Preset('Participant', { appId: app.appId, name: PRESET_NAME })

    yield* Cloudflare.RealtimeKit.Webhook('Lifecycle', {
      appId: app.appId,
      url: `${convexSiteUrl}/realtimekit/webhook`,
      events: [...WEBHOOK_EVENTS],
    })

    // Convex holds this token, so it gets only what the lifecycle needs.
    const token = yield* Cloudflare.ApiToken.AccountApiToken('ConvexRealtimeKit', {
      name: 'campsite-calls-convex-realtimekit',
      accountId,
      policies: [
        {
          effect: 'allow',
          permissionGroups: ['Realtime Admin'],
          resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
        },
      ],
    })

    yield* ConfigureConvex({ accountId, appId: app.appId, preset: PRESET_NAME, apiToken: token.value })

    const web = yield* Web

    return {
      url: web.url.as<string>(),
      realtimeKitAppId: app.appId,
    }
  })
)
