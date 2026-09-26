import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { Authenticated, AuthLoading, ConvexReactClient, Unauthenticated } from 'convex/react'
import { type ReactNode, useState } from 'react'
import { SignIn } from '../components/SignIn'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Campsite Calls' }],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: Document,
  component: App,
})

/** Server-rendered HTML shell. */
function Document({ children }: { children: ReactNode }) {
  return (
    <html lang='en'>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

/** Client-only app (see start.ts). The Convex client is created here, never on the server. */
function App() {
  const [convex] = useState(() => new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string))
  return (
    <ConvexAuthProvider client={convex}>
      <AuthLoading>{null}</AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Outlet />
      </Authenticated>
    </ConvexAuthProvider>
  )
}
