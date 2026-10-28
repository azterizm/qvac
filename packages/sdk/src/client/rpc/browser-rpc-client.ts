import RPC from 'bare-rpc'
import { RPCConnectionFailedError } from '@/utils/errors-client'
import { initializeConfig } from '@/client/init-hooks'
import { getClientLogger } from '@/logging'
import { sendShutdownMessage } from '@/client/rpc/shutdown-message'
import { createWorkerPortStream } from '@/utils/worker-port-stream'
import type { RuntimeContext } from '@qvac/inference/surface'

const logger = getClientLogger()

let rpcInstance: RPC | null = null
let rpcPromise: Promise<RPC> | null = null
let workerInstance: Worker | null = null
// Set while close() is in flight so concurrent callers share it.
let closingPromise: Promise<void> | null = null

const runtimeContext: RuntimeContext = { runtime: 'browser' }

// The browser has no config file; the worker runs with the SDK defaults.
async function resolveConfig() {
  return undefined
}

// No child-process exit in the browser (Worker lifecycle) — `#rpc` interface stub.
export function getWorkerLifeSignal(): AbortSignal | null {
  return null
}

// No life signal in the browser, so the RPC layer never calls this — `#rpc` interface stub.
export function notifyChannelClosed(): void {}

function startWorker(): Worker {
  try {
    // Bundlers that understand `new Worker(new URL(..., import.meta.url))`
    // (Vite, webpack, Parcel) emit the prebuilt worker as its own chunk.
    // lunte-disable-next-line no-undef -- browser global; this module only runs in a page
    return new Worker(new URL('../../../worker.browser.js', import.meta.url), {
      type: 'module',
      name: 'qvac'
    })
  } catch (error) {
    const message =
      'Failed to start the QVAC browser worker (@qvac/sdk/worker.browser). ' +
      `Error: ${String(error)}`
    logger.error(message)
    throw new RPCConnectionFailedError(message, error instanceof Error ? error : undefined)
  }
}

export async function getRPC() {
  if (rpcInstance) {
    return rpcInstance
  }

  if (rpcPromise) {
    return rpcPromise
  }

  rpcPromise = (async () => {
    const worker = startWorker()
    workerInstance = worker
    worker.addEventListener('error', (event) => {
      logger.error(`QVAC browser worker error: ${event.message}`)
    })
    logger.info('Browser worker started')

    const rpc = new RPC(createWorkerPortStream(worker), () => {})
    await initializeConfig(rpc, resolveConfig, runtimeContext)
    rpcInstance = rpc
    return rpc
  })()

  try {
    return await rpcPromise
  } catch (error) {
    logger.error(`Failed to initialize RPC: ${String(error)}`)
    workerInstance?.terminate()
    workerInstance = null
    throw error
  } finally {
    rpcPromise = null
  }
}

export async function close(): Promise<void> {
  if (closingPromise) return closingPromise

  closingPromise = (async () => {
    logger.info('🧹 Closing RPC client (browser)')
    if (rpcInstance) {
      await sendShutdownMessage(rpcInstance)
    }
    rpcInstance = null
    rpcPromise = null
    if (workerInstance) {
      workerInstance.terminate()
      workerInstance = null
    }
  })()

  try {
    await closingPromise
  } finally {
    closingPromise = null
  }
}

export async function createDuplexSession(payload: string, commandId: number) {
  const rpc = await getRPC()
  const req = rpc.request(commandId)
  const requestStream = req.createRequestStream()
  const responseStream = req.createResponseStream({ encoding: 'utf-8' })
  requestStream.write(new TextEncoder().encode(payload))
  return { requestStream, responseStream }
}
