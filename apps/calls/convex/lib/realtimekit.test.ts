import * as Credentials from '@distilled.cloud/cloudflare/Credentials'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'
import { describe, expect, test } from 'vitest'
import { makeRealtimeKit, RealtimeKitError } from './realtimekit'

interface Captured {
  method: string
  path: string
  auth: string | undefined
  body: unknown
}

// A fake Cloudflare API: records each request and answers with `respond`.
function fakeApi(respond: (path: string) => { status?: number; json: unknown }) {
  const requests: Captured[] = []
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const body = request.body._tag === 'Uint8Array' ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined
      requests.push({ method: request.method, path: url.pathname, auth: request.headers['authorization'], body })
      const { status = 200, json } = respond(url.pathname)
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
      )
    })
  )
  const layer = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient, client),
    Credentials.fromApiToken({ apiToken: 'test-token' })
  )
  return { requests, layer }
}

const settings = { accountId: 'acct', appId: 'app', preset: 'group_call_participant' }
type Api = ReturnType<typeof fakeApi>
const run = <A, E>(
  api: Api,
  f: (rtk: Effect.Success<ReturnType<typeof makeRealtimeKit>>) => Effect.Effect<A, E>
) => Effect.runPromise(makeRealtimeKit(settings).pipe(Effect.flatMap(f), Effect.provide(api.layer)))

// RealtimeKit answers { success, data } (no Cloudflare `result` envelope).
const ok = (data: unknown) => ({ json: { success: true, data } })

describe('RealtimeKit service', () => {
  test('createMeeting asks RealtimeKit to transcribe and summarize on end', async () => {
    const api = fakeApi(() => ok({ id: 'meeting-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }))

    const result = await run(api, (rtk) => rtk.createMeeting({ title: 'Standup' }))

    expect(result).toEqual({ meetingId: 'meeting-1' })
    expect(api.requests[0]).toMatchObject({
      method: 'POST',
      path: '/client/v4/accounts/acct/realtime/kit/app/meetings',
      auth: 'Bearer test-token',
      body: { title: 'Standup', persist_chat: true, transcribe_on_end: true, summarize_on_end: true },
    })
  })

  test('addParticipant sends our user id as custom_participant_id and returns the token', async () => {
    const api = fakeApi(() =>
      ok({
        id: 'participant-1',
        token: 'jwt-for-browser',
        custom_participant_id: 'user-123',
        preset_name: 'group_call_participant',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      })
    )

    const result = await run(api, (rtk) => rtk.addParticipant({ meetingId: 'meeting-1', userId: 'user-123', name: 'Mary' }))

    expect(result).toEqual({ participantId: 'participant-1', token: 'jwt-for-browser' })
    expect(api.requests[0]).toMatchObject({
      method: 'POST',
      path: '/client/v4/accounts/acct/realtime/kit/app/meetings/meeting-1/participants',
      body: { custom_participant_id: 'user-123', preset_name: 'group_call_participant', name: 'Mary' },
    })
  })

  test('stopRecording sends the stop action', async () => {
    const api = fakeApi(() => ok({ id: 'rec-1' }))

    await run(api, (rtk) => rtk.stopRecording('rec-1'))

    expect(api.requests[0]).toMatchObject({
      method: 'PUT',
      path: '/client/v4/accounts/acct/realtime/kit/app/recordings/rec-1',
      body: { action: 'stop' },
    })
  })

  test('transcriptLink requests VTT and parses the expiry', async () => {
    const api = fakeApi(() =>
      ok({
        session_id: 'session-1',
        transcript_download_url: 'https://example.com/t.vtt',
        transcript_download_url_expiry: '2026-06-10T10:30:00.000Z',
      })
    )

    const link = await run(api, (rtk) => rtk.transcriptLink('session-1'))

    expect(link).toEqual({ url: 'https://example.com/t.vtt', expiresAt: Date.parse('2026-06-10T10:30:00.000Z') })
    expect(api.requests[0]?.path).toBe('/client/v4/accounts/acct/realtime/kit/app/sessions/session-1/transcript')
  })

  test('API errors surface as one RealtimeKitError naming the operation', async () => {
    const api = fakeApi(() => ({
      status: 404,
      json: { success: false, errors: [{ code: 7003, message: 'meeting not found' }], messages: [], result: null },
    }))

    const error = await Effect.runPromise(
      makeRealtimeKit(settings).pipe(
        Effect.flatMap((rtk) => rtk.startRecording('missing')),
        Effect.flip,
        Effect.provide(api.layer)
      )
    )

    expect(error).toBeInstanceOf(RealtimeKitError)
    expect(error.operation).toBe('startRecording')
  })
})

describe('RealtimeKitLive', () => {
  test('reads its settings from process.env and names what is missing', async () => {
    const { RealtimeKitLive } = await import('./realtimekit')
    const saved = { ...process.env }
    delete process.env.REALTIMEKIT_APP_ID
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
    process.env.CLOUDFLARE_API_TOKEN = 'token'
    try {
      const exit = await Effect.runPromiseExit(Layer.build(RealtimeKitLive).pipe(Effect.scoped))
      expect(exit._tag).toBe('Failure')
      expect(String(exit)).toContain('REALTIMEKIT_APP_ID')

      process.env.REALTIMEKIT_APP_ID = 'app'
      const ok = await Effect.runPromiseExit(Layer.build(RealtimeKitLive).pipe(Effect.scoped))
      expect(ok._tag).toBe('Success')
    } finally {
      process.env = saved
    }
  })
})
