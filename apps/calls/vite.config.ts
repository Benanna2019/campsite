import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Same plugin setup as Alchemy's Cloudflare TanStack Start example, so the
// Alchemy stack can deploy this as a Cloudflare Website without changes.
export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
