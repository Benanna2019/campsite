import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'
import { CallDetail } from '../components/CallDetail'

export const Route = createFileRoute('/calls/$callId')({ component: CallRoute })

function CallRoute() {
  const { callId } = Route.useParams()
  return <CallDetail callId={callId as Id<'calls'>} />
}
