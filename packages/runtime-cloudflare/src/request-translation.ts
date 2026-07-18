import type { PHPRequest, PHPResponseData } from "@php-wasm/universal"

export async function toPHPRequest(request: Request): Promise<PHPRequest> {
  const url = new URL(request.url)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, name) => { headers[name] = value })
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : new Uint8Array(await request.arrayBuffer())

  return {
    method: request.method as PHPRequest["method"],
    url: `${url.pathname}${url.search}`,
    headers,
    ...(body ? { body } : {}),
  }
}

export function toFetchResponse(request: Request, response: PHPResponseData): Response {
  const headers = new Headers()
  for (const [name, values] of Object.entries(response.headers)) {
    for (const value of values) headers.append(name, value)
  }
  const body = request.method === "HEAD" || [204, 205, 304].includes(response.httpStatusCode)
    ? null
    : response.bytes as unknown as BodyInit
  return new Response(body, { status: response.httpStatusCode, headers })
}
