import { convexTest } from 'convex-test'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { useRealtimeKitForTests } from './lib/runtime'
import { resetPublicKeyCache } from './lib/webhooks'
import schema from './schema'
import { fakeRealtimeKit } from './testing/fakeRealtimeKit'
import { makeWebhookSigner, meeting } from './testing/signedWebhooks'
import { modules } from './test.setup'

let signer: Awaited<ReturnType<typeof makeWebhookSigner>>

beforeAll(async () => {
  signer = await makeWebhookSigner()
  process.env.REALTIMEKIT_WEBHOOK_PUBLIC_KEY = signer.publicKeyPem
  resetPublicKeyCache()
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const SESSION = 'session-1'

async function setup() {
  const rtk = fakeRealtimeKit()
  useRealtimeKitForTests(rtk.layer)
  const t = convexTest(schema, modules)
  const userId = await t.run((ctx) => ctx.db.insert('users', { name: 'Mary Sue' }))
  const asMary = t.withIdentity({ subject: `${userId}|session` })
  const roomId = await asMary.mutation(api.rooms.create, { title: 'Weekly sync' })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const meetingId = (await t.run((ctx) => ctx.db.get(roomId)))!.remoteMeetingId!

  async function deliver(payload: unknown, opts: { signature?: string | null } = {}) {
    const body = JSON.stringify(payload)
    const signature = opts.signature === undefined ? await signer.sign(body) : opts.signature
    const res = await t.fetch('/realtimekit/webhook', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...(signature ? { 'rtk-signature': signature } : {}) },
    })
    return { status: res.status, json: res.status === 200 ? await res.json() : await res.text() }
  }

  const m = (times?: { startedAt?: string; endedAt?: string }) => meeting(meetingId, SESSION, times)
  const participant = (peerId: string, extra: Record<string, string> = {}) => ({
    peerId,
    userDisplayName: peerId === 'peer-mary' ? 'Mary Sue' : 'Sam',
    joinedAt: '2026-06-03T10:01:00.000Z',
    ...extra,
  })

  const call = () =>
    t.run((ctx) =>
      ctx.db
        .query('calls')
        .withIndex('by_remoteSessionId', (q) => q.eq('remoteSessionId', SESSION))
        .unique()
    )
  const peers = () => t.run((ctx) => ctx.db.query('callPeers').collect())
  const recordings = () => t.run((ctx) => ctx.db.query('callRecordings').collect())

  return { t, rtk, userId, meetingId, deliver, m, participant, call, peers, recordings }
}

describe('webhook endpoint', () => {
  test('rejects a missing or wrong signature with 401 so RealtimeKit does not retry', async () => {
    const { deliver, m } = await setup()
    const event = { event: 'meeting.started', meeting: m() }

    expect((await deliver(event, { signature: null })).status).toBe(401)
    expect((await deliver(event, { signature: await signer.sign('something else') })).status).toBe(401)
  })

  test('rejects a validly signed but unknown payload with 400', async () => {
    const { deliver } = await setup()
    expect((await deliver({ event: 'meeting.teleported' })).status).toBe(400)
  })

  test('stores every accepted event in the inbox and skips exact redeliveries', async () => {
    const { t, deliver, m, participant, peers } = await setup()
    const joined = { event: 'meeting.participantJoined', meeting: m(), participant: participant('peer-mary') }

    expect((await deliver(joined)).json).toMatchObject({ outcome: 'applied' })
    expect((await deliver(joined)).json).toMatchObject({ outcome: 'duplicate' })

    expect(await peers()).toHaveLength(1)
    expect(await t.run((ctx) => ctx.db.query('webhookEvents').collect())).toHaveLength(1)
  })

  test('ignores meetings that are not call rooms, without failing delivery', async () => {
    const { deliver, call } = await setup()
    const res = await deliver({ event: 'meeting.started', meeting: meeting('someone-elses-meeting', SESSION) })

    expect(res).toMatchObject({ status: 200, json: { outcome: 'ignored' } })
    expect(await call()).toBeNull()
  })
})

describe('call lifecycle', () => {
  test('a full call: join, record, everyone leaves, recording stops and uploads, meeting ends', async () => {
    const { t, rtk, userId, deliver, m, participant, call, peers, recordings } = await setup()

    await deliver({ event: 'meeting.started', meeting: m() })
    await deliver({
      event: 'meeting.participantJoined',
      meeting: m(),
      participant: participant('peer-mary', { customParticipantId: userId }),
    })
    await deliver({ event: 'meeting.participantJoined', meeting: m(), participant: participant('peer-sam') })
    await deliver({
      event: 'recording.statusUpdate',
      meeting: m(),
      recording: { id: 'rec-1', status: 'RECORDING', startedTime: '2026-06-03T10:02:00.000Z' },
    })

    await deliver({
      event: 'meeting.participantLeft',
      meeting: m(),
      participant: participant('peer-sam', { leftAt: '2026-06-03T10:20:00.000Z' }),
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(rtk.calls.stopRecording).toEqual([]) // Mary is still here

    await deliver({
      event: 'meeting.participantLeft',
      meeting: m(),
      participant: participant('peer-mary', { customParticipantId: userId, leftAt: '2026-06-03T10:25:00.000Z' }),
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(rtk.calls.stopRecording).toEqual(['rec-1']) // last one out stops it

    await deliver({
      event: 'recording.statusUpdate',
      meeting: m(),
      recording: {
        id: 'rec-1',
        status: 'UPLOADED',
        downloadUrl: 'https://example.com/rec.mp4',
        downloadUrlExpiry: '2026-06-10T10:30:00.000Z',
        stoppedTime: '2026-06-03T10:25:00.000Z',
        fileSize: '2044680',
        recordingDuration: 1380,
      },
    })
    await deliver({ event: 'meeting.ended', meeting: m({ endedAt: '2026-06-03T10:26:00.000Z' }), reason: 'ALL_PARTICIPANTS_LEFT' })

    const finished = await call()
    expect(finished).toMatchObject({
      startedAt: Date.parse('2026-06-03T10:00:00.000Z'),
      stoppedAt: Date.parse('2026-06-03T10:26:00.000Z'),
      recordingsDuration: 1380,
      trivial: false,
    })
    const [mary, sam] = (await peers()).sort((a, b) => a.name.localeCompare(b.name))
    expect(mary).toMatchObject({ userId, leftAt: Date.parse('2026-06-03T10:25:00.000Z') })
    expect(sam?.userId).toBeUndefined() // not signed in via our app
    expect((await recordings())[0]).toMatchObject({ status: 'uploaded', fileSize: 2044680, duration: 1380 })
  })

  test('events can arrive before meeting.started; the call is created once', async () => {
    const { deliver, m, participant, t } = await setup()

    await deliver({ event: 'meeting.participantJoined', meeting: m(), participant: participant('peer-mary') })
    await deliver({ event: 'meeting.started', meeting: m() })

    expect(await t.run((ctx) => ctx.db.query('calls').collect())).toHaveLength(1)
  })

  test('meeting.ended closes out peers who never sent a leave event', async () => {
    const { deliver, m, participant, peers } = await setup()
    await deliver({ event: 'meeting.participantJoined', meeting: m(), participant: participant('peer-mary') })

    await deliver({ event: 'meeting.ended', meeting: m({ endedAt: '2026-06-03T10:30:00.000Z' }) })

    expect((await peers())[0]?.leftAt).toBe(Date.parse('2026-06-03T10:30:00.000Z'))
  })

  test('a short solo call with no recording is marked trivial', async () => {
    const { deliver, m, participant, call } = await setup()
    await deliver({ event: 'meeting.participantJoined', meeting: m(), participant: participant('peer-mary') })

    await deliver({
      event: 'meeting.ended',
      meeting: m({ startedAt: '2026-06-03T10:00:00.000Z', endedAt: '2026-06-03T10:00:10.000Z' }),
    })

    expect((await call())?.trivial).toBe(true)
  })

  test('recording status never moves backwards when updates arrive out of order', async () => {
    const { deliver, m, recordings } = await setup()
    const update = (status: string) => ({ event: 'recording.statusUpdate', meeting: m(), recording: { id: 'rec-1', status } })

    await deliver(update('UPLOADED'))
    await deliver(update('RECORDING'))

    expect((await recordings())[0]?.status).toBe('uploaded')
  })

  test('a custom participant id that is not one of our users links to no one', async () => {
    const { deliver, m, participant, peers } = await setup()

    await deliver({
      event: 'meeting.participantJoined',
      meeting: m(),
      participant: participant('peer-mary', { customParticipantId: 'not-a-convex-id' }),
    })

    expect((await peers())[0]?.userId).toBeUndefined()
  })

  test('transcript and summary events mark work pending for the pipeline', async () => {
    const { deliver, m, call, recordings } = await setup()
    await deliver({ event: 'recording.statusUpdate', meeting: m(), recording: { id: 'rec-1', status: 'UPLOADED' } })

    await deliver({ event: 'meeting.transcript', meeting: m(), transcriptDownloadUrl: 'https://example.com/t.csv' })
    await deliver({
      event: 'meeting.summary',
      meeting: { id: 'x', sessionId: SESSION },
      summaryDownloadUrl: 'https://example.com/s.txt',
    })

    expect((await recordings())[0]?.transcriptStatus).toBe('pending')
    expect((await call())?.summaryStatus).toBe('pending')
  })
})
