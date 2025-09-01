import { WebSocket } from "ws";

export function isOpen(ws?: WebSocket): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));
}

export function parseMessage(data: Buffer | string): any | null {
  try {
    if (Buffer.isBuffer(data)) return JSON.parse(data.toString());
    return JSON.parse(data as string);
  } catch {
    return null;
  }
}

// strip RIFF header if exists and return raw mu-law buffer
export function stripRiffHeaderToRawMulaw(buf: Buffer): Buffer {
  if (buf.slice(0, 4).toString("ascii") === "RIFF") {
    const dataIdx = buf.indexOf(Buffer.from("data"));
    if (dataIdx !== -1) {
      const sizeStart = dataIdx + 4;
      const audioStart = sizeStart + 4; // skip length field
      return buf.slice(audioStart);
    }
    return buf.slice(44);
  }
  return buf;
}
