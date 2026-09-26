import { useEffect, useRef } from 'react'

/** Renders one MediaStreamTrack. Audio is played by RealtimeKit itself. */
export function Video({ track, mirrored, className }: { track: MediaStreamTrack; mirrored?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track])
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={className}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    />
  )
}
