import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { useRealtimeKitForTests } from './lib/runtime'
import schema from './schema'
import { fakeRealtimeKit } from './testing/fakeRealtimeKit'
import { modules } from './test.setup'

async function setup() {
  const rtk = fakeRealtimeKit()
  useRealtimeKitForTests(rtk.layer)
  const t = convexTest(schema, modules)
  const userId = await t.run((ctx) => ctx.db.insert('users', { name: 'Mary Sue', email: 'mary@example.com' }))
  // Convex Auth identities are "<userId>|<sessionId>".
  const asMary = t.withIdentity({ subject: `${userId}|session` })
  return { t, rtk, userId, asMary }
}

describe('rooms', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('creating a room provisions exactly one RealtimeKit meeting in the background', async () => {
    const { t, rtk, asMary } = await setup()

    const roomId = await asMary.mutation(api.rooms.create, { title: 'Design review' })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const room = await asMary.query(api.rooms.get, { roomId })
    expect(room?.remoteMeetingId).toBe('meeting-1')
    expect(rtk.calls.createMeeting).toEqual([{ title: 'Design review' }])
  })

  test('joining mints a token tied to our user id and reuses the meeting', async () => {
    const { t, rtk, userId, asMary } = await setup()
    const roomId = await asMary.mutation(api.rooms.create, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const first = await asMary.action(api.rooms.join, { roomId })
    const second = await asMary.action(api.rooms.join, { roomId })

    expect(first).toEqual({ token: `token-for-${userId}`, meetingId: 'meeting-1' })
    expect(second.meetingId).toBe('meeting-1')
    expect(rtk.calls.createMeeting).toHaveLength(1)
    expect(rtk.calls.addParticipant[0]).toEqual({ meetingId: 'meeting-1', userId, name: 'Mary Sue' })
  })

  test('joining before background provisioning finishes creates the meeting on demand', async () => {
    const { rtk, asMary } = await setup()
    const roomId = await asMary.mutation(api.rooms.create, {})

    const { meetingId } = await asMary.action(api.rooms.join, { roomId })

    expect(meetingId).toBe('meeting-1')
    expect(rtk.calls.createMeeting).toHaveLength(1)
  })

  test('a losing provisioning race keeps the first meeting id', async () => {
    const { t, asMary } = await setup()
    const roomId = await asMary.mutation(api.rooms.create, {})

    const { meetingId } = await asMary.action(api.rooms.join, { roomId })
    // The scheduled provision now runs second and must not overwrite it.
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect((await asMary.query(api.rooms.get, { roomId }))?.remoteMeetingId).toBe(meetingId)
  })

  test('signed-out users cannot create or join rooms', async () => {
    const { t, asMary } = await setup()
    const roomId = await asMary.mutation(api.rooms.create, {})

    await expect(t.mutation(api.rooms.create, {})).rejects.toThrow('Not signed in')
    await expect(t.action(api.rooms.join, { roomId })).rejects.toThrow('Not signed in')
  })
})
