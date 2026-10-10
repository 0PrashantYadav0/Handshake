export interface Email {
  /** Resolves on success and on failure; failures are logged by the adapter. Never throws. */
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}
