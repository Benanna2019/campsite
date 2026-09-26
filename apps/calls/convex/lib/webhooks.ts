// RealtimeKit webhooks: signature verification and one Schema for every event
// the calls app handles. See docs/calls/lifecycle.md "Webhook delivery rules".
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

export class WebhookError extends Data.TaggedError('WebhookError')<{
  /** bad_signature → 401, bad_payload → 400 (neither retried), key_unavailable → 503 (retried). */
  readonly reason: 'bad_signature' | 'bad_payload' | 'key_unavailable'
  readonly message: string
}> {}

// ---------------------------------------------------------------------------
// Events. Only the fields the lifecycle reads; extra fields are ignored.

const Meeting = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  endedAt: Schema.optional(Schema.String),
})

const Participant = Schema.Struct({
  peerId: Schema.String,
  userDisplayName: Schema.optional(Schema.String),
  customParticipantId: Schema.optional(Schema.String),
  joinedAt: Schema.optional(Schema.String),
  leftAt: Schema.optional(Schema.String),
})

export const MeetingStarted = Schema.Struct({ event: Schema.Literal('meeting.started'), meeting: Meeting })

export const MeetingEnded = Schema.Struct({
  event: Schema.Literal('meeting.ended'),
  meeting: Meeting,
  reason: Schema.optional(Schema.String),
})

export const ParticipantJoined = Schema.Struct({
  event: Schema.Literal('meeting.participantJoined'),
  meeting: Meeting,
  participant: Participant,
})

export const ParticipantLeft = Schema.Struct({
  event: Schema.Literal('meeting.participantLeft'),
  meeting: Meeting,
  participant: Participant,
})

export const RecordingStatusUpdate = Schema.Struct({
  event: Schema.Literal('recording.statusUpdate'),
  meeting: Meeting,
  recording: Schema.Struct({
    id: Schema.String,
    status: Schema.Literals(['RECORDING', 'UPLOADING', 'UPLOADED', 'ERRORED']),
    downloadUrl: Schema.optional(Schema.NullOr(Schema.String)),
    audioDownloadUrl: Schema.optional(Schema.NullOr(Schema.String)),
    downloadUrlExpiry: Schema.optional(Schema.NullOr(Schema.String)),
    startedTime: Schema.optional(Schema.NullOr(Schema.String)),
    stoppedTime: Schema.optional(Schema.NullOr(Schema.String)),
    // Sent as a string ("2044680").
    fileSize: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
    outputFileName: Schema.optional(Schema.NullOr(Schema.String)),
    recordingDuration: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
})

export const TranscriptReady = Schema.Struct({
  event: Schema.Literal('meeting.transcript'),
  meeting: Meeting,
  transcriptDownloadUrl: Schema.String,
})

export const SummaryReady = Schema.Struct({
  event: Schema.Literal('meeting.summary'),
  meeting: Schema.Struct({ id: Schema.String, sessionId: Schema.String }),
  summaryDownloadUrl: Schema.String,
})

export const ChatSynced = Schema.Struct({
  event: Schema.Literal('meeting.chatSynced'),
  meetingId: Schema.String,
  sessionId: Schema.String,
})

export const RealtimeKitEvent = Schema.Union([
  MeetingStarted,
  MeetingEnded,
  ParticipantJoined,
  ParticipantLeft,
  RecordingStatusUpdate,
  TranscriptReady,
  SummaryReady,
  ChatSynced,
])
export type RealtimeKitEvent = typeof RealtimeKitEvent.Type

export const decodeEvent = (json: unknown) =>
  Schema.decodeUnknownEffect(RealtimeKitEvent)(json).pipe(
    Effect.mapError((error) => new WebhookError({ reason: 'bad_payload', message: error.message }))
  )

/** For mutations, which re-decode the stored payload instead of trusting it. */
export const decodeEventSync = Schema.decodeUnknownSync(RealtimeKitEvent)

// ---------------------------------------------------------------------------
// Signature verification: rtk-signature is a base64 RSA-SHA256 signature of
// the raw request body.

const KEY_URL = 'https://api.realtime.cloudflare.com/.well-known/webhooks.json'

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const importKey = (pem: string) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey('spki', pemToDer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
    catch: () => new WebhookError({ reason: 'key_unavailable', message: 'RealtimeKit public key is not a valid PEM key' }),
  })

let cachedKey: CryptoKey | undefined

/**
 * The verification key: REALTIMEKIT_WEBHOOK_PUBLIC_KEY if set (tests, or
 * pinning), otherwise fetched once per isolate from RealtimeKit.
 */
export const publicKey: Effect.Effect<CryptoKey, WebhookError> = Effect.suspend(() => {
  if (cachedKey) return Effect.succeed(cachedKey)
  const pinned = process.env.REALTIMEKIT_WEBHOOK_PUBLIC_KEY
  const pem = pinned
    ? Effect.succeed(pinned)
    : Effect.tryPromise({
        try: async () => {
          const res = await fetch(KEY_URL)
          const json = (await res.json()) as { data?: { publicKey?: string } }
          if (!json.data?.publicKey) throw new Error('missing publicKey')
          return json.data.publicKey
        },
        catch: () => new WebhookError({ reason: 'key_unavailable', message: 'Could not fetch the RealtimeKit webhook key' }),
      })
  return pem.pipe(
    Effect.flatMap(importKey),
    Effect.tap((key) => Effect.sync(() => void (cachedKey = key)))
  )
})

/** Test-only: forget the cached key (e.g. after changing the pinned PEM). */
export function resetPublicKeyCache() {
  cachedKey = undefined
}

export const verifySignature = (body: string, signature: string | null) =>
  Effect.gen(function* () {
    if (!signature) {
      return yield* Effect.fail(new WebhookError({ reason: 'bad_signature', message: 'Missing rtk-signature header' }))
    }
    const key = yield* publicKey
    const bytes = yield* Effect.try({
      try: () => Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
      catch: () => new WebhookError({ reason: 'bad_signature', message: 'rtk-signature is not base64' }),
    })
    // Verify the exact bytes received, never re-serialized JSON.
    const valid = yield* Effect.promise(() =>
      crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes, new TextEncoder().encode(body))
    )
    if (!valid) {
      return yield* Effect.fail(new WebhookError({ reason: 'bad_signature', message: 'Signature does not match body' }))
    }
  })

/** Verify, then parse and decode. The one entry point the HTTP action uses. */
export const verifyAndDecode = (body: string, signature: string | null) =>
  verifySignature(body, signature).pipe(
    Effect.flatMap(() =>
      Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => new WebhookError({ reason: 'bad_payload', message: 'Body is not JSON' }),
      })
    ),
    Effect.flatMap(decodeEvent)
  )

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
