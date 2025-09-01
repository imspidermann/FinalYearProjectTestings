import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { stripRiffHeaderToRawMulaw } from "../utils/audioUtils";

export class AzureTTSClient {
  private key: string;
  private region: string;

  constructor(key: string, region: string) {
    this.key = key;
    this.region = region;
    if (!this.key || !this.region) {
      console.warn("Azure TTS key/region missing");
    }
  }

  /**
   * Synthesize text incrementally. Returns { promise, cancel }.
   * onAudioChunk receives base64 (raw µ-law 8k) chunks ready for Twilio media.
   */
  synthesizeTextStream(
    text: string,
    voiceName: string,
    onAudioChunk: (base64Mulaw: string) => void
  ): { promise: Promise<void>; cancel: () => void } {
    if (!this.key || !this.region) {
      return { promise: Promise.resolve(), cancel: () => {} };
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);
    // prefer Raw8Khz8BitMonoMULaw when available
    // @ts-ignore
    const rawFormat = sdk.SpeechSynthesisOutputFormat.Raw8Khz8BitMonoMULaw;
    // @ts-ignore
    const riffFormat = sdk.SpeechSynthesisOutputFormat.Riff8Khz8BitMonoMULaw;
    // If Raw exists use it; otherwise use RIFF and strip header
    // @ts-ignore
    speechConfig.speechSynthesisOutputFormat = rawFormat ? rawFormat : riffFormat;

    if (voiceName) speechConfig.speechSynthesisVoiceName = voiceName;

    let synthesizer: any = null;
    const p = new Promise<void>((resolve, reject) => {
      synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);

      // some SDK versions expose a 'synthesizing' event
      // @ts-ignore
      synthesizer.synthesizing = (s: any, e: any) => {
        try {
          const audioChunk = e?.result?.audioChunk;
          if (!audioChunk) return;
          const buf = Buffer.from(audioChunk);
          const raw = stripRiffHeaderToRawMulaw(buf);
          onAudioChunk(raw.toString("base64"));
        } catch (err) {
          // ignore
        }
      };

      synthesizer.speakTextAsync(
        text,
        (result: any) => {
          try {
            // Some SDKs provide final audio data in result.audioData
            if (result && (result.audioData || result.audio)) {
              const rawBuf = stripRiffHeaderToRawMulaw(Buffer.from(result.audioData || result.audio));
              onAudioChunk(rawBuf.toString("base64"));
            }
          } catch (err) {}
          synthesizer.close();
          resolve();
        },
        (err: any) => {
          try { synthesizer.close(); } catch {}
          reject(err);
        }
      );
    });

    const cancel = () => {
      try {
        if (synthesizer) synthesizer.close();
      } catch {}
    };
    return { promise: p, cancel };
  }
}
