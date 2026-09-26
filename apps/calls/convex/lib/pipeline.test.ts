import { describe, expect, test } from 'vitest'
import { speakerNames, titleFromSummary } from './pipeline'

describe('speakerNames', () => {
  test('reads WebVTT voice tags', () => {
    const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:02.000
<v Mary Sue>Morning everyone.

2
00:00:02.500 --> 00:00:04.000
<v.loud Sam>Hey Mary.

3
00:00:04.000 --> 00:00:06.000
<v Mary Sue>Let's start.`
    expect(speakerNames(vtt)).toEqual(['Mary Sue', 'Sam'])
  })

  test('reads the "Name: text" captions Campsite used with 100ms', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Mary Sue: Morning everyone.

00:00:02.500 --> 00:00:04.000
Sam: Hey Mary, one thing: the deploy.`
    expect(speakerNames(vtt)).toEqual(['Mary Sue', 'Sam'])
  })

  test('ignores cue numbers, timings and notes', () => {
    expect(speakerNames('WEBVTT\n\nNOTE generated\n\n12\n00:00:00.000 --> 00:00:01.000\nno speaker here')).toEqual([])
  })
})

describe('titleFromSummary', () => {
  test('uses the first meaningful line without markdown', () => {
    expect(titleFromSummary('## Summary\n\n**Q3 planning** kickoff with design and eng\n- timeline')).toBe(
      'Q3 planning kickoff with design and eng'
    )
  })

  test('caps long titles at 80 characters', () => {
    const title = titleFromSummary('x'.repeat(120))!
    expect(title).toHaveLength(80)
    expect(title.endsWith('...')).toBe(true)
  })

  test('returns nothing for an empty summary', () => {
    expect(titleFromSummary('\n  \n')).toBeUndefined()
  })
})
