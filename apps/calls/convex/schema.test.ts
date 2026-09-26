import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { modules } from './test.setup'

test('active peers are a prefix of the by_call_leftAt index', async () => {
  const t = convexTest(schema, modules)
  const active = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {})
    const roomId = await ctx.db.insert('callRooms', { creatorId: userId, remoteMeetingId: 'm1' })
    const callId = await ctx.db.insert('calls', {
      roomId,
      remoteSessionId: 's1',
      startedAt: 1,
      recordingsDuration: 0,
    })
    await ctx.db.insert('callPeers', { callId, remotePeerId: 'p1', name: 'Here', joinedAt: 1 })
    await ctx.db.insert('callPeers', { callId, remotePeerId: 'p2', name: 'Gone', joinedAt: 1, leftAt: 5 })

    return ctx.db
      .query('callPeers')
      .withIndex('by_call_leftAt', (q) => q.eq('callId', callId).eq('leftAt', undefined))
      .collect()
  })
  expect(active.map((p) => p.name)).toEqual(['Here'])
})
