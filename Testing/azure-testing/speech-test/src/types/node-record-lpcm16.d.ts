// types/node-record-lpcm16.d.ts
declare module 'node-record-lpcm16' {
  interface RecordOptions {
    sampleRate?: number;
    threshold?: number;
    verbose?: boolean;
    recordProgram?: string;
    silence?: string;
    channels?: number;
    device?: string | null;
  }

  interface Recording {
    on(event: 'data', callback: (data: Buffer) => void): void;
    on(event: 'end', callback: () => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
  }

  function start(options?: RecordOptions): Recording;
  function stop(): void;

  const record: {
    start: (options?: RecordOptions) => Recording;
    stop: () => void;
  };

  export = record;
}