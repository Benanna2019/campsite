import { httpRouter } from 'convex/server'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { auth } from './auth'
import { sha256Hex, verifyAndDecode, WebhookError } from './lib/webhooks'

const http = httpRouter()

auth.addHttpRoutes(http)

/**
 * RealtimeKit webhooks. Status codes follow RealtimeKit's retry rules:
 * 2xx = delivered, 5xx = retried, other 4xx = failed and not retried.
 */
http.route({
  path: '/realtimekit/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const body = await request.text()
    const exit = await Effect.runPromiseExit(verifyAndDecode(body, request.headers.get('rtk-signature')))

    if (Exit.isFailure(exit)) {
      const error = exit.cause.reasons.find((r) => r._tag === 'Fail')?.error
      if (error instanceof WebhookError) {
        console.warn('Rejected RealtimeKit webhook', error.reason, error.message)
        const status = error.reason === 'bad_signature' ? 401 : error.reason === 'bad_payload' ? 400 : 503
        return new Response(error.message, { status })
      }
      console.error('Unexpected webhook failure', exit.cause)
      return new Response('Internal error', { status: 500 })
    }

    // Stored and applied in one mutation; only then do we acknowledge. A
    // throw here becomes a 500, which RealtimeKit retries.
    const outcome = await ctx.runMutation(internal.lifecycle.receive, {
      bodyHash: await sha256Hex(body),
      payload: JSON.parse(body),
    })
    return Response.json({ ok: true, outcome })
  }),
})

export default http
