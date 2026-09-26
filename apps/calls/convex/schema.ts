// Ported from the Rails call models (api/db/schema.rb: call_rooms, calls,
// call_peers, call_recordings, call_recording_speakers). Remote ids are
// RealtimeKit's; see docs/calls/lifecycle.md for the vocabulary mapping.
import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v, type Infer } from 'convex/values'

export const recordingStatus = v.union(
  v.literal('recording'),
  v.literal('uploading'),
  v.literal('uploaded'),
  v.literal('errored')
)
export type RecordingStatus = Infer<typeof recordingStatus>

export const pipelineStatus = v.union(v.literal('pending'), v.literal('ready'), v.literal('failed'))
export type PipelineStatus = Infer<typeof pipelineStatus>

export default defineSchema({
  ...authTables,

  // A persistent place to call into. One RealtimeKit meeting per room.
  callRooms: defineTable({
    creatorId: v.id('users'),
    title: v.optional(v.string()),
    // Stands in for Rails' polymorphic subject (project or message thread).
    subject: v.optional(v.string()),
    // Set once the RealtimeKit meeting exists. Absent means "being created".
    remoteMeetingId: v.optional(v.string()),
  })
    .index('by_remoteMeetingId', ['remoteMeetingId'])
    .index('by_creator', ['creatorId']),

  // One session in a room: people gathered from startedAt to stoppedAt.
  calls: defineTable({
    roomId: v.id('callRooms'),
    remoteSessionId: v.string(),
    startedAt: v.number(),
    stoppedAt: v.optional(v.number()),
    // Fewer than 2 peers, no recordings, under 30s. Hidden from history.
    trivial: v.optional(v.boolean()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    summaryStatus: v.optional(pipelineStatus),
    // Sum of uploaded recording durations, in seconds.
    recordingsDuration: v.number(),
  })
    .index('by_remoteSessionId', ['remoteSessionId'])
    .index('by_room', ['roomId', 'startedAt']),

  // A person's presence in a call.
  callPeers: defineTable({
    callId: v.id('calls'),
    remotePeerId: v.string(),
    // Our user, resolved from RealtimeKit's custom_participant_id.
    userId: v.optional(v.id('users')),
    name: v.string(),
    joinedAt: v.number(),
    leftAt: v.optional(v.number()),
  })
    .index('by_remotePeerId', ['remotePeerId'])
    // leftAt undefined sorts first, so active peers are a prefix scan.
    .index('by_call_leftAt', ['callId', 'leftAt']),

  callRecordings: defineTable({
    callId: v.id('calls'),
    remoteRecordingId: v.string(),
    status: recordingStatus,
    startedAt: v.number(),
    stoppedAt: v.optional(v.number()),
    // RealtimeKit's download URLs expire; see downloadUrlExpiresAt.
    downloadUrl: v.optional(v.string()),
    audioDownloadUrl: v.optional(v.string()),
    downloadUrlExpiresAt: v.optional(v.number()),
    fileName: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    // Seconds.
    duration: v.optional(v.number()),
    transcriptStatus: v.optional(pipelineStatus),
    transcriptVtt: v.optional(v.string()),
  })
    .index('by_remoteRecordingId', ['remoteRecordingId'])
    .index('by_call', ['callId']),

  // Caption speaker names matched to the peers who said them.
  callRecordingSpeakers: defineTable({
    recordingId: v.id('callRecordings'),
    peerId: v.id('callPeers'),
    name: v.string(),
  }).index('by_recording_name', ['recordingId', 'name']),

  // Inbox of verified RealtimeKit webhooks, for replay and debugging.
  webhookEvents: defineTable({
    event: v.string(),
    // SHA-256 of the raw body. Redeliveries of the same payload are skipped.
    bodyHash: v.string(),
    payload: v.any(),
  }).index('by_bodyHash', ['bodyHash']),
})
