import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { useRealtimeKitForTests } from './lib/runtime'
import schema from './schema'
import { fakeRealtimeKit } from './testing/fakeRealtimeKit'
import { meeting } from './testing/signedWebhooks'
import { modules } from './test.setup'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function setup() {
  const rtk = fakeRealtimeKit()
  useRealtimeKitForTests(rtk.layer)
  const t = convexTest(schema, modules)
  const userId = await t.run((ctx) => ctx.db.insert('users', { name: 'Mary Sue' }))
  const asMary = t.withIdentity({ subject: `${userId}|s` })
  const roomId = await asMary.mutation(api.rooms.create, {})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const meetingId = (await t.run((ctx) => ctx.db.get(roomId)))!.remoteMeetingId!

  let n = 0
  // Events go straight to the mutation; the HTTP path is covered in lifecycle.test.ts.
  const receive = (payload: unknown) =>
    t.mutation(internal.lifecycle.receive, { bodyHash: `hash-${++n}`, payload })

  return { t, rtk, asMary, roomId, meetingId, receive }
}

describe('call history', () => {
  test('lists real calls newest first and hides trivial ones', async () => {
    const { asMary, roomId, meetingId, receive } = await setup()
    const at = (min: number) => `2026-06-03T10:${String(min).padStart(2, '0')}:00.000Z`

    // A real call: two people, twenty minutes.
    await receive({ event: 'meeting.participantJoined', meeting: meeting(meetingId, 's1', { startedAt: at(0) }), participant: { peerId: 'a', userDisplayName: 'Mary Sue' } })
    await receive({ event: 'meeting.participantJoined', meeting: meeting(meetingId, 's1', { startedAt: at(0) }), participant: { peerId: 'b', userDisplayName: 'Sam' } })
    await receive({ event: 'meeting.ended', meeting: meeting(meetingId, 's1', { startedAt: at(0), endedAt: at(20) }) })
    // A trivial one: alone for ten seconds.
    await receive({ event: 'meeting.participantJoined', meeting: meeting(meetingId, 's2', { startedAt: at(30) }), participant: { peerId: 'c', userDisplayName: 'Mary Sue' } })
    await receive({ event: 'meeting.ended', meeting: meeting(meetingId, 's2', { startedAt: at(30), endedAt: '2026-06-03T10:30:10.000Z' }) })
    // A live one, still going.
    await receive({ event: 'meeting.started', meeting: meeting(meetingId, 's3', { startedAt: at(40) }) })

    const history = await asMary.query(api.calls.forRoom, { roomId })

    expect(history.map((c) => ({ live: c.live, peerNames: c.peerNames }))).toEqual([
      { live: true, peerNames: [] },
      { live: false, peerNames: ['Mary Sue', 'Sam'] },
    ])
  })

  test('call details include recordings with their speakers', async () => {
    const { t, asMary, meetingId, receive } = await setup()
    const m = meeting(meetingId, 's1')
    await receive({ event: 'meeting.participantJoined', meeting: m, participant: { peerId: 'a', userDisplayName: 'Mary Sue' } })
    await receive({ event: 'recording.statusUpdate', meeting: m, recording: { id: 'rec-1', status: 'UPLOADED' } })
    const callId = await t.run(async (ctx) => (await ctx.db.query('calls').first())!._id)
    await t.mutation(internal.pipeline.saveTranscript, { callId, vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Mary Sue>Hi' })

    const details = await asMary.query(api.calls.get, { callId })

    expect(details?.recordings[0]).toMatchObject({ status: 'uploaded', speakers: ['Mary Sue'] })
    expect(details?.peers).toHaveLength(1)
  })
})

describe('recording controls', () => {
  test('start asks RealtimeKit to record the room meeting', async () => {
    const { rtk, asMary, roomId, meetingId } = await setup()

    await asMary.action(api.recordings.start, { roomId })

    expect(rtk.calls.startRecording).toEqual([meetingId])
  })

  test('stop only stops recordings that are running in the live call', async () => {
    const { rtk, asMary, roomId, meetingId, receive } = await setup()
    const live = meeting(meetingId, 's1')
    await receive({ event: 'meeting.started', meeting: live })
    await receive({ event: 'recording.statusUpdate', meeting: live, recording: { id: 'running', status: 'RECORDING' } })
    await receive({ event: 'recording.statusUpdate', meeting: live, recording: { id: 'done', status: 'UPLOADED' } })

    await asMary.action(api.recordings.stop, { roomId })

    expect(rtk.calls.stopRecording).toEqual(['running'])
  })

  test('recording controls require a signed-in user', async () => {
    const { t, roomId } = await setup()
    await expect(t.action(api.recordings.start, { roomId })).rejects.toThrow('Not signed in')
  })
})
