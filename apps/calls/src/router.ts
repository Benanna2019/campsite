import { useSyncExternalStore } from 'react'

// Three screens don't need a router dependency: #/, #/rooms/:id, #/calls/:id.
export type Route = { name: 'rooms' } | { name: 'room'; id: string } | { name: 'call'; id: string }

function parse(hash: string): Route {
  const [, kind, id] = hash.replace(/^#/, '').split('/')
  if (kind === 'rooms' && id) return { name: 'room', id }
  if (kind === 'calls' && id) return { name: 'call', id }
  return { name: 'rooms' }
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parse(hash)
}

export const href = {
  rooms: () => '#/',
  room: (id: string) => `#/rooms/${id}`,
  call: (id: string) => `#/calls/${id}`,
}
