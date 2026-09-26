// The recording pipeline's pure parts and its one side effect (downloads).
// Lifecycle spec §8.
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import * as HttpClient from 'effect/unstable/http/HttpClient'

export class DownloadError extends Data.TaggedError('DownloadError')<{
  readonly url: string
  readonly message: string
}> {}

/**
 * GETs a RealtimeKit download link as text. Links are short-lived signed URLs,
 * so transient failures (network, 5xx) are retried a few times with backoff;
 * a 4xx means the link is bad and retrying won't help.
 */
export const downloadText = (url: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const response = yield* client.get(url)
    return yield* response.text
  }).pipe(
    Effect.retry({
      schedule: Schedule.exponential('500 millis'),
      times: 3,
      while: (error) => !isClientError(error.response?.status),
    }),
    Effect.mapError((error) => new DownloadError({ url, message: error.message }))
  )

const isClientError = (status: number | undefined) => status !== undefined && status >= 400 && status < 500

/**
 * Distinct speaker names in a transcript, in order of first appearance.
 * Accepts WebVTT voice tags (`<v Mary Sue>Hello`) and the `Mary Sue: Hello`
 * prefix Campsite's Rails transcripts used, so either caption style works.
 */
export function speakerNames(vtt: string): string[] {
  const names = new Set<string>()
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('WEBVTT') || line.includes('-->') || /^\d+$/.test(line) || line.startsWith('NOTE')) {
      continue
    }
    const voice = line.match(/^<v(?:\.[^\s>]+)*\s+([^>]+)>/)
    const prefix = line.match(/^([^:<]{1,80}):\s/)
    const name = (voice?.[1] ?? prefix?.[1])?.trim()
    if (name) names.add(name)
  }
  return [...names]
}

/**
 * A short call title from RealtimeKit's summary: the first heading or line,
 * without markdown, capped at 80 characters. Replaces GenerateCallTitleJob.
 */
export function titleFromSummary(summary: string): string | undefined {
  const first = summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*|^[-*]\s+|\*\*|__/g, '').trim())
    .find((line) => line.length > 0 && !/^summary:?$/i.test(line))
  if (!first) return undefined
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}...` : first
}
