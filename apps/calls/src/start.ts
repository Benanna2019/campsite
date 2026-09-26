import { createStart } from '@tanstack/react-start'

// Convex Auth keeps the session in localStorage, so the server can't render
// signed-in pages anyway. Render the shell on the server and the app on the
// client. Flip per route (`ssr: true`) once auth moves to cookies.
export const startInstance = createStart(() => ({ defaultSsr: false }))
