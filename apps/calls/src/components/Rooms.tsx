import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { href } from '../router'

export function Rooms() {
  const rooms = useQuery(api.rooms.mine)
  const create = useMutation(api.rooms.create)

  return (
    <main className='mx-auto w-full max-w-2xl px-4 py-10'>
      <div className='flex items-center justify-between'>
        <h1 className='text-xl font-semibold'>Your rooms</h1>
        <form
          className='flex gap-2'
          onSubmit={async (event) => {
            event.preventDefault()
            const title = String(new FormData(event.currentTarget).get('title') ?? '').trim()
            const roomId = await create(title ? { title } : {})
            window.location.hash = href.room(roomId)
          }}
        >
          <input name='title' placeholder='New room name' className='input' />
          <button className='btn-primary'>Create</button>
        </form>
      </div>

      <ul className='mt-8 divide-y divide-neutral-200 rounded-lg border border-neutral-200'>
        {rooms?.map((room) => (
          <li key={room._id}>
            <a href={href.room(room._id)} className='block px-4 py-3 hover:bg-neutral-50'>
              {room.title ?? 'Untitled room'}
            </a>
          </li>
        ))}
        {rooms?.length === 0 && <li className='px-4 py-3 text-sm text-neutral-500'>No rooms yet.</li>}
      </ul>
    </main>
  )
}
