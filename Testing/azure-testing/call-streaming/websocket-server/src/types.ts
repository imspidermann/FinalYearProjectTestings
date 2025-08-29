import { WebSocket } from "ws";

export interface Session {
    twilioConn?: WebSocket;
    frontendConn?: WebSocket;
    azureRecognizer?: any;
    pushStream?: any;
    streamSid?: string;
    latestMediaTimeStamp?: number;
    detectedLanguage?: string | null;
}

export interface TranscriptRecord {
    streamSid: string;
    text?: string;
    language?: string;
    timestamp: string;
    type: "final" | "partial" | "language_detected";
}

export interface LanguageDetectionEvent {
    language: string;
    confidence?: number;
}