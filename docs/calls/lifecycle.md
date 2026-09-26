# Calls: lifecycle spec

This is the behavior the calls slice has to preserve, extracted from the Rails
implementation (`api/app/jobs/hms_events/*`, `api/app/models/call*.rb`,
`api/lib/hms_client.rb`) and mapped onto Cloudflare RealtimeKit.

It exists because the Rails behavior is spread across models, Sidekiq jobs and
11 webhook handlers. Nothing in the new code should be ported line by line; it
should satisfy this document.

## Vocabulary

| Concept | 100ms (today) | RealtimeKit (new) | Campsite record |
|---|---|---|---|
| A persistent place you can call into | Room (`remote_room_id`) | Meeting (`meeting.id`) | `CallRoom` |
| One occurrence of people being in it | Session (`session_id`) | Session (`meeting.sessionId`) | `Call` |
| A person's presence in a session | Peer (`peer_id`) | Participant (`participant.peerId`) | `CallPeer` |
| A recording of a session | Beam (`beam_id`) | Recording (`recording.id`) | `CallRecording` |
| Who is allowed to join and how | Management-token JWT + role | Participant token + preset | n/a |

A room is created once and reused. Every time people gather in it, a new
session (call) starts. A call can have several recordings.

## Lifecycle

```
room created ──► session opens ──► peers join/leave ──► session closes
                      │                                     │
                      └── recording starts ─► stops ─► uploaded
                                                            │
                                   transcript ready ─► speakers ─► summary/title
```

### 1. Room creation

**Today:** `CallRoom#create_hms_call_room!` (via `CreateHmsCallRoomJob`) calls
`POST https://api.100ms.live/v2/rooms` with a management JWT and stores
`remote_room_id`. Rooms belong to an organization and optionally a subject (a
project or message thread) and have a creator.

**Must:** creating a room creates exactly one remote meeting and stores its id.
Retries must not create a second meeting.

**RealtimeKit:** `POST /accounts/{account}/realtime/kit/{app}/meetings`
(`createMeeting`). Returns `data.id`.

### 2. Joining (auth)

**Today:** `CallRoom#viewer_token` signs an HS256 JWT with the 100ms app secret
(room id, user id, role). The client calls `hmsActions.join({ authToken })`.

**Must:** only members allowed to see the room get a token. The token carries
our user id so webhooks can be tied back to a member.

**RealtimeKit:** `POST .../meetings/{meeting}/participants` (`addParticipant`)
with `custom_participant_id` = our user id and `preset_name` (the role). Returns
`data.token`, passed to the client SDK. Tokens can be refreshed with
`POST .../participants/{participant}/token`. Tokens are minted by the server;
there is no shared secret on the client.

### 3. Session opens

| | |
|---|---|
| Today | `session.open.success` → `Call.create_or_find_by!(remote_session_id)`, `started_at`, copy project and permission from the room |
| RealtimeKit | `meeting.started` (`meeting.id`, `meeting.sessionId`, `meeting.startedAt`) |
| Must | Upsert the call by session id. Idempotent. |

Other events can arrive before `meeting.started` (webhooks are not ordered), so
every handler upserts the call by session id, exactly as Rails does with
`create_or_find_by_hms_event!`.

### 4. Peer joins

| | |
|---|---|
| Today | `peer.join.success` → upsert `CallPeer` by `remote_peer_id` (user, membership, name, `joined_at`); post a call message into a thread subject once per call; trigger stale events; show the incoming-call prompt |
| RealtimeKit | `meeting.participantJoined` (`participant.peerId`, `customParticipantId`, `userDisplayName`, `joinedAt`) |
| Must | Upsert the peer by peer id, linked to the member via `customParticipantId`. Idempotent. |

The "stale" Pusher triggers go away: clients subscribe to Convex queries.

### 5. Peer leaves

| | |
|---|---|
| Today | `peer.leave.success` → set `left_at`; if no active peers remain, `StopCallRecordingJob` stops the recording for the room |
| RealtimeKit | `meeting.participantLeft` (`participant.leftAt`) |
| Must | Set `leftAt` (upserting the peer if the join was missed). When the last active peer leaves, stop any active recording. |

### 6. Session closes

| | |
|---|---|
| Today | `session.close.success` → set `stopped_at`; close out peers still marked active; if fewer than 2 peers, no recordings, and under 30s, discard the call's chat messages; discard open room invitations |
| RealtimeKit | `meeting.ended` (`meeting.endedAt`, `reason`: `HOST_ENDED_MEETING` or `ALL_PARTICIPANTS_LEFT`) |
| Must | Set `stoppedAt`; set `leftAt = endedAt` on any peer without one; mark trivial calls (fewer than 2 peers, no recordings, under 30s) so the UI can hide them. |

### 7. Recording

Today there are four events. RealtimeKit has one event with a status.

| Today | RealtimeKit `recording.statusUpdate` status | Must |
|---|---|---|
| `beam.started.success` → create `CallRecording` (beam id, job id, `started_at`) | `RECORDING` | Upsert the recording by recording id with `startedAt` |
| `beam.stopped.success` → `stopped_at` | `UPLOADING` | Set `stoppedAt` |
| `beam.recording.success` → file path, size, dimensions, duration; update the call's total recording duration; hand the file to Imgix; process chat | `UPLOADED` | Store the file location, size and duration; recompute the call's `recordingsDuration` |
| `beam.failure` → delete the recording if it was too short, otherwise report to Sentry | `ERRORED` | Mark the recording failed and report it. Keep the row. |

Recording is started and stopped by the server
(`POST .../recordings`, `PUT .../recordings/{id}` with `action: stop`), never
directly by a client.

### 8. Transcript, speakers, summary

| Today | RealtimeKit | Must |
|---|---|---|
| `transcription.started.success` / `.success` / `.failure` track status and S3 paths | `meeting.transcript` fires once, per session, when the transcript is ready | Track transcript status on the recording |
| `ProcessCallRecordingTranscriptionJob` downloads the SRT and converts it to VTT with regexes | `GET .../sessions/{session}/transcript?format=VTT` returns VTT directly | Store the VTT |
| `create_speakers_from_transcription_vtt!` matches `Name:` prefixes in captions to peer names | same input | Create speakers by matching caption names to the call's peers |
| `GenerateCallTitleJob` and three OpenAI summary sections (summary, agenda, next steps) | `meeting.summary` / `GET .../sessions/{session}/summary` | Store the summary on the call |

The transcript and summary are per session in RealtimeKit and per recording in
Campsite. In practice a session with a transcript has one recording; the new
model stores the transcript on the recording that belongs to that session and
the summary on the call.

## Webhook delivery rules (RealtimeKit)

- Signed: `rtk-signature` is a base64 RSA-SHA256 signature of the raw body,
  verified with the PEM key from
  `https://api.realtime.cloudflare.com/.well-known/webhooks.json`. Verify the
  raw bytes, never re-serialized JSON.
- Any `2xx` is success. `5xx` and network errors are retried. Other `4xx`
  responses are recorded as failed and not retried.
- Not ordered, may be delivered more than once.

So: reject bad signatures with `401` (no retry), accept valid events durably
before returning `200`, and make every handler an idempotent upsert.

## Deliberate cuts for the slice

- Organizations, projects and message-thread subjects are reduced to an owner
  and an optional free-form subject. The Rails permission model stays in Rails.
- Chat recording processing (`ProcessCallRecordingChatJob`, chat links) is not
  ported yet. `meeting.chatSynced` is accepted and stored, not processed.
- The agenda and next-steps summary sections are replaced by RealtimeKit's
  single summary.
- Web push call invitations are out of scope.
