import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { EventEmitter } from "stream";

export interface AzureRecognizerOptions {
    azureKey: string;
    azureRegion: string;
    // Languages to detect - hardcoded for now, will come from backend later
    candidateLanguages?: string[];
}

/**
 * AzureRecognizer is an EventEmitter that emits:
 * - 'partial' with {text, language}
 * - 'final' with {text, language}
 * - 'error' with Error
 * - 'closed'
 * - 'language_detected' with {language}
 */
export class AzureRecognizer extends EventEmitter {
    private pushStream: any;
    private audioConfig: any;
    private speechConfig: any;
    private recognizer: any;
    private candidateLanguages: string[];
    private detectedLanguage: string | null = null;

    constructor(opts: AzureRecognizerOptions) {
        super();
        
        // Default supported languages - can be customized
        this.candidateLanguages = opts.candidateLanguages || [
            "en-US",    // English (US)
            "es-ES",    // Spanish (Spain)
            "fr-FR",    // French (France)
            "de-DE",    // German (Germany)
            "it-IT",    // Italian (Italy)
            "pt-BR",    // Portuguese (Brazil)
            "ja-JP",    // Japanese
            "ko-KR",    // Korean
            "zh-CN",    // Chinese (Simplified)
            "hi-IN"     // Hindi (India)
        ];

        this.speechConfig = sdk.SpeechConfig.fromSubscription(
            opts.azureKey,
            opts.azureRegion
        );

        // Enable language detection with candidate languages
        const autoDetectSourceLanguageConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages(
            this.candidateLanguages
        );

        const format = sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1);
        this.pushStream = sdk.AudioInputStream.createPushStream(format);
        this.audioConfig = sdk.AudioConfig.fromStreamInput(this.pushStream);
        
        // Create recognizer with auto language detection
        this.recognizer = sdk.SpeechRecognizer.FromConfig(
            this.speechConfig, 
            autoDetectSourceLanguageConfig, 
            this.audioConfig
        );

        this.recognizer.recognizing = (s: any, e: any) => {
            if (e && e.result && e.result.text) {
                // Extract detected language from properties
                const detectedLanguage = this.extractDetectedLanguage(e.result);
                
                // Update our tracked language if detected
                if (detectedLanguage && detectedLanguage !== this.detectedLanguage) {
                    this.detectedLanguage = detectedLanguage;
                    this.emit("language_detected", { language: detectedLanguage });
                    console.log(`[Language Detected] ${detectedLanguage}`);
                }

                this.emit("partial", {
                    text: e.result.text,
                    language: detectedLanguage || this.detectedLanguage || "unknown"
                });
            }
        };

        this.recognizer.recognized = (s: any, e: any) => {
            if (e.result && e.result.reason === sdk.ResultReason.RecognizedSpeech) {
                const detectedLanguage = this.extractDetectedLanguage(e.result);
                
                // Update our tracked language if detected
                if (detectedLanguage && detectedLanguage !== this.detectedLanguage) {
                    this.detectedLanguage = detectedLanguage;
                    this.emit("language_detected", { language: detectedLanguage });
                    console.log(`[Language Detected] ${detectedLanguage}`);
                }

                this.emit("final", {
                    text: e.result.text,
                    language: detectedLanguage || this.detectedLanguage || "unknown"
                });
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
                console.log(`[Azure] Started recognition with languages: ${this.candidateLanguages.join(", ")}`);
            },
            (err: any) => {
                this.emit("error", err);
            }
        );
    }

    private extractDetectedLanguage(result: any): string | null {
        try {
            // Try to get the detected language from result properties
            const properties = result.properties;
            if (properties) {
                const languageProperty = properties.getProperty(
                    sdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult
                );
                if (languageProperty) {
                    return languageProperty;
                }
            }
            return null;
        } catch (error) {
            console.warn("Could not extract detected language:", error);
            return null;
        }
    }

    pushAudioChunk(chunk: Buffer) {
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
        } catch (err) {
            // ignore
        }
    }

    // Get currently detected language
    getDetectedLanguage(): string | null {
        return this.detectedLanguage;
    }

    // Get supported candidate languages
    getCandidateLanguages(): string[] {
        return [...this.candidateLanguages];
    }
}