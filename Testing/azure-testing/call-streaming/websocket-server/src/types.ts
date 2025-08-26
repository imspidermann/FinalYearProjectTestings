import { WebSocket } from "ws";

export interface Session {
    twilioConn?: WebSocket;
    frontendConn?: WebSocket;
    azureRecognizer?: any;
    pushStream?: any;
    streamSid?: string;
    latestMediaTimeStamp?: number;
}
