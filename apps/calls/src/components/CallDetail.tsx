import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { href } from '../router'

const status = { pending: 'Processing…', failed: "Couldn't be generated.", ready: '' } as const

export function CallDetail({ callId }: { callId: Id<'calls'> }) {
  const call = useQuery(api.calls.get, { callId })
  if (call === undefined) return null
  if (call === null) return <main className='p-10 text-sm text-neutral-500'>Call not found.</main>

  return (
    <main className='mx-auto w-full max-w-3xl px-4 py-10'>
      <a href={href.room(call.roomId)} className='text-sm text-neutral-500'>
        ← Room
      </a>
      <h1 className='mt-2 text-xl font-semibold'>{call.title ?? new Date(call.startedAt).toLocaleString()}</h1>
      <p className='mt-1 text-sm text-neutral-500'>{[...new Set(call.peers.map((p) => p.name))].join(', ')}</p>

      <section className='mt-8'>
        <h2 className='text-sm font-semibold text-neutral-500'>Summary</h2>
        {call.summary ? (
          <p className='mt-2 whitespace-pre-wrap text-sm leading-6'>{call.summary}</p>
        ) : (
          <p className='mt-2 text-sm text-neutral-500'>{call.summaryStatus ? status[call.summaryStatus] : 'No summary yet.'}</p>
        )}
      </section>

      {call.recordings.map((recording) => (
        <section key={recording._id} className='mt-8'>
          <h2 className='text-sm font-semibold text-neutral-500'>
            Recording{recording.speakers.length > 0 && ` · ${recording.speakers.join(', ')}`}
          </h2>
          {recording.status === 'uploaded' && recording.downloadUrl ? (
            <video controls src={recording.downloadUrl} className='mt-2 w-full rounded-lg bg-black' />
          ) : (
            <p className='mt-2 text-sm text-neutral-500'>
              {recording.status === 'errored' ? 'This recording failed.' : 'Recording is processing…'}
            </p>
          )}
          {recording.transcriptVtt ? (
            <details className='mt-3'>
              <summary className='cursor-pointer text-sm'>Transcript</summary>
              <pre className='mt-2 max-h-96 overflow-auto rounded bg-neutral-50 p-3 text-xs whitespace-pre-wrap'>
                {recording.transcriptVtt}
              </pre>
            </details>
          ) : (
            recording.transcriptStatus && <p className='mt-2 text-sm text-neutral-500'>Transcript: {status[recording.transcriptStatus] || 'ready'}</p>
          )}
        </section>
      ))}
    </main>
  )
}
