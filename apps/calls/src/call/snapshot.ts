// RealtimeKit objects → plain values the UI renders. Pure, so it can be tested
// without a browser or a meeting.

export interface CallParticipant {
  id: string
  name: string
  isSelf: boolean
  audioEnabled: boolean
  videoEnabled: boolean
  videoTrack?: MediaStreamTrack
  screenShareTrack?: MediaStreamTrack
}

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping'

export interface CallSnapshot {
  participants: CallParticipant[]
  recording: RecordingStatus
}

/** The fields we read from RealtimeKit's self and participant objects. */
export interface MediaPeer {
  id: string
  name: string
  audioEnabled: boolean
  videoEnabled: boolean
  videoTrack?: MediaStreamTrack | null
  screenShareEnabled?: boolean
  screenShareTracks?: { video?: MediaStreamTrack | null }
}

export function toParticipant(peer: MediaPeer, isSelf: boolean): CallParticipant {
  return {
    id: peer.id,
    name: peer.name,
    isSelf,
    audioEnabled: peer.audioEnabled,
    videoEnabled: peer.videoEnabled,
    videoTrack: peer.videoEnabled ? (peer.videoTrack ?? undefined) : undefined,
    screenShareTrack: peer.screenShareEnabled ? (peer.screenShareTracks?.video ?? undefined) : undefined,
  }
}

/** RealtimeKit's recording states, collapsed to what the UI shows. PAUSED reads as recording. */
export function toRecordingStatus(state: string): RecordingStatus {
  switch (state) {
    case 'STARTING':
      return 'starting'
    case 'RECORDING':
    case 'PAUSED':
      return 'recording'
    case 'STOPPING':
      return 'stopping'
    default:
      return 'idle'
  }
}

/** Self first, then everyone else by name. Screen sharers lead the list. */
export function orderParticipants(participants: CallParticipant[]): CallParticipant[] {
  return [...participants].sort(
    (a, b) =>
      Number(!!b.screenShareTrack) - Number(!!a.screenShareTrack) ||
      Number(b.isSelf) - Number(a.isSelf) ||
      a.name.localeCompare(b.name)
  )
}
