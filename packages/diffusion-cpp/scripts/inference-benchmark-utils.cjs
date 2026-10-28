'use strict'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateSpec(spec) {
  if (!isObject(spec) || !['image', 'video'].includes(spec.kind)) {
    throw new Error('kind must be image or video')
  }
  if (!isObject(spec.files) || typeof spec.files.model !== 'string' || !spec.files.model) {
    throw new Error('files.model must identify a model checkpoint')
  }
  if (Object.values(spec.files).some((value) => typeof value !== 'string' || !value)) {
    throw new Error('files must contain non-empty checkpoint paths')
  }
  if (!isObject(spec.config)) throw new Error('config must be an object')
  const warmupRuns = spec.warmupRuns ?? 1
  const runs = spec.runs ?? 3
  if (!Number.isSafeInteger(warmupRuns) || warmupRuns < 0) {
    throw new Error('warmupRuns must be a non-negative integer')
  }
  if (!Number.isSafeInteger(runs) || runs < 1) {
    throw new Error('runs must be a positive integer')
  }
  if (!Array.isArray(spec.requests) || !spec.requests.length) {
    throw new Error('requests must be a non-empty array')
  }
  const names = new Set()
  for (const request of spec.requests) {
    if (!isObject(request) || typeof request.name !== 'string' || !request.name.trim()) {
      throw new Error('every request needs a non-empty name')
    }
    if (names.has(request.name)) throw new Error('request names must be unique')
    names.add(request.name)
    if (
      !isObject(request.params) ||
      !Number.isSafeInteger(request.params.seed) ||
      request.params.seed < 0
    ) {
      throw new Error('every request needs params with a fixed non-negative seed')
    }
  }
  return { ...spec, warmupRuns, runs }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function summarize(runs) {
  const groups = new Map()
  for (const run of runs) {
    if (run.warmup) continue
    if (!groups.has(run.request)) groups.set(run.request, [])
    groups.get(run.request).push(run)
  }
  return [...groups].map(([request, samples]) => {
    const timings = {}
    for (const key of ['wallMs', 'firstProgressMs', 'firstMediaMs']) {
      const values = samples.map((sample) => sample[key]).filter(Number.isFinite)
      timings[key] = values.length
        ? { median: median(values), min: Math.min(...values), max: Math.max(...values) }
        : null
    }
    const phases = {}
    for (const key of ['conditionerMs', 'denoiseMs', 'vaeMs', 'postProcessMs']) {
      const values = samples.map((sample) => sample.stats?.[key]).filter(Number.isFinite)
      phases[key] = values.length ? median(values) : null
    }
    return { request, samples: samples.length, timings, medianPhasesMs: phases }
  })
}

module.exports = { validateSpec, summarize }
