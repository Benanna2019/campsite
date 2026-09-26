// Read side for the UI: a room's call history and one call's details.
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'

async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new ConvexError('Not signed in')
  return userId
}

/** Newest first, without trivial calls (lifecycle spec §6). */
export const forRoom = query({
  args: { roomId: v.id('callRooms') },
  handler: async (ctx, { roomId }) => {
    await requireUser(ctx)
    const calls = await ctx.db
      .query('calls')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .order('desc')
      .take(50)

    return Promise.all(
      calls
        .filter((call) => !call.trivial)
        .map(async (call) => {
          const peers = await ctx.db
            .query('callPeers')
            .withIndex('by_call_leftAt', (q) => q.eq('callId', call._id))
            .collect()
          return {
            _id: call._id,
            title: call.title,
            startedAt: call.startedAt,
            stoppedAt: call.stoppedAt,
            recordingsDuration: call.recordingsDuration,
            summaryStatus: call.summaryStatus,
            peerNames: [...new Set(peers.map((p) => p.name))],
            live: call.stoppedAt === undefined,
          }
        })
    )
  },
})

export const get = query({
  args: { callId: v.id('calls') },
  handler: async (ctx, { callId }) => {
    await requireUser(ctx)
    const call = await ctx.db.get(callId)
    if (!call) return null

    const peers = await ctx.db
      .query('callPeers')
      .withIndex('by_call_leftAt', (q) => q.eq('callId', callId))
      .collect()
    const recordings = await ctx.db
      .query('callRecordings')
      .withIndex('by_call', (q) => q.eq('callId', callId))
      .collect()
    const withSpeakers = await Promise.all(
      recordings.map(async (recording) => ({
        ...recording,
        speakers: (
          await ctx.db
            .query('callRecordingSpeakers')
            .withIndex('by_recording_name', (q) => q.eq('recordingId', recording._id))
            .collect()
        ).map((s) => s.name),
      }))
    )
    return { ...call, peers, recordings: withSpeakers }
  },
})
