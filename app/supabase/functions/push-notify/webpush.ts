/**
 * SI — Service Inside · Web Push crypto
 *
 * VAPID (RFC 8292) and payload encryption (RFC 8291) against Web Crypto.
 *
 * Written out rather than pulled from npm deliberately. `npm:web-push` reaches
 * for node:https and node:crypto under Deno's compatibility layer, and this repo
 * has twice chosen the explicit version over the convenient dependency for the
 * same reason — write-excel-file over the abandoned xlsx, a synthesised chime
 * over a bundled mp3. This file is pure: no Supabase, no I/O, no globals.
 *
 * The private key arrives as a JWK, not as the 32-byte base64url scalar the npm
 * ecosystem passes around. crypto.subtle.importKey cannot derive x and y from d,
 * so a bare scalar is unusable here and fails as an opaque DataError.
 */

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function bytesToB64url(b: ArrayBuffer | Uint8Array): string {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const byte of u8) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** HKDF as RFC 8291 uses it: one extract, one
 *  single-block expand. Never more than 32 bytes out, so the counter is always 0x01. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const saltKey = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const out = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concat(info, new Uint8Array([1]))));
  return out.slice(0, length);
}

/**
 * The `Authorization: vapid t=…, k=…` header.
 *
 * `aud` is the ORIGIN of the endpoint, not the endpoint itself. Sending the full
 * URL is the classic mistake here and the push service answers 401 with no
 * explanation of which half was wrong.
 */
export async function vapidHeader(endpoint: string, jwkJson: string, subject: string) {
  const jwk = JSON.parse(jwkJson);
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, key_ops: ["sign"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })));

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(`${header}.${body}`),
  );

  // Uncompressed public point, rebuilt from the JWK's own x and y.
  const publicKey = bytesToB64url(concat(
    new Uint8Array([4]),
    b64urlToBytes(jwk.x),
    b64urlToBytes(jwk.y),
  ));

  return `vapid t=${header}.${body}.${bytesToB64url(signature)}, k=${publicKey}`;
}

/**
 * RFC 8291 aes128gcm. Returns the complete request body:
 *   salt(16) || rs(4) || idlen(1) || as_public(65) || ciphertext
 */
export async function encryptPayload(plaintext: string, p256dh: string, authSecret: string) {
  const uaPublic = b64urlToBytes(p256dh);
  const auth = b64urlToBytes(authSecret);

  const asPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asPair.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPair.privateKey, 256),
  );

  // The order here is fixed by the spec and is not interchangeable: the auth
  // secret is the SALT of this first extract, and the shared secret is the IKM.
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(auth, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 is the padding delimiter marking this as the last (only) record.
  const record = concat(enc.encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record),
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}
