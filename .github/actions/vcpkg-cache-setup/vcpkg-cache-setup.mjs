#!/usr/bin/env node
// s3 for prebuilds; files for C++ tests: a host dir that outlives the job, plus the workspace.

import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SAFE = /^[A-Za-z0-9/_.-]+$/

// setup-cuda exports the MSVC toolset it activates; artifacts built against another STL do not link, so each toolset
// gets its own cache.
export function toolsetDir(msvc) {
  if (!msvc) return ''
  if (!/^[0-9.]+$/.test(msvc)) throw new Error(`invalid MSVC version: ${msvc}`)
  return `msvc-${msvc}/`
}

export function s3Sources({ bucket, platform, arch, msvc }) {
  if (!bucket) throw new Error('cache-bucket is required for s3 mode')
  for (const v of [platform, arch])
    if (!SAFE.test(v || '')) throw new Error(`invalid platform/arch: ${v}`)
  return `clear;x-aws,s3://${bucket}/vcpkg-cache/${platform}-${arch}/${toolsetDir(msvc)},readwrite`
}

export function hostCandidates(env) {
  if (env.VCPKG_HOST_CACHE_DIR) return [env.VCPKG_HOST_CACHE_DIR]
  if (env.RUNNER_OS === 'Windows')
    return ['C:\\qvac\\vcpkg-cache', join(env.LOCALAPPDATA || homedir(), 'qvac', 'vcpkg-cache')]
  const shared =
    env.RUNNER_OS === 'macOS' ? '/Users/Shared/qvac-vcpkg-cache' : '/var/tmp/qvac-vcpkg-cache'
  return ['/opt/qvac/vcpkg-cache', shared, join(homedir(), '.cache', 'qvac', 'vcpkg-cache')]
}

export function filesSources({ hostDir, cacheDir, trusted }) {
  const host = hostDir ? `;files,${hostDir},${trusted ? 'write' : 'read'}` : ''
  return `clear${host};files,${cacheDir},readwrite`
}

// The groups check the PR out under src/; the path reaches GITHUB_ENV, so nothing else is allowed.
export function cacheDirFor(workspace, workdir) {
  if (!/^(src\/)?packages\/[A-Za-z0-9._-]+$/.test(workdir || ''))
    throw new Error(`unexpected workdir: ${workdir}`)
  return resolve(workspace, workdir, 'vcpkg', 'cache')
}

function writable(dir) {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      try {
        chmodSync(dir, 0o1777)
      } catch {}
    }
    const probe = join(dir, `.write-probe-${process.pid}`)
    writeFileSync(probe, 'ok')
    rmSync(probe)
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function main(env) {
  let lines
  if (env.MODE === 's3') {
    lines = [
      `VCPKG_BINARY_SOURCES=${s3Sources({ bucket: env.CACHE_BUCKET, platform: env.PLATFORM, arch: env.ARCH, msvc: env.QVAC_MSVC_VERSION })}`
    ]
  } else {
    const cacheDir = cacheDirFor(env.GITHUB_WORKSPACE, env.WORKDIR)
    mkdirSync(cacheDir, { recursive: true })
    const selfHosted = env.RUNNER_ENVIRONMENT !== 'github-hosted'
    const base = selfHosted ? hostCandidates(env).find(writable) || '' : ''
    const hostDir =
      base && toolsetDir(env.QVAC_MSVC_VERSION)
        ? join(base, toolsetDir(env.QVAC_MSVC_VERSION))
        : base
    if (selfHosted && !hostDir)
      console.log('::warning::no writable host cache dir; workspace layer only')
    lines = [
      `VCPKG_BINARY_SOURCES=${filesSources({ hostDir, cacheDir, trusted: env.TRUSTED === 'true' })}`,
      `VCPKG_CACHE_DIR=${cacheDir}`,
      `VCPKG_CACHE_PERSISTENT=${Boolean(hostDir)}`
    ]
  }
  console.log(lines.join('\n'))
  appendFileSync(env.GITHUB_ENV, lines.map((l) => `${l}\n`).join(''))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.env)
