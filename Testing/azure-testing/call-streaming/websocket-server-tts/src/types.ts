import { WebSocket } from "ws";

export interface Session {
  twilioConn?: WebSocket;
  streamSid?: string;
  latestMediaTimestamp?: number;
  language?: "en" | "hi";
}
