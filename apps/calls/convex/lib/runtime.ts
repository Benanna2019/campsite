// Where Convex functions get their Effect services. Actions build an Effect
// program and run it here; tests swap the RealtimeKit layer for a fake.
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import { type RealtimeKit, RealtimeKitLive } from './realtimekit'

let realtimeKitLayer: Layer.Layer<RealtimeKit, unknown> = RealtimeKitLive

export function runWithRealtimeKit<A, E>(program: Effect.Effect<A, E, RealtimeKit>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(realtimeKitLayer)))
}

/** Test-only: run actions against a fake RealtimeKit. */
export function useRealtimeKitForTests(layer: Layer.Layer<RealtimeKit>) {
  realtimeKitLayer = layer
}
