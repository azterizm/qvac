#!/usr/bin/env node
// Checks the mobile tests and benchmark shards, mirrors the models the mobile suite stages into the US bucket and
// presigns them, then emits the host pre-stage commands that fetch them.

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { emitPrestage, seedAndPresign } from '../../../scripts/ci/mobile-prestage.mjs'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: PKG, stdio: 'inherit' })
const json = (f) => JSON.parse(readFileSync(join(PKG, f), 'utf8'))

// The mobile manifest plus the benchmark matrix, so the seed skips desktop-only models.
export function mobileModelNames() {
  const { resolvePinnedManifest } = createRequire(import.meta.url)(
    '../scripts/generate-prestage-block.js'
  )
  const resolved = resolvePinnedManifest(
    json('test/mobile/model-manifest.json'),
    json('test/integration/models.manifest.json')
  )
  return [...new Set(Object.values(resolved).flatMap((models) => models.map((m) => m.name)))]
}

sh('npm', ['run', 'test:mobile:validate'])
sh('npm', ['run', 'generate:benchmark-shards'])
sh('node', ['scripts/generate-benchmark-shards.js', '--assert-shards'])
const map = join(process.env.RUNNER_TEMP, 'llm-url-map.json')
seedAndPresign({
  pkg: PKG,
  manifest: 'test/integration/models.manifest.json',
  prefix: 'qvac_models_compiled/mobile-pilot/llm/',
  out: map,
  names: mobileModelNames().join(',')
})
emitPrestage(PKG, { env: { ...process.env, PRESTAGE_URL_MAP: map } })
