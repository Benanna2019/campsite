import { ConvexError } from 'convex/values'
import { expect, test } from 'vitest'
import { userMessage } from './errors'

test('shows the ConvexError text, never raw server errors', () => {
  expect(userMessage(new ConvexError("Couldn't join the call."), 'fallback')).toBe("Couldn't join the call.")
  expect(userMessage(new Error('[CONVEX A(rooms:join)] [Request ID: 1] Server Error'), 'fallback')).toBe('fallback')
})
