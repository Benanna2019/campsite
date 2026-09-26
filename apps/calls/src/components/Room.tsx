import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { CallProvider, useCall } from '../call'
import { href } from '../router'
import { ActiveCall } from './ActiveCall'

const time = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min recorded`

function JoinOrCall() {
  const call = useCall()
  if (call.status === 'joined') return <ActiveCall />
  return (
    <div className='flex items-center gap-3'>
      <button className='btn-primary' onClick={call.join} disabled={call.status === 'joining'}>
        {call.status === 'joining' ? 'Joining…' : 'Join call'}
      </button>
      {call.error && <p className='text-sm text-red-600'>{call.error}</p>}
    </div>
  )
}

export function Room({ roomId }: { roomId: Id<'callRooms'> }) {
  const room = useQuery(api.rooms.get, { roomId })
  const history = useQuery(api.calls.forRoom, { roomId })

  if (room === null) return <main className='p-10 text-sm text-neutral-500'>Room not found.</main>

  return (
    <main className='mx-auto w-full max-w-4xl px-4 py-10'>
      <a href={href.rooms()} className='text-sm text-neutral-500'>
        ← Rooms
      </a>
      <h1 className='mt-2 text-xl font-semibold'>{room?.title ?? 'Untitled room'}</h1>
      <p className='mt-1 text-sm text-neutral-500'>Share this page's link to invite people.</p>

      <div className='mt-6'>
        <CallProvider roomId={roomId}>
          <JoinOrCall />
        </CallProvider>
      </div>

      <h2 className='mt-10 text-sm font-semibold text-neutral-500'>Past calls</h2>
      <ul className='mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200'>
        {history?.map((call) => (
          <li key={call._id}>
            <a href={href.call(call._id)} className='flex items-center justify-between px-4 py-3 hover:bg-neutral-50'>
              <span>
                {call.title ?? time(call.startedAt)}
                <span className='ml-2 text-sm text-neutral-500'>{call.peerNames.join(', ')}</span>
              </span>
              <span className='text-sm text-neutral-500'>
                {call.live ? 'Live now' : call.recordingsDuration > 0 ? minutes(call.recordingsDuration) : ''}
              </span>
            </a>
          </li>
        ))}
        {history?.length === 0 && <li className='px-4 py-3 text-sm text-neutral-500'>No calls yet.</li>}
      </ul>
    </main>
  )
}
