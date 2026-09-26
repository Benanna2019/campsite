import { convexTest } from 'convex-test'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { useHttpClientForTests, useRealtimeKitForTests } from './lib/runtime'
import { resetPublicKeyCache } from './lib/webhooks'
import schema from './schema'
import { fakeDownloads } from './testing/fakeDownloads'
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
// The fake RealtimeKit hands out these links (testing/fakeRealtimeKit.ts).
const TRANSCRIPT_URL = `https://rtk.test/${SESSION}.vtt`
const SUMMARY_URL = `https://rtk.test/${SESSION}.txt`

const VTT = `WEBVTT

00:00:00.000 --> 00:00:03.000
<v Mary Sue>Let's review the launch plan.

00:00:03.000 --> 00:00:06.000
<v Sam>Staging is green.

00:00:06.000 --> 00:00:08.000
<v Dial-in guest>Can you hear me?`

async function setup(files: Record<string, string>) {
  const rtk = fakeRealtimeKit()
  const downloads = fakeDownloads(files)
  useRealtimeKitForTests(rtk.layer)
  useHttpClientForTests(downloads.layer)

  const t = convexTest(schema, modules)
  const userId = await t.run((ctx) => ctx.db.insert('users', { name: 'Mary Sue' }))
  const roomId = await t.withIdentity({ subject: `${userId}|s` }).mutation(api.rooms.create, {})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const meetingId = (await t.run((ctx) => ctx.db.get(roomId)))!.remoteMeetingId!
  const m = meeting(meetingId, SESSION)

  async function deliver(payload: unknown) {
    const body = JSON.stringify(payload)
    await t.fetch('/realtimekit/webhook', { method: 'POST', body, headers: { 'rtk-signature': await signer.sign(body) } })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  }

  // A recorded call with two known peers.
  for (const [peerId, name] of [['peer-mary', 'Mary Sue'], ['peer-sam', 'Sam']]) {
    await deliver({ event: 'meeting.participantJoined', meeting: m, participant: { peerId, userDisplayName: name } })
  }
  await deliver({ event: 'recording.statusUpdate', meeting: m, recording: { id: 'rec-1', status: 'UPLOADED', recordingDuration: 600 } })

  const call = () => t.run(async (ctx) => (await ctx.db.query('calls').collect())[0]!)
  const recording = () => t.run(async (ctx) => (await ctx.db.query('callRecordings').collect())[0]!)
  const speakers = () => t.run((ctx) => ctx.db.query('callRecordingSpeakers').collect())

  return { t, m, deliver, downloads, call, recording, speakers }
}

test('a ready transcript is downloaded as VTT and its speakers matched to peers', async () => {
  const { m, deliver, downloads, recording, speakers } = await setup({ [TRANSCRIPT_URL]: VTT })

  await deliver({ event: 'meeting.transcript', meeting: m, transcriptDownloadUrl: 'https://rtk.test/ignored.csv' })

  expect(downloads.requested).toEqual([TRANSCRIPT_URL])
  expect(await recording()).toMatchObject({ transcriptStatus: 'ready', transcriptVtt: VTT })
  // "Dial-in guest" never joined as a peer, so it isn't a speaker.
  expect((await speakers()).map((s) => s.name).sort()).toEqual(['Mary Sue', 'Sam'])
})

test('a transcript redelivery does not duplicate speakers', async () => {
  const { m, deliver, speakers } = await setup({ [TRANSCRIPT_URL]: VTT })
  const event = { event: 'meeting.transcript', meeting: m, transcriptDownloadUrl: 'https://rtk.test/a.csv' }

  await deliver(event)
  await deliver({ ...event, transcriptDownloadUrl: 'https://rtk.test/b.csv' })

  expect(await speakers()).toHaveLength(2)
})

test('an unreachable transcript marks the recording failed instead of leaving it pending', async () => {
  const { m, deliver, recording } = await setup({})

  await deliver({ event: 'meeting.transcript', meeting: m, transcriptDownloadUrl: 'https://rtk.test/t.csv' })

  expect((await recording()).transcriptStatus).toBe('failed')
})

test('a ready summary is stored and gives an untitled call its title', async () => {
  const { m, deliver, call } = await setup({ [SUMMARY_URL]: '## Launch plan review\n\nThe team confirmed staging is green.' })

  await deliver({ event: 'meeting.summary', meeting: { id: m.id, sessionId: SESSION }, summaryDownloadUrl: SUMMARY_URL })

  expect(await call()).toMatchObject({
    summaryStatus: 'ready',
    summary: '## Launch plan review\n\nThe team confirmed staging is green.',
    title: 'Launch plan review',
  })
})

test('a summary never overwrites a title someone already set', async () => {
  const { t, m, deliver, call } = await setup({ [SUMMARY_URL]: 'Generated title' })
  const existing = await call()
  await t.run((ctx) => ctx.db.patch(existing._id, { title: 'Picked by a human' }))

  await deliver({ event: 'meeting.summary', meeting: { id: m.id, sessionId: SESSION }, summaryDownloadUrl: SUMMARY_URL })

  expect((await call()).title).toBe('Picked by a human')
})
