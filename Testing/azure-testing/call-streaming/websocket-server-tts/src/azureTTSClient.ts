import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { stripRiffHeaderToRawMulaw } from "./utils";
import dotenv from "dotenv";
dotenv.config();


const KEY = process.env.AZURE_SPEECH_KEY || "";
const REGION = process.env.AZURE_SPEECH_REGION || "";

export function synthesizeTextStream(
    text: string,
    voiceName: string,
    onAudioChunk: (base64Mulaw: string) => void
) : Promise<void> {
    return new Promise((resolve, reject) => {
        if(!KEY || !REGION) return resolve();

        const speechConfig = sdk.SpeechConfig.fromSubscription(KEY, REGION);

        //@ts-ignore
        const outFormat = sdk.SpeechSynthesisOutputFormat.Raw8Khz8BitMonoMULaw
      ? sdk.SpeechSynthesisOutputFormat.Raw8Khz8BitMonoMULaw
      : sdk.SpeechSynthesisOutputFormat.Riff8Khz8BitMonoMULaw;

        speechConfig.speechSynthesisOutputFormat = outFormat;
        if(voiceName) speechConfig.speechSynthesisVoiceName = voiceName;

        const syntesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);

        //Stream as chunks
        //@ts-ignore
        syntesizer.synthesizing = (s:any, e: any) => {
            try {
                if(!e?.result) return;
                const chunk = Buffer.from(e.result.audioChunk);
                const raw = stripRiffHeaderToRawMulaw(chunk);
                onAudioChunk(raw.toString("base64"));
            } catch {}
        };

        syntesizer.speakTextAsync(
            text,
            (result) => {
                if(result?.audioData){
                    const raw = stripRiffHeaderToRawMulaw(Buffer.from(result.audioData));
                    onAudioChunk(raw.toString("base64"));
                }
                syntesizer.close();
                resolve();
            },
            (err) => {
                syntesizer.close();
                reject(err);
            }
        );
    });
    
}


