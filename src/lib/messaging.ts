import type { Request, Response } from '@/background/messages'

export class PanelError extends Error {
  constructor(
    message: string,
    readonly needsAuth: boolean,
  ) {
    super(message)
    this.name = 'PanelError'
  }
}

/** Sends a request to the service worker and unwraps the result. */
export async function send<T>(request: Request): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as Response<T> | undefined

  // An undefined response means the worker was torn down mid-flight.
  if (!response) throw new PanelError('Extension background is not responding', false)
  if (!response.ok) throw new PanelError(response.error, response.needsAuth)

  return response.data
}
