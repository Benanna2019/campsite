// Recording pipeline (lifecycle spec §8): transcript → speakers, and
// summary → title. Scheduled by lifecycle.ts when RealtimeKit reports that a
// session's transcript or summary is ready.
import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { downloadText, speakerNames, titleFromSummary } from './lib/pipeline'
import { RealtimeKit } from './lib/realtimekit'
import { runEffect } from './lib/runtime'

export const callForPipeline = internalQuery({
  args: { callId: v.id('calls') },
  handler: (ctx, { callId }) => ctx.db.get(callId),
})

/** Fetch the session transcript as VTT, then store it and its speakers. */
export const processTranscript = internalAction({
  args: { callId: v.id('calls') },
  handler: async (ctx, { callId }) => {
    const call = await ctx.runQuery(internal.pipeline.callForPipeline, { callId })
    if (!call) return

    try {
      const vtt = await runEffect(
        Effect.gen(function* () {
          const rtk = yield* RealtimeKit
          const link = yield* rtk.transcriptLink(call.remoteSessionId)
          return yield* downloadText(link.url)
        })
      )
      await ctx.runMutation(internal.pipeline.saveTranscript, { callId, vtt })
    } catch (error) {
      console.error('Transcript processing failed', { callId, error })
      await ctx.runMutation(internal.pipeline.markTranscriptFailed, { callId })
    }
  },
})

/**
 * Stores the VTT on the call's uploaded recordings and records who spoke.
 * Speakers are caption names matched to the call's peers by name, as Rails'
 * create_speakers_from_transcription_vtt! does. Unmatched names are skipped.
 */
export const saveTranscript = internalMutation({
  args: { callId: v.id('calls'), vtt: v.string() },
  handler: async (ctx, { callId, vtt }) => {
    const recordings = await ctx.db
      .query('callRecordings')
      .withIndex('by_call', (q) => q.eq('callId', callId))
      .collect()
    const peers = await ctx.db
      .query('callPeers')
      .withIndex('by_call_leftAt', (q) => q.eq('callId', callId))
      .collect()
    const names = speakerNames(vtt)

    for (const recording of recordings) {
      await ctx.db.patch(recording._id, { transcriptVtt: vtt, transcriptStatus: 'ready' })
      for (const name of names) {
        const peer = peers.find((p) => p.name === name)
        if (!peer) continue
        const existing = await ctx.db
          .query('callRecordingSpeakers')
          .withIndex('by_recording_name', (q) => q.eq('recordingId', recording._id).eq('name', name))
          .unique()
        if (!existing) await ctx.db.insert('callRecordingSpeakers', { recordingId: recording._id, peerId: peer._id, name })
      }
    }
  },
})

export const markTranscriptFailed = internalMutation({
  args: { callId: v.id('calls') },
  handler: async (ctx, { callId }) => {
    const recordings = await ctx.db
      .query('callRecordings')
      .withIndex('by_call', (q) => q.eq('callId', callId))
      .collect()
    for (const recording of recordings) {
      if (recording.transcriptStatus !== 'ready') await ctx.db.patch(recording._id, { transcriptStatus: 'failed' })
    }
  },
})

/** Fetch RealtimeKit's summary; store it and derive a title if there isn't one. */
export const processSummary = internalAction({
  args: { callId: v.id('calls') },
  handler: async (ctx, { callId }) => {
    const call = await ctx.runQuery(internal.pipeline.callForPipeline, { callId })
    if (!call) return

    try {
      const summary = await runEffect(
        Effect.gen(function* () {
          const rtk = yield* RealtimeKit
          const link = yield* rtk.summaryLink(call.remoteSessionId)
          return yield* downloadText(link.url)
        })
      )
      await ctx.runMutation(internal.pipeline.saveSummary, { callId, summary: summary.trim() })
    } catch (error) {
      console.error('Summary processing failed', { callId, error })
      await ctx.runMutation(internal.pipeline.markSummaryFailed, { callId })
    }
  },
})

export const saveSummary = internalMutation({
  args: { callId: v.id('calls'), summary: v.string() },
  handler: async (ctx, { callId, summary }) => {
    const call = await ctx.db.get(callId)
    if (!call) return
    await ctx.db.patch(callId, {
      summary,
      summaryStatus: 'ready',
      // Never overwrite a title someone set by hand.
      ...(call.title ? {} : { title: titleFromSummary(summary) }),
    })
  },
})

export const markSummaryFailed = internalMutation({
  args: { callId: v.id('calls') },
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get(callId)
    if (call && call.summaryStatus !== 'ready') await ctx.db.patch(callId, { summaryStatus: 'failed' })
  },
})
