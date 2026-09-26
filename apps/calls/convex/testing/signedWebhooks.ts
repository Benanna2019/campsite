// Signs RealtimeKit-shaped webhook bodies with a throwaway RSA key, the way
// RealtimeKit does (base64 RSA-SHA256 in rtk-signature). No test-framework
// imports, so Convex can bundle it.

export async function makeWebhookSigner() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey))
  const base64 = btoa(String.fromCharCode(...spki))
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`

  async function sign(body: string) {
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(body))
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }

  return { publicKeyPem, sign }
}

/** A RealtimeKit meeting object as it appears in webhook payloads. */
export function meeting(id: string, sessionId: string, times: { startedAt?: string; endedAt?: string } = {}) {
  return {
    id,
    sessionId,
    title: 'Weekly sync',
    status: 'LIVE',
    createdAt: '2026-06-03T10:00:00.000Z',
    startedAt: times.startedAt ?? '2026-06-03T10:00:00.000Z',
    ...(times.endedAt ? { endedAt: times.endedAt } : {}),
    organizedBy: { id: 'org', name: 'Example organization' },
  }
}
