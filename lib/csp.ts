// H-2: the Content-Security-Policy for every page (proxy.ts makes a fresh nonce per request; Next adds it to its scripts).
// Scripts: only ours with the nonce, and what they load ('strict-dynamic': the PayPal SDK script that paypal-js inserts).
// Styles allow inline: React style attributes, AG Grid and the PayPal SDK set them, and a nonce cannot cover attributes.
const PAYPAL = "https://*.paypal.com";
const PAYPAL_STATIC = "https://*.paypalobjects.com";

export function buildCsp(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${PAYPAL}${dev ? " 'unsafe-eval'" : ""}`, // dev: React's error overlay
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${PAYPAL} ${PAYPAL_STATIC}`,
    "font-src 'self' data:",
    `connect-src 'self' ${PAYPAL}`,
    `frame-src ${PAYPAL} ${PAYPAL_STATIC}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export const newNonce = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
