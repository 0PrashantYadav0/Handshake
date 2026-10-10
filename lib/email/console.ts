import type { Email } from "./types";

export type Message = { to: string; subject: string; text: string };

export class RecordingEmail implements Email {
  sent: Message[] = [];
  async send(msg: Message): Promise<void> {
    this.sent.push(msg);
  }
}

export const fakeEmail = () => new RecordingEmail();

export const consoleEmail: Email = {
  async send(msg) {
    console.log(`[email] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
  },
};
