// Starting and stopping recording (lifecycle spec §7). Always server-side:
// the browser asks, Convex tells RealtimeKit, and the recording row appears
// when RealtimeKit's recording.statusUpdate webhook arrives.
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import * as Effect from 'effect/Effect'
import { internal } from './_generated/api'
import { action, internalQuery } from './_generated/server'
import { RealtimeKit } from './lib/realtimekit'
import { runEffect } from './lib/runtime'

export const start = action({
  args: { roomId: v.id('callRooms') },
  handler: async (ctx, { roomId }) => {
    if (!(await getAuthUserId(ctx))) throw new ConvexError('Not signed in')
    const room = await ctx.runQuery(internal.rooms.byId, { roomId })
    if (!room?.remoteMeetingId) throw new ConvexError('Join the call before recording')

    try {
      await runEffect(
        Effect.gen(function* () {
          const rtk = yield* RealtimeKit
          yield* rtk.startRecording(room.remoteMeetingId!)
        })
      )
    } catch (error) {
      console.error('start recording failed', error)
      throw new ConvexError("Couldn't start recording.")
    }
  },
})

export const stop = action({
  args: { roomId: v.id('callRooms') },
  handler: async (ctx, { roomId }) => {
    if (!(await getAuthUserId(ctx))) throw new ConvexError('Not signed in')
    const active = await ctx.runQuery(internal.recordings.activeForRoom, { roomId })

    try {
      await runEffect(
        Effect.gen(function* () {
          const rtk = yield* RealtimeKit
          yield* Effect.forEach(active, (id) => rtk.stopRecording(id), { discard: true })
        })
      )
    } catch (error) {
      console.error('stop recording failed', error)
      throw new ConvexError("Couldn't stop recording.")
    }
  },
})

/** Remote ids of recordings still running in the room's live call. */
export const activeForRoom = internalQuery({
  args: { roomId: v.id('callRooms') },
  handler: async (ctx, { roomId }) => {
    const call = await ctx.db
      .query('calls')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .order('desc')
      .first()
    if (!call || call.stoppedAt !== undefined) return []
    const recordings = await ctx.db
      .query('callRecordings')
      .withIndex('by_call', (q) => q.eq('callId', call._id))
      .collect()
    return recordings.filter((r) => r.status === 'recording').map((r) => r.remoteRecordingId)
  },
})
