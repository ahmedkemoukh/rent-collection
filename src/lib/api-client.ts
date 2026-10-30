// Browser helper for the app's own JSON API. Errors come back as { error } from the server.
export async function postJson<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const message =
        typeof json === 'object' && json !== null && typeof (json as { error?: unknown }).error === 'string'
          ? (json as { error: string }).error
          : `Request failed (${res.status})`
      return { ok: false, error: message }
    }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: 'Network error. Check your connection and try again.' }
  }
}
