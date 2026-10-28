// Browser replacement for handlers/load-model/safe-fetch.ts. fetch() follows
// redirects itself and hides the intermediate responses, so redirect hops are
// not individually checked and Hub SHA-256 headers are only seen when the
// final response exposes them (CORS).
import { Readable } from 'bare-stream'
import { extractHubSha256, isHuggingFaceHost, isSecureDownloadUrl } from '@/utils/url-security'
import { DownloadCancelledError, InsecureModelSourceError } from '@/errors/index'
import type { SafeFetchOptions, SafeFetchResponse } from '@/handlers/load-model/safe-fetch'
import { browser, type FetchResponse, type WebReadableStream } from './globals'
import { readChunks } from './fs'

export type { SafeFetchOptions, SafeFetchResponse }

function assertSecure(url: URL, original: string): void {
  if (!isSecureDownloadUrl(url)) {
    throw new InsecureModelSourceError(
      original,
      'plaintext HTTP is only allowed for loopback hosts'
    )
  }
}

function bodyStream(body: WebReadableStream | null): Readable {
  return Readable.from(body ? readChunks(body.getReader()) : [])
}

export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const enforceSecureTransport = options.enforceSecureTransport ?? false
  const captureHashFromHost = options.captureHashFromHost ?? isHuggingFaceHost

  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new InsecureModelSourceError(input, 'invalid URL', error)
  }
  if (enforceSecureTransport) assertSecure(url, input)
  if (options.signal?.aborted) throw new DownloadCancelledError()

  const controller = new browser.AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(onAbort, options.timeoutMs)

  let response: FetchResponse
  try {
    response = await browser.fetch(url.href, {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      redirect: 'follow',
      signal: controller.signal as never
    })
  } catch (error) {
    if (options.signal?.aborted) throw new DownloadCancelledError()
    if (controller.signal.aborted) {
      throw new Error(`HTTP connection timeout after ${options.timeoutMs}ms`)
    }
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }

  const finalUrl = new URL(response.url || url.href)
  if (enforceSecureTransport) assertSecure(finalUrl, input)

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  const hubSha256 =
    captureHashFromHost(url.hostname) || captureHashFromHost(finalUrl.hostname)
      ? extractHubSha256(headers)
      : undefined

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: bodyStream(response.body),
    finalUrl: finalUrl.href,
    redirected: response.redirected,
    hubSha256
  }
}
