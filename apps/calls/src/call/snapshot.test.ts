import { describe, expect, test } from 'vitest'
import { orderParticipants, toParticipant, toRecordingStatus } from './snapshot'

const track = {} as MediaStreamTrack

describe('toParticipant', () => {
  test('only exposes a video track while video is on', () => {
    expect(toParticipant({ id: '1', name: 'A', audioEnabled: true, videoEnabled: false, videoTrack: track }, false).videoTrack).toBeUndefined()
    expect(toParticipant({ id: '1', name: 'A', audioEnabled: true, videoEnabled: true, videoTrack: track }, false).videoTrack).toBe(track)
  })

  test('exposes the screen share track only while sharing', () => {
    const peer = { id: '1', name: 'A', audioEnabled: true, videoEnabled: false, screenShareTracks: { video: track } }
    expect(toParticipant({ ...peer, screenShareEnabled: false }, false).screenShareTrack).toBeUndefined()
    expect(toParticipant({ ...peer, screenShareEnabled: true }, false).screenShareTrack).toBe(track)
  })
})

test('recording states collapse to what the UI shows', () => {
  expect(['IDLE', 'STARTING', 'RECORDING', 'PAUSED', 'STOPPING'].map(toRecordingStatus)).toEqual([
    'idle',
    'starting',
    'recording',
    'recording',
    'stopping',
  ])
})

test('screen sharers first, then self, then by name', () => {
  const p = (name: string, extra = {}) => ({ id: name, name, isSelf: false, audioEnabled: true, videoEnabled: false, ...extra })
  const ordered = orderParticipants([p('Zoe'), p('Me', { isSelf: true }), p('Amy'), p('Sharer', { screenShareTrack: track })])
  expect(ordered.map((x) => x.name)).toEqual(['Sharer', 'Me', 'Amy', 'Zoe'])
})
