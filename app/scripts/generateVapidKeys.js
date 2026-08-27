/**
 * SI — Service Inside · VAPID keypair generator
 * ============================================================================
 * Run once per Supabase project. Test and production MUST have different
 * keypairs: one shared pair would let the test project's push-notify function
 * deliver to production devices.
 *
 * The private half is emitted as a full JWK rather than the 32-byte base64url
 * scalar the web-push npm package uses. That is not a style choice — the Edge
 * Function signs with Web Crypto, and crypto.subtle.importKey cannot derive the
 * public coordinates x and y from the private scalar d. A bare scalar is
 * unusable there, and the failure arrives as an opaque DataError at runtime.
 *
 * Usage:  npm run keys:vapid
 * ============================================================================
 */
const { webcrypto } = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

(async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  // The uncompressed point, 65 bytes, 0x04 || x || y. This is what a browser
  // expects as applicationServerKey and what goes in the VAPID `k=` parameter.
  const rawPublic = await webcrypto.subtle.exportKey("raw", pair.publicKey);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);

  const publicKey = b64url(rawPublic);
  const triggerSecret = b64url(webcrypto.getRandomValues(new Uint8Array(32)));

  console.log("\n=== Supabase -> Edge Functions -> Secrets ===\n");
  console.log("VAPID_PUBLIC_KEY   =", publicKey);
  console.log("VAPID_PRIVATE_JWK  =", JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
  console.log("PUSH_TRIGGER_SECRET=", triggerSecret);
  console.log("VAPID_SUBJECT      = mailto:admin@pmw-group.com");
  console.log("\n=== Supabase -> SQL Editor, once ===\n");
  console.log(`select vault.create_secret('${triggerSecret}', 'push_trigger_secret');`);
  console.log("\n=== app/.env.test.local (or .env.prod.local) ===\n");
  console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + publicKey);
  console.log("\nPublic key length:", publicKey.length, "(expect 87)\n");
})();
