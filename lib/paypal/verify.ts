// E6 self-verification (02 section 9.4). TODO(T-13): fetch and cache the cert from PAYPAL-CERT-URL (host must end in
// .paypal.com), message = `${transmission_id}|${transmission_time}|${webhook_id}|${crc32(rawBody)}`, verify RSA-SHA256.
// Until then every event is reported as fetch_failed so the route answers 500 and PayPal retries.
export async function verifyWebhook(
  rawBody: string,
  headers: Record<string, string | null>,
): Promise<{ result: "verified" | "unverified" | "fetch_failed"; webhook_id: string | null }> {
  void rawBody; void headers; // TODO(T-13): used by the real verifier
  return { result: "fetch_failed", webhook_id: null };
}
