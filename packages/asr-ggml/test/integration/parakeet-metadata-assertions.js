'use strict'

function checkStreamingMetadata(t, outputs) {
  const segments = outputs.filter((output) => Array.isArray(output.tokenIds))
  t.ok(segments.length > 0, 'native ASR segments include token IDs')
  t.ok(
    segments.every((segment) => segment.tokenIds.every(Number.isInteger)),
    'token IDs retain integer values'
  )
  t.ok(
    segments.every((segment) => typeof segment.isFinal === 'boolean'),
    'native segment finality is explicit'
  )
  t.ok(
    segments.some((segment) => segment.isFinal),
    'final native segments are delivered'
  )
  t.ok(
    segments.every((segment) => Number.isInteger(segment.chunkIndex)),
    'native chunk indices are preserved'
  )
  t.ok(
    segments.every((segment) => Number.isFinite(segment.eotConfidence)),
    'segment EOU confidence is preserved, including zero'
  )
  const events = outputs.filter((output) => output.type === 'endOfTurn')
  t.ok(events.length > 0, 'native EOU events are delivered')
  t.ok(
    events.every(
      (event) =>
        Number.isFinite(event.timestamp) &&
        Number.isInteger(event.chunkIndex) &&
        Number.isFinite(event.confidence)
    ),
    'EOU events retain native time, chunk index and confidence'
  )
  t.is(
    events.length,
    segments.filter((segment) => segment.isEndOfTurn).length,
    'EOU segment flags do not duplicate typed events'
  )
}

module.exports = { checkStreamingMetadata }
