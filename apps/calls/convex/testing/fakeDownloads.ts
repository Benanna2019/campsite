// Answers outbound GETs (transcript and summary downloads) from a map of
// URL → body. Unknown URLs get a 404. No test-framework imports.
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'

export function fakeDownloads(files: Record<string, string>) {
  const requested: string[] = []
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      requested.push(url.toString())
      const body = files[url.toString()]
      return HttpClientResponse.fromWeb(request, new Response(body ?? 'not found', { status: body === undefined ? 404 : 200 }))
    })
  )
  return { requested, layer: Layer.succeed(HttpClient.HttpClient, client) }
}
