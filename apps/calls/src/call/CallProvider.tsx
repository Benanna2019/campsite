// The seam: the only code that knows RealtimeKit exists. Components use
// useCall() and CallParticipant; swapping video providers means rewriting
// this folder and nothing else.
import { RealtimeKitProvider, useRealtimeKitClient, useRealtimeKitSelector } from '@cloudflare/realtimekit-react'
import { useAction } from 'convex/react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { userMessage } from './errors'
import { type CallSnapshot, orderParticipants, toParticipant, toRecordingStatus } from './snapshot'

export type CallStatus = 'idle' | 'joining' | 'joined' | 'error'

export interface Call extends CallSnapshot {
  status: CallStatus
  error?: string
  join: () => Promise<void>
  leave: () => Promise<void>
  toggleAudio: () => Promise<void>
  toggleVideo: () => Promise<void>
  toggleScreenShare: () => Promise<void>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
}

const CallContext = createContext<Call | null>(null)

export function useCall(): Call {
  const call = useContext(CallContext)
  if (!call) throw new Error('useCall must be used inside <CallProvider>')
  return call
}

const idle: CallSnapshot = { participants: [], recording: 'idle' }

export function CallProvider({ roomId, children }: { roomId: Id<'callRooms'>; children: ReactNode }) {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true })
  const [status, setStatus] = useState<CallStatus>('idle')
  const [error, setError] = useState<string>()
  const joinRoom = useAction(api.rooms.join)
  const startRecording = useAction(api.recordings.start)
  const stopRecording = useAction(api.recordings.stop)

  const join = useCallback(async () => {
    setStatus('joining')
    setError(undefined)
    try {
      // Convex mints the participant token; the browser never holds a secret.
      const { token } = await joinRoom({ roomId })
      // Join muted-video, like Campsite's 100ms join settings.
      const client = await initMeeting({ authToken: token, defaults: { audio: true, video: false } })
      await client?.join()
      setStatus('joined')
    } catch (e) {
      setStatus('error')
      setError(userMessage(e, "Couldn't join the call. Try again in a moment."))
    }
  }, [initMeeting, joinRoom, roomId])

  const leave = useCallback(async () => {
    await meeting?.leave()
    setStatus('idle')
  }, [meeting])

  // Control failures show up in `error` instead of as unhandled rejections.
  const report = useCallback(async (run: () => Promise<unknown>, fallback: string) => {
    setError(undefined)
    try {
      await run()
    } catch (e) {
      setError(userMessage(e, fallback))
    }
  }, [])

  const controls = useMemo(
    () => ({
      toggleAudio: async () => {
        if (!meeting) return
        if (meeting.self.audioEnabled) meeting.self.disableAudio()
        else await meeting.self.enableAudio()
      },
      toggleVideo: async () => {
        if (!meeting) return
        if (meeting.self.videoEnabled) meeting.self.disableVideo()
        else await meeting.self.enableVideo()
      },
      toggleScreenShare: async () => {
        if (!meeting) return
        if (meeting.self.screenShareEnabled) await meeting.self.disableScreenShare()
        else await meeting.self.enableScreenShare()
      },
      startRecording: () => report(() => startRecording({ roomId }), "Couldn't start recording."),
      stopRecording: () => report(() => stopRecording({ roomId }), "Couldn't stop recording."),
    }),
    [meeting, report, roomId, startRecording, stopRecording]
  )

  const base = { status, error, join, leave, ...controls }

  if (!meeting || status !== 'joined') {
    return <CallContext.Provider value={{ ...base, ...idle }}>{children}</CallContext.Provider>
  }
  return (
    <RealtimeKitProvider value={meeting}>
      <LiveCall base={base}>{children}</LiveCall>
    </RealtimeKitProvider>
  )
}

function LiveCall({ base, children }: { base: Omit<Call, keyof CallSnapshot>; children: ReactNode }) {
  // The selector re-runs on every RealtimeKit event and re-renders when the
  // result's identity changes, so it builds a fresh snapshot each time.
  // Returning RealtimeKit's own (mutated in place) objects would never update.
  const snapshot = useRealtimeKitSelector(
    (m): CallSnapshot => ({
      participants: orderParticipants([
        toParticipant(m.self, true),
        ...m.participants.joined.toArray().map((p) => toParticipant(p, false)),
      ]),
      recording: toRecordingStatus(m.recording.recordingState),
    })
  )
  return <CallContext.Provider value={{ ...base, ...snapshot }}>{children}</CallContext.Provider>
}
