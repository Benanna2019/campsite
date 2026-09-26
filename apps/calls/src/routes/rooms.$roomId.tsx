import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'
import { Room } from '../components/Room'

export const Route = createFileRoute('/rooms/$roomId')({ component: RoomRoute })

function RoomRoute() {
  const { roomId } = Route.useParams()
  return <Room roomId={roomId as Id<'callRooms'>} />
}
