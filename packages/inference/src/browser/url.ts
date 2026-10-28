// bare-url stand-in: the browser's URL plus the one helper the engine uses.
export function pathToFileURL(path: string): URL {
  return new URL(`file://${encodeURI(path.startsWith('/') ? path : `/${path}`)}`)
}

import { browser } from './globals'

const BrowserURL = browser.URL
export { BrowserURL as URL }
export default { URL: BrowserURL, pathToFileURL }
