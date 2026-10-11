"use client";
// This browser's signing key (trust spec §6): ECDSA P-256, private key non-extractable, kept in IndexedDB.
// The private key never leaves the device; only { x, y } is sent, inside the signing request.
import { bytesToB64url, type PublicKey } from "./signature";

const DB = "handshake";
const STORE = "keys";
const ID = "device-signing-key";

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

async function deviceKey(): Promise<CryptoKeyPair> {
  const existing = await idb<CryptoKeyPair | undefined>("readonly", (s) => s.get(ID));
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  await idb("readwrite", (s) => s.put(pair, ID));
  return pair;
}

export async function devicePublicKey(): Promise<PublicKey> {
  const jwk = await crypto.subtle.exportKey("jwk", (await deviceKey()).publicKey);
  return { x: jwk.x!, y: jwk.y! };
}

export async function signWithDevice(message: string): Promise<{ signature: string; public_key: PublicKey }> {
  const pair = await deviceKey();
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(message));
  return { signature: bytesToB64url(sig), public_key: await devicePublicKey() };
}
