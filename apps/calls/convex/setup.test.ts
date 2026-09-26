import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { modules } from './test.setup'

// Proves the test harness: Convex functions run in-process against the schema,
// with no deployment.
test('convex-test runs against the schema', async () => {
  const t = convexTest(schema, modules)
  expect(await t.run(async () => 'ok')).toBe('ok')
})
