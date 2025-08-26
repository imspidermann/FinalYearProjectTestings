import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import * as path from "path";
import "dotenv/config";
import * as fs from "fs";

const speechKey = process.env.AZURE_SPEECH_KEY || "";
const serviceRegion = process.env.AZURE_SPEECH_REGION || "centralindia";

if(!speechKey){
    throw new Error("Missing Azure Speech Key");
}

const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, serviceRegion);

// STT : Microphone -> Text

// export const testSTT = () => {
//     speechConfig.speechRecognitionLanguage = "en-IN";
//     const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
//     const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

//     console.log("Say something...");

//     recognizer.recognizeOnceAsync(result => {
//         console.log("STT Result :", result.text);
//         recognizer.close();
//     });
// };

export const testSTTFromFile = (filePath: string) => {
  speechConfig.speechRecognitionLanguage = "en-IN";

  // Read file into a Node.js Buffer
  const fileBuffer = fs.readFileSync(filePath);

  // Use Buffer instead of string
  const audioConfig = sdk.AudioConfig.fromWavFileInput(fileBuffer);

  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizeOnceAsync(result => {
    if (result.reason === sdk.ResultReason.RecognizedSpeech) {
      console.log("STT Result from file:", result.text);
    } else {
      console.log("❌ Speech not recognized.");
    }
    recognizer.close();
  });
};


// TTS : Text -> Audio file

export const testTTS = (text: string) => {
    speechConfig.speechSynthesisVoiceName = "en-IN-NeerjaNeural";
    const outputFile = path.join(__dirname, "output.wav");

    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(outputFile);
    const syntesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

    syntesizer.speakTextAsync(
        text,
        result => {
            if(result.reason === sdk.ResultReason.SynthesizingAudioCompleted){
                console.log(`TTS Audio saved at: ${outputFile}`);
            } else {
                console.error("TTS Failed", result.errorDetails);
            }
            syntesizer.close();
        }
    )
}