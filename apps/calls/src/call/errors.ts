import { ConvexError } from 'convex/values'

/**
 * The message to show a person. ConvexErrors carry our user-facing text in
 * `data`; their `message` includes request ids and stack frames.
 */
export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data
  return fallback
}
