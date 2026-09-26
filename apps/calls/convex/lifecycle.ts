// Applies RealtimeKit webhook events to calls, peers and recordings.
// Behavior is specified in docs/calls/lifecycle.md §3–§8; section numbers
// below refer to it.
//
// Every handler is an idempotent upsert keyed by the remote id, because
// RealtimeKit delivers unordered and retries on 5xx (same as 100ms, and the
// same reason Rails uses create_or_find_by!).
import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation, type MutationCtx } from './_generated/server'
import type { RecordingStatus } from './schema'
import { RealtimeKit } from './lib/realtimekit'
import { runWithRealtimeKit } from './lib/runtime'
import { decodeEventSync, type RealtimeKitEvent } from './lib/webhooks'

type Meeting = { id: string; sessionId: string; startedAt?: string; endedAt?: string }
type Participant = Extract<RealtimeKitEvent, { participant: unknown }>['participant']

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : undefined)

/** A call shorter than this with fewer than 2 peers and no recording is hidden. */
const TRIVIAL_CALL_MS = 30_000

/**
 * Stores and applies one verified webhook. Returns what happened, which the
 * HTTP action logs. The payload is re-decoded here: mutations trust nothing
 * they're handed.
 */
export const receive = internalMutation({
  args: { bodyHash: v.string(), payload: v.any() },
  handler: async (ctx, { bodyHash, payload }) => {
    const duplicate = await ctx.db
      .query('webhookEvents')
      .withIndex('by_bodyHash', (q) => q.eq('bodyHash', bodyHash))
      .first()
    if (duplicate) return 'duplicate' as const

    const event = decodeEventSync(payload)
    await ctx.db.insert('webhookEvents', { event: event.event, bodyHash, payload })
    return apply(ctx, event)
  },
})

async function apply(ctx: MutationCtx, event: RealtimeKitEvent): Promise<'applied' | 'ignored'> {
  switch (event.event) {
    // §3
    case 'meeting.started':
      return (await upsertCall(ctx, event.meeting)) ? 'applied' : 'ignored'

    // §4
    case 'meeting.participantJoined': {
      const call = await upsertCall(ctx, event.meeting)
      if (!call) return 'ignored'
      await upsertPeer(ctx, call._id, event.participant)
      return 'applied'
    }

    // §5
    case 'meeting.participantLeft': {
      const call = await upsertCall(ctx, event.meeting)
      if (!call) return 'ignored'
      const peer = await upsertPeer(ctx, call._id, event.participant)
      const leftAt = ms(event.participant.leftAt) ?? Date.now()
      if (peer.leftAt === undefined) await ctx.db.patch(peer._id, { leftAt })

      if ((await activePeers(ctx, call._id)).length === 0) {
        for (const recording of await recordingsOf(ctx, call._id)) {
          if (recording.status === 'recording') {
            await ctx.scheduler.runAfter(0, internal.lifecycle.stopRecording, {
              remoteRecordingId: recording.remoteRecordingId,
            })
          }
        }
      }
      return 'applied'
    }

    // §6
    case 'meeting.ended': {
      const call = await upsertCall(ctx, event.meeting)
      if (!call) return 'ignored'
      const stoppedAt = ms(event.meeting.endedAt) ?? Date.now()
      for (const peer of await activePeers(ctx, call._id)) {
        await ctx.db.patch(peer._id, { leftAt: stoppedAt })
      }
      const peerCount = (await peersOf(ctx, call._id)).length
      const recordingCount = (await recordingsOf(ctx, call._id)).length
      const trivial = peerCount < 2 && recordingCount === 0 && stoppedAt - call.startedAt < TRIVIAL_CALL_MS
      await ctx.db.patch(call._id, { stoppedAt, trivial })
      return 'applied'
    }

    // §7
    case 'recording.statusUpdate': {
      const call = await upsertCall(ctx, event.meeting)
      if (!call) return 'ignored'
      const r = event.recording
      const status = RECORDING_STATUS[r.status]
      const fields = {
        status,
        ...(r.stoppedTime ? { stoppedAt: ms(r.stoppedTime) } : {}),
        ...(r.downloadUrl ? { downloadUrl: r.downloadUrl } : {}),
        ...(r.audioDownloadUrl ? { audioDownloadUrl: r.audioDownloadUrl } : {}),
        ...(r.downloadUrlExpiry ? { downloadUrlExpiresAt: ms(r.downloadUrlExpiry) } : {}),
        ...(r.outputFileName ? { fileName: r.outputFileName } : {}),
        ...(r.fileSize != null ? { fileSize: Number(r.fileSize) } : {}),
        ...(r.recordingDuration != null ? { duration: r.recordingDuration } : {}),
      }

      const existing = await ctx.db
        .query('callRecordings')
        .withIndex('by_remoteRecordingId', (q) => q.eq('remoteRecordingId', r.id))
        .unique()
      if (existing) {
        // Statuses only move forward; a late RECORDING can't undo UPLOADED.
        if (STATUS_ORDER[status] >= STATUS_ORDER[existing.status]) await ctx.db.patch(existing._id, fields)
      } else {
        await ctx.db.insert('callRecordings', {
          callId: call._id,
          remoteRecordingId: r.id,
          startedAt: ms(r.startedTime) ?? Date.now(),
          ...fields,
        })
      }

      if (status === 'uploaded') {
        const total = (await recordingsOf(ctx, call._id))
          .filter((rec) => rec.status === 'uploaded')
          .reduce((sum, rec) => sum + (rec.duration ?? 0), 0)
        await ctx.db.patch(call._id, { recordingsDuration: total })
      }
      if (status === 'errored') {
        // Rails reported these to Sentry; the row is kept for the UI.
        console.error('RealtimeKit recording errored', { recordingId: r.id, sessionId: event.meeting.sessionId })
      }
      return 'applied'
    }

    // §8: marked here; processed by the recording pipeline.
    case 'meeting.transcript': {
      const call = await upsertCall(ctx, event.meeting)
      if (!call) return 'ignored'
      for (const recording of await recordingsOf(ctx, call._id)) {
        if (recording.transcriptStatus !== 'ready') await ctx.db.patch(recording._id, { transcriptStatus: 'pending' })
      }
      return 'applied'
    }

    case 'meeting.summary': {
      const call = await findCall(ctx, event.meeting.sessionId)
      if (!call) return 'ignored'
      if (call.summaryStatus !== 'ready') await ctx.db.patch(call._id, { summaryStatus: 'pending' })
      return 'applied'
    }

    // Stored in the inbox; chat links aren't ported yet (spec: deliberate cuts).
    case 'meeting.chatSynced':
      return 'applied'
  }
}

const RECORDING_STATUS: Record<'RECORDING' | 'UPLOADING' | 'UPLOADED' | 'ERRORED', RecordingStatus> = {
  RECORDING: 'recording',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  ERRORED: 'errored',
}

const STATUS_ORDER: Record<RecordingStatus, number> = { recording: 0, uploading: 1, uploaded: 2, errored: 2 }

function findCall(ctx: MutationCtx, remoteSessionId: string) {
  return ctx.db
    .query('calls')
    .withIndex('by_remoteSessionId', (q) => q.eq('remoteSessionId', remoteSessionId))
    .unique()
}

/**
 * The call for this session, created if this is the first event we've seen
 * for it. Null when the meeting isn't one of our rooms.
 */
async function upsertCall(ctx: MutationCtx, meeting: Meeting): Promise<Doc<'calls'> | null> {
  const existing = await findCall(ctx, meeting.sessionId)
  if (existing) return existing

  const room = await ctx.db
    .query('callRooms')
    .withIndex('by_remoteMeetingId', (q) => q.eq('remoteMeetingId', meeting.id))
    .first()
  if (!room) {
    console.warn('Webhook for a meeting that is not a call room', { meetingId: meeting.id })
    return null
  }

  const callId = await ctx.db.insert('calls', {
    roomId: room._id,
    remoteSessionId: meeting.sessionId,
    startedAt: ms(meeting.startedAt) ?? Date.now(),
    recordingsDuration: 0,
  })
  return (await ctx.db.get(callId))!
}

async function upsertPeer(ctx: MutationCtx, callId: Id<'calls'>, participant: Participant) {
  const existing = await ctx.db
    .query('callPeers')
    .withIndex('by_remotePeerId', (q) => q.eq('remotePeerId', participant.peerId))
    .unique()
  if (existing) return existing

  // custom_participant_id is our user id (rooms.join). normalizeId rejects
  // anything that isn't a users id, so a stray value can't link a stranger.
  const userId = participant.customParticipantId
    ? (ctx.db.normalizeId('users', participant.customParticipantId) ?? undefined)
    : undefined
  const peerId = await ctx.db.insert('callPeers', {
    callId,
    remotePeerId: participant.peerId,
    userId,
    name: participant.userDisplayName ?? 'Guest',
    joinedAt: ms(participant.joinedAt) ?? Date.now(),
  })
  return (await ctx.db.get(peerId))!
}

function peersOf(ctx: MutationCtx, callId: Id<'calls'>) {
  return ctx.db
    .query('callPeers')
    .withIndex('by_call_leftAt', (q) => q.eq('callId', callId))
    .collect()
}

function activePeers(ctx: MutationCtx, callId: Id<'calls'>) {
  return ctx.db
    .query('callPeers')
    .withIndex('by_call_leftAt', (q) => q.eq('callId', callId).eq('leftAt', undefined))
    .collect()
}

function recordingsOf(ctx: MutationCtx, callId: Id<'calls'>) {
  return ctx.db
    .query('callRecordings')
    .withIndex('by_call', (q) => q.eq('callId', callId))
    .collect()
}

/** §5: the last peer left while recording. Rails' StopCallRecordingJob. */
export const stopRecording = internalAction({
  args: { remoteRecordingId: v.string() },
  handler: async (_ctx, { remoteRecordingId }) => {
    await runWithRealtimeKit(
      Effect.gen(function* () {
        const rtk = yield* RealtimeKit
        yield* rtk.stopRecording(remoteRecordingId)
      })
    )
  },
})
