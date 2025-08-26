// Wrapper that uses microsoft-cognitiveservices-speech-sdk, creates PushAudioInputStream and SpeechRecognizer, emits events for partial/final results.

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { EventEmitter } from "stream";

export interface AzureRecognizerOptions {
    azureKey: string;
    azureRegion: string;
    // sampleRate: number; // Twilio media sample-rate usually 8000 (g711), but we push raw PCM16LE
}

/**
 * AzureRecognizer is an EventEmitter that emits:
 * - 'partial' with {text}
 * - 'final' with {text}
 * - 'error' with Error
 * - 'closed'
 */

export class AzureRecognizer extends EventEmitter {
    private pushStream: any;
    private audioConfig: any;
    private speechConfig: any;
    private recognizer: any;

    constructor(opts: AzureRecognizerOptions) {
        super();
        this.speechConfig = sdk.SpeechConfig.fromSubscription(
            opts.azureKey,
            opts.azureRegion
        );

        this.speechConfig.speechRecognitionLanguage = "en-US";
        const format = sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1);
        // expect PCM16 LE audio pushed into stream
        this.pushStream = sdk.AudioInputStream.createPushStream(format);
        this.audioConfig = sdk.AudioConfig.fromStreamInput(this.pushStream);
        this.recognizer = new sdk.SpeechRecognizer(this.speechConfig, this.audioConfig);

        this.recognizer.recognizing = (s: any, e: any) => {
            if(e && e.result && e.result.text) {
                this.emit("partial", {text: e.result.text});
            }
        };

        this.recognizer.recognized = (s: any, e: any) => {
            if(e.result && e.result.reason === sdk.ResultReason.RecognizedSpeech){
                this.emit("final", {text: e.result.text});
            } else if (e.result && e.result.reason === sdk.ResultReason.NoMatch) {
                // no match - ignore
            }
        };

        this.recognizer.canceled = (s: any, e: any) => {
            const err = new Error(`Azure canceled: ${e.errorDetails || e.reason}`);
            this.emit("error", err);
        };

        this.recognizer.sessionStopped = () => {
            this.emit("closed");
        };

        this.recognizer.startContinuousRecognitionAsync(
            () => {
                //started
            },
            (err: any) => {
                this.emit("error", err);
            }
        );
    }

    pushAudioChunk(chunk: Buffer){
        this.pushStream.write(chunk);
    }

    close() {
        try {
            this.pushStream.close();
            this.recognizer.stopContinuousRecognitionAsync(
                () => {
                    this.emit("closed");
                },
                (err: any) => {
                    this.emit("error", err);
                }
            );
        } catch (err){
            //ignore
        }
    }
}