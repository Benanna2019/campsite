// Where Convex actions get their Effect services. Actions build an Effect
// program and run it here; tests swap in fakes.
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import type * as HttpClient from 'effect/unstable/http/HttpClient'
import { type RealtimeKit, RealtimeKitLive } from './realtimekit'

/** Everything an action's Effect program may ask for. */
export type Services = RealtimeKit | HttpClient.HttpClient

let realtimeKitLayer: Layer.Layer<RealtimeKit, unknown> = RealtimeKitLive
let httpClientLayer: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer

export function runEffect<A, E>(program: Effect.Effect<A, E, Services>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(Layer.mergeAll(realtimeKitLayer, httpClientLayer))))
}

/** Test-only: run actions against a fake RealtimeKit. */
export function useRealtimeKitForTests(layer: Layer.Layer<RealtimeKit>) {
  realtimeKitLayer = layer
}

/** Test-only: answer outbound downloads (transcripts, summaries) from a fake. */
export function useHttpClientForTests(layer: Layer.Layer<HttpClient.HttpClient>) {
  httpClientLayer = layer
}
