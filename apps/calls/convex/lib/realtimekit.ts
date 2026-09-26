// The calls app's view of Cloudflare RealtimeKit: the handful of operations the
// lifecycle needs (docs/calls/lifecycle.md), with domain names and one error
// type. It wraps the typed, Effect-native Cloudflare SDK, which owns the wire
// format (snake_case keys, envelopes) and retries rate limits.
import * as Credentials from '@distilled.cloud/cloudflare/Credentials'
import * as rtk from '@distilled.cloud/cloudflare/realtime-kit'
import * as Config from 'effect/Config'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import type * as HttpClient from 'effect/unstable/http/HttpClient'

export class RealtimeKitError extends Data.TaggedError('RealtimeKitError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

export interface DownloadLink {
  readonly url: string
  readonly expiresAt: number
}

export interface RealtimeKitApi {
  /** One meeting per call room. Transcripts and summaries are produced when a session ends. */
  readonly createMeeting: (input: { title?: string }) => Effect.Effect<{ meetingId: string }, RealtimeKitError>
  /** Mints a participant token for our user. `userId` comes back on webhooks as customParticipantId. */
  readonly addParticipant: (input: {
    meetingId: string
    userId: string
    name: string
  }) => Effect.Effect<{ participantId: string; token: string }, RealtimeKitError>
  readonly startRecording: (meetingId: string) => Effect.Effect<{ recordingId: string }, RealtimeKitError>
  readonly stopRecording: (recordingId: string) => Effect.Effect<void, RealtimeKitError>
  readonly transcriptLink: (sessionId: string) => Effect.Effect<DownloadLink, RealtimeKitError>
  readonly summaryLink: (sessionId: string) => Effect.Effect<DownloadLink, RealtimeKitError>
}

export class RealtimeKit extends Context.Service<RealtimeKit, RealtimeKitApi>()('calls/RealtimeKit') {}

export interface RealtimeKitSettings {
  readonly accountId: string
  readonly appId: string
  /** Preset every participant joins with (RealtimeKit's role + permissions). */
  readonly preset: string
}

const fail = (operation: string) => (cause: unknown) =>
  new RealtimeKitError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })

function required<T>(operation: string, value: T | null | undefined): Effect.Effect<T, RealtimeKitError> {
  return value == null
    ? Effect.fail(new RealtimeKitError({ operation, message: 'RealtimeKit returned no data' }))
    : Effect.succeed(value)
}

/**
 * Builds the service on top of whatever Credentials and HttpClient are in
 * scope. Production provides real ones (RealtimeKitLive); tests provide a
 * fake HttpClient to assert on the actual requests.
 */
export const makeRealtimeKit = (settings: RealtimeKitSettings) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Credentials.Credentials | HttpClient.HttpClient>()
    const base = { accountId: settings.accountId, appId: settings.appId }

    const call = <A, E>(operation: string, effect: Effect.Effect<A, E, Credentials.Credentials | HttpClient.HttpClient>) =>
      effect.pipe(Effect.provide(context), Effect.mapError(fail(operation)))

    return RealtimeKit.of({
      createMeeting: ({ title }) =>
        call(
          'createMeeting',
          rtk.createMeeting({
            ...base,
            title,
            persistChat: true,
            transcribeOnEnd: true,
            summarizeOnEnd: true,
          })
        ).pipe(
          Effect.flatMap((res) => required('createMeeting', res.data)),
          Effect.map((meeting) => ({ meetingId: meeting.id }))
        ),

      addParticipant: ({ meetingId, userId, name }) =>
        call(
          'addParticipant',
          rtk.addParticipantMeeting({
            ...base,
            meetingId,
            customParticipantId: userId,
            presetName: settings.preset,
            name,
          })
        ).pipe(
          Effect.flatMap((res) => required('addParticipant', res.data)),
          Effect.map((participant) => ({ participantId: participant.id, token: participant.token }))
        ),

      startRecording: (meetingId) =>
        call('startRecording', rtk.startRecordingsRecording({ ...base, meetingId })).pipe(
          Effect.flatMap((res) => required('startRecording', res.data)),
          Effect.map((recording) => ({ recordingId: recording.id }))
        ),

      stopRecording: (recordingId) =>
        call(
          'stopRecording',
          rtk.pauseResumeStopRecordingRecording({ ...base, recordingId, action: 'stop' })
        ).pipe(Effect.asVoid),

      transcriptLink: (sessionId) =>
        call('transcriptLink', rtk.getSessionTranscriptsSession({ ...base, sessionId, format: 'VTT' })).pipe(
          Effect.flatMap((res) => required('transcriptLink', res.data)),
          Effect.map((data) => ({
            url: data.transcriptDownloadUrl,
            expiresAt: Date.parse(data.transcriptDownloadUrlExpiry),
          }))
        ),

      summaryLink: (sessionId) =>
        call('summaryLink', rtk.getSessionSummarySession({ ...base, sessionId })).pipe(
          Effect.flatMap((res) => required('summaryLink', res.data)),
          Effect.map((data) => ({
            url: data.summaryDownloadUrl,
            expiresAt: Date.parse(data.summaryDownloadUrlExpiry),
          }))
        ),
    })
  })

/** Settings and API token from the Convex deployment's environment variables. */
const liveConfig = Config.all({
  accountId: Config.String('CLOUDFLARE_ACCOUNT_ID'),
  apiToken: Config.Redacted('CLOUDFLARE_API_TOKEN'),
  appId: Config.String('REALTIMEKIT_APP_ID'),
  preset: Config.String('REALTIMEKIT_PRESET').pipe(Config.withDefault('group_call_participant')),
})

const ENV_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'REALTIMEKIT_APP_ID', 'REALTIMEKIT_PRESET'] as const

// Two Convex runtime differences, both invisible in Node and under Vitest:
// - Effect's default ConfigProvider also reads `import.meta.env`, which
//   Convex rejects when the code runs ("import.meta unsupported").
// - Convex's process.env answers lookups by name but doesn't enumerate its
//   keys, and fromEnvRecord builds its index by enumerating.
// So read our variables by name into a plain record.
const convexEnv = ConfigProvider.layer(
  Effect.sync(() => ConfigProvider.fromEnvRecord(Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))))
)

export const RealtimeKitLive = Layer.effect(RealtimeKit)(
  Effect.gen(function* () {
    const { apiToken, ...settings } = yield* liveConfig
    return yield* makeRealtimeKit(settings).pipe(
      Effect.provide(Credentials.fromApiToken({ apiToken: Redacted.value(apiToken) })),
      Effect.provide(FetchHttpClient.layer)
    )
  }).pipe(Effect.provide(convexEnv))
)
