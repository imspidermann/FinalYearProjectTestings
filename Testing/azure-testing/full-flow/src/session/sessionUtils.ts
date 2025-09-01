import { RawData, WebSocket } from "ws";

export function parseMessage(data: RawData): any | null {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

export function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}
