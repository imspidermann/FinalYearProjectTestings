import { WebSocket } from "ws";

export interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  streamSid?: string;
  azureRecognizer?: any;             // AzureRecognizer instance (EventEmitter)
  currentTTSCancel?: (() => void) | null;
  latestMediaTimestamp?: number;
  lastAssistantItem?: string | undefined;
  responseStartTimestamp?: number | undefined;
}

interface EventSourceMessage {
  data: string;
  event: string;
  id: string;
}