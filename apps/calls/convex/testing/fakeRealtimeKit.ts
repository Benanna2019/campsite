// An in-memory RealtimeKit for tests: records every call and returns
// predictable ids. No test-framework imports, so Convex can bundle it.
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { RealtimeKit } from '../lib/realtimekit'

export function fakeRealtimeKit() {
  const calls = {
    createMeeting: [] as { title?: string }[],
    addParticipant: [] as { meetingId: string; userId: string; name: string }[],
    startRecording: [] as string[],
    stopRecording: [] as string[],
  }
  let meetings = 0

  const layer = Layer.succeed(
    RealtimeKit,
    RealtimeKit.of({
      createMeeting: (input) =>
        Effect.sync(() => {
          calls.createMeeting.push(input)
          return { meetingId: `meeting-${++meetings}` }
        }),
      addParticipant: (input) =>
        Effect.sync(() => {
          calls.addParticipant.push(input)
          return { participantId: `participant-${input.userId}`, token: `token-for-${input.userId}` }
        }),
      startRecording: (meetingId) =>
        Effect.sync(() => {
          calls.startRecording.push(meetingId)
          return { recordingId: `recording-${meetingId}` }
        }),
      stopRecording: (recordingId) => Effect.sync(() => void calls.stopRecording.push(recordingId)),
      transcriptLink: (sessionId) => Effect.succeed({ url: `https://rtk.test/${sessionId}.vtt`, expiresAt: 0 }),
      summaryLink: (sessionId) => Effect.succeed({ url: `https://rtk.test/${sessionId}.txt`, expiresAt: 0 }),
    })
  )

  return { calls, layer }
}
