import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { validateSpec, summarize } = require('./inference-benchmark-utils.cjs')

function spec() {
  return {
    kind: 'image',
    files: { model: 'model.gguf' },
    config: { backend: 'cuda0' },
    requests: [{ name: 'portrait', params: { prompt: 'A portrait', seed: 42 } }]
  }
}

test('benchmark requires reproducible seeds and distinct workloads', () => {
  const input = spec()
  const validated = validateSpec(input)
  assert.equal(validated.warmupRuns, 1)
  assert.equal(validated.runs, 3)
  assert.equal(input.runs, undefined)
  for (const seed of [-1, 0.5, NaN, undefined]) {
    const invalid = spec()
    invalid.requests[0].params.seed = seed
    assert.throws(() => validateSpec(invalid), /fixed non-negative seed/)
  }
  const duplicate = spec()
  duplicate.requests.push({ ...duplicate.requests[0] })
  assert.throws(() => validateSpec(duplicate), /unique/)
})

test('benchmark rejects empty sampling plans and invalid repeat counts', () => {
  assert.throws(() => validateSpec({ ...spec(), requests: [] }), /non-empty array/)
  assert.throws(() => validateSpec({ ...spec(), runs: 0 }), /positive integer/)
  assert.throws(() => validateSpec({ ...spec(), warmupRuns: -1 }), /non-negative integer/)
  assert.throws(() => validateSpec({ ...spec(), files: {} }), /checkpoint/)
  assert.throws(() => validateSpec({ ...spec(), kind: 'world' }), /image or video/)
})

test('summary excludes warmup, separates workloads, and distinguishes progress from media', () => {
  const summary = summarize([
    { request: 'a', warmup: true, wallMs: 9999, firstProgressMs: 1, firstMediaMs: 9998 },
    {
      request: 'a',
      wallMs: 100,
      firstProgressMs: 2,
      firstMediaMs: 99,
      stats: { denoiseMs: 80, totalGenerationMs: 10000 }
    },
    {
      request: 'a',
      wallMs: 90,
      firstProgressMs: 4,
      firstMediaMs: 88,
      stats: { denoiseMs: 70, totalGenerationMs: 10090 }
    },
    {
      request: 'b',
      wallMs: 500,
      firstProgressMs: null,
      firstMediaMs: 499,
      stats: { denoiseMs: 400 }
    }
  ])
  assert.equal(summary.length, 2)
  assert.equal(summary[0].samples, 2)
  assert.equal(summary[0].timings.wallMs.median, 95)
  assert.equal(summary[0].timings.firstProgressMs.median, 3)
  assert.equal(summary[0].timings.firstMediaMs.median, 93.5)
  assert.equal(summary[0].medianPhasesMs.denoiseMs, 75)
  assert.equal(summary[1].timings.firstProgressMs, null)
  assert.deepEqual(summarize([{ request: 'a', warmup: true, wallMs: 1 }]), [])
})
