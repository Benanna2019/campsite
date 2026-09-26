import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { Authenticated, AuthLoading, ConvexReactClient, Unauthenticated } from 'convex/react'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import type { Id } from '../convex/_generated/dataModel'
import { CallDetail } from './components/CallDetail'
import { Rooms } from './components/Rooms'
import { SignIn } from './components/SignIn'
import { useRoute } from './router'
import './styles.css'

// The RealtimeKit SDK is most of the bundle; only load it when opening a room.
const Room = lazy(() => import('./components/Room').then((m) => ({ default: m.Room })))

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

function Screen() {
  const route = useRoute()
  switch (route.name) {
    case 'room':
      return (
        <Suspense fallback={null}>
          <Room roomId={route.id as Id<'callRooms'>} />
        </Suspense>
      )
    case 'call':
      return <CallDetail callId={route.id as Id<'calls'>} />
    default:
      return <Rooms />
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <AuthLoading>{null}</AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Screen />
      </Authenticated>
    </ConvexAuthProvider>
  </StrictMode>
)
