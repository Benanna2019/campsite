// Call rooms and joining them (docs/calls/lifecycle.md §1 and §2).
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import * as Effect from 'effect/Effect'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from './_generated/server'
import { RealtimeKit } from './lib/realtimekit'
import { runEffect } from './lib/runtime'

async function requireUser(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new ConvexError('Not signed in')
  return userId
}

export const create = mutation({
  args: { title: v.optional(v.string()), subject: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const creatorId = await requireUser(ctx)
    const roomId = await ctx.db.insert('callRooms', { creatorId, ...args })
    // Create the RealtimeKit meeting in the background; joining also ensures
    // it exists, so a failure here only delays the first join.
    await ctx.scheduler.runAfter(0, internal.rooms.provisionMeeting, { roomId })
    return roomId
  },
})

export const get = query({
  args: { roomId: v.id('callRooms') },
  handler: async (ctx, { roomId }) => {
    await requireUser(ctx)
    return ctx.db.get(roomId)
  },
})

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireUser(ctx)
    return ctx.db
      .query('callRooms')
      .withIndex('by_creator', (q) => q.eq('creatorId', creatorId))
      .order('desc')
      .take(50)
  },
})

export const provisionMeeting = internalAction({
  args: { roomId: v.id('callRooms') },
  handler: async (ctx, { roomId }) => {
    await ensureMeeting(ctx, roomId)
  },
})

/**
 * Returns the room's RealtimeKit meeting id, creating the meeting if needed.
 * Safe to run concurrently: the first id written wins (setMeeting), and a
 * meeting created by a losing race is simply never used.
 */
async function ensureMeeting(ctx: ActionCtx, roomId: Id<'callRooms'>): Promise<string> {
  const room = await ctx.runQuery(internal.rooms.byId, { roomId })
  if (!room) throw new ConvexError('Room not found')
  if (room.remoteMeetingId) return room.remoteMeetingId

  const { meetingId } = await runEffect(
    Effect.gen(function* () {
      const rtk = yield* RealtimeKit
      return yield* rtk.createMeeting({ title: room.title })
    })
  )
  return ctx.runMutation(internal.rooms.setMeeting, { roomId, meetingId })
}

export const byId = internalQuery({
  args: { roomId: v.id('callRooms') },
  handler: (ctx, { roomId }) => ctx.db.get(roomId),
})

export const setMeeting = internalMutation({
  args: { roomId: v.id('callRooms'), meetingId: v.string() },
  handler: async (ctx, { roomId, meetingId }) => {
    const room = await ctx.db.get(roomId)
    if (!room) throw new ConvexError('Room not found')
    if (room.remoteMeetingId) return room.remoteMeetingId
    await ctx.db.patch(roomId, { remoteMeetingId: meetingId })
    return meetingId
  },
})

export const participantName = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId)
    return user?.name ?? user?.email ?? 'Guest'
  },
})

/**
 * Mints a RealtimeKit participant token for the signed-in user. The user id
 * rides along as custom_participant_id, which is how webhooks find the user.
 */
export const join = action({
  args: { roomId: v.id('callRooms') },
  handler: async (ctx, { roomId }): Promise<{ token: string; meetingId: string }> => {
    const userId = await requireUser(ctx)
    const name = await ctx.runQuery(internal.rooms.participantName, { userId })

    try {
      const meetingId = await ensureMeeting(ctx, roomId)
      const { token } = await runEffect(
        Effect.gen(function* () {
          const rtk = yield* RealtimeKit
          return yield* rtk.addParticipant({ meetingId, userId, name })
        })
      )
      return { token, meetingId }
    } catch (error) {
      if (error instanceof ConvexError) throw error
      console.error('join failed', error)
      throw new ConvexError("Couldn't join the call. Try again in a moment.")
    }
  },
})
