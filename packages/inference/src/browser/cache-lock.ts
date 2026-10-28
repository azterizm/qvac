// Browser replacement for runtime/cache-lock.ts. The native lock is advisory:
// it warns when another live process holds the cache. Here the holder is
// another tab or worker of the same origin, detected with the Web Locks API.
import { getEngineLogger } from '@/logging/index'
import { browser } from './globals'

const logger = getEngineLogger()

const LOCK_NAME = 'qvac-cache'

let release: (() => void) | null = null

export function acquireCacheLock(): void {
  const locks = browser.navigator.locks
  if (release || !locks) return
  void locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
    if (!lock) {
      logger.warn('Another tab or worker of this origin is using the model cache')
      return undefined
    }
    logger.debug('Cache lock acquired')
    return new Promise<void>((resolve) => {
      release = resolve
    })
  })
}

export function releaseCacheLock(): void {
  if (!release) return
  release()
  release = null
  logger.debug('Cache lock released')
}
