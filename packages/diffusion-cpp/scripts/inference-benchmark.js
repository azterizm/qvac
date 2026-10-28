'use strict'

const fs = require('bare-fs')
const path = require('bare-path')
const process = require('bare-process')
const os = require('bare-os')
const { validateSpec, summarize } = require('./inference-benchmark-utils.cjs')

async function main() {
  if (process.argv.length !== 4) {
    throw new Error('Usage: bare scripts/inference-benchmark.js <spec.json> <new-output-directory>')
  }
  const specPath = path.resolve(process.argv[2])
  const outputDir = path.resolve(process.argv[3])
  const spec = validateSpec(JSON.parse(fs.readFileSync(specPath, 'utf8')))
  const base = path.dirname(specPath)
  const files = Object.fromEntries(
    Object.entries(spec.files).map(([key, value]) => [key, path.resolve(base, value)])
  )
  const config = { ...spec.config }
  if (config.backendsDir) config.backendsDir = path.resolve(base, config.backendsDir)
  fs.mkdirSync(outputDir)
  const reportPath = path.join(outputDir, 'metrics.json')
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    platform: os.platform(),
    arch: os.arch(),
    spec,
    files,
    config,
    runs: []
  }
  function save() {
    report.summary = summarize(report.runs)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  }
  save()
  let model = null
  let failure = null
  try {
    const Model = require(spec.kind === 'image' ? '../index' : '../video')
    model = new Model({ files, config, opts: { stats: true } })
    const loadStart = Date.now()
    await model.load()
    report.loadWallMs = Date.now() - loadStart
    save()
    for (let requestIndex = 0; requestIndex < spec.requests.length; requestIndex++) {
      const request = spec.requests[requestIndex]
      for (let iteration = 0; iteration < spec.warmupRuns + spec.runs; iteration++) {
        const params = { ...request.params }
        if (request.initImagePath) {
          params.init_image = fs.readFileSync(path.resolve(base, request.initImagePath))
        }
        const row = {
          request: request.name,
          iteration,
          warmup: iteration < spec.warmupRuns,
          firstProgressMs: null,
          firstMediaMs: null,
          outputBytes: 0,
          media: []
        }
        const started = Date.now()
        const response = await model.run(params)
        let stats = null
        response.on('stats', (value) => {
          stats = value
        })
        await response
          .onUpdate((value) => {
            if (value instanceof Uint8Array) {
              if (row.firstMediaMs === null) row.firstMediaMs = Date.now() - started
              const extension = spec.kind === 'image' ? 'png' : 'avi'
              const filename = `${requestIndex}-${iteration}-${row.media.length}.${extension}`
              fs.writeFileSync(path.join(outputDir, filename), value)
              row.media.push(filename)
              row.outputBytes += value.length
            } else if (row.firstProgressMs === null) {
              row.firstProgressMs = Date.now() - started
            }
          })
          .await()
        row.wallMs = Date.now() - started
        row.stats = stats || response.stats
        if (!row.media.length || !row.stats || !Number.isFinite(row.stats.generationMs)) {
          throw new Error('Generation must produce media and runtime statistics')
        }
        report.runs.push(row)
        save()
        console.log(JSON.stringify(row))
      }
    }
  } catch (error) {
    failure = error
  } finally {
    try {
      if (model) await model.unload()
    } catch (error) {
      failure ??= error
    } finally {
      if (failure) report.error = String(failure.stack || failure)
      save()
    }
  }
  if (failure) throw failure
  report.completed = true
  save()
  console.log('Benchmark report: ' + reportPath)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
