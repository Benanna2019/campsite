import { type CallParticipant, useCall, Video } from '../call'

function Tile({ participant }: { participant: CallParticipant }) {
  const track = participant.screenShareTrack ?? participant.videoTrack
  return (
    <div className='relative aspect-video overflow-hidden rounded-lg bg-neutral-900'>
      {track ? (
        <Video
          track={track}
          mirrored={participant.isSelf && !participant.screenShareTrack}
          className='h-full w-full object-cover'
        />
      ) : (
        <div className='grid h-full place-items-center text-3xl font-semibold text-neutral-400'>
          {participant.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className='absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white'>
        {participant.name}
        {participant.isSelf && ' (you)'}
        {!participant.audioEnabled && ' · muted'}
      </div>
    </div>
  )
}

export function ActiveCall() {
  const call = useCall()
  const self = call.participants.find((p) => p.isSelf)
  const recording = call.recording

  return (
    <section className='flex flex-col gap-4'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        {call.participants.map((participant) => (
          <Tile key={participant.id} participant={participant} />
        ))}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <button className='btn' onClick={call.toggleAudio}>
          {self?.audioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button className='btn' onClick={call.toggleVideo}>
          {self?.videoEnabled ? 'Stop video' : 'Start video'}
        </button>
        <button className='btn' onClick={call.toggleScreenShare}>
          {self?.screenShareTrack ? 'Stop sharing' : 'Share screen'}
        </button>
        {recording === 'idle' ? (
          <button className='btn' onClick={call.startRecording}>
            Record
          </button>
        ) : (
          <button className='btn' onClick={call.stopRecording} disabled={recording !== 'recording'}>
            <span className='mr-1 inline-block size-2 rounded-full bg-red-600' />
            {recording === 'recording' ? 'Stop recording' : recording === 'starting' ? 'Starting…' : 'Stopping…'}
          </button>
        )}
        <button className='btn-danger ml-auto' onClick={call.leave}>
          Leave
        </button>
      </div>
      {call.error && <p className='text-sm text-red-600'>{call.error}</p>}
    </section>
  )
}
