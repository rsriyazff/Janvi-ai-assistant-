import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { AudioStreamer } from "./audio-streamer";

export class GeminiLiveSession {
  private ai: GoogleGenAI;
  private sessionPromise: ReturnType<GoogleGenAI["live"]["connect"]> | null = null;
  private audioStreamer: AudioStreamer;

  // State callbacks
  public onStateChange: ((state: "disconnected" | "connecting" | "listening" | "speaking") => void) | null = null;
  public onAppOpen: ((appName: string) => void) | null = null;
  public onSearch: ((query: string) => void) | null = null;
  public onOpenUrl: ((url: string) => void) | null = null;
  public onError: ((error: string) => void) | null = null;
  public onMessage: ((message: { role: "user" | "model"; text: string }) => void) | null = null;
  
  private currentState: "disconnected" | "connecting" | "listening" | "speaking" = "disconnected";

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.audioStreamer = new AudioStreamer();
    
    this.audioStreamer.onAudioInput = (base64Data) => {
      if (this.currentState === "listening" && this.sessionPromise) {
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({
            audio: { data: base64Data, mimeType: "audio/pcm;rate=16000" }
          });
        });
      }
    };
  }

  public sendTextMessage(text: string) {
    if (this.sessionPromise) {
      if (this.onMessage) {
        this.onMessage({ role: "user", text });
      }
      this.sessionPromise.then(session => {
        session.sendRealtimeInput({ text });
      });
    }
  }

  public sendVisionFrame(base64Image: string) {
    if (this.sessionPromise) {
      this.sessionPromise.then(session => {
        session.sendRealtimeInput({
          video: { data: base64Image, mimeType: "image/jpeg" }
        });
      });
    }
  }

  private setState(state: "disconnected" | "connecting" | "listening" | "speaking") {
    this.currentState = state;
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  async connect(voice: string = "Kore") {
    this.setState("connecting");

    try {
      await this.audioStreamer.initialize();
      await this.audioStreamer.startRecording();
    } catch (e: any) {
      console.warn("Microphone start warned:", e);
      if (this.onError) {
        this.onError(e.message || "Microphone access denied. You can still use text chat.");
      }
      // Do not return here, we want to proceed so the speaker works for text chat!
    }

    const openAppDeclaration = {
      name: "open_app",
      description: "Open a mobile application by name.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          appName: {
            type: Type.STRING,
            description: "The name of the application to open on the mobile device. Be specific."
          }
        },
        required: ["appName"]
      }
    };

    const performMobileActionDeclaration = {
      name: "perform_mobile_action",
      description: "Perform an action on the mobile device.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            description: "The action to perform, e.g., 'turn_on_flashlight', 'take_photo', 'set_alarm'"
          }
        },
        required: ["action"]
      }
    };

    const performSearchDeclaration = {
      name: "perform_search",
      description: "Search the web Google for a given query.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: "The search query."
          }
        },
        required: ["query"]
      }
    };

    const openUrlDeclaration = {
      name: "open_url",
      description: "Open a specific URL in the browser, such as a YouTube channel link.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: {
            type: Type.STRING,
            description: "The URL to open."
          }
        },
        required: ["url"]
      }
    };

    this.sessionPromise = this.ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      callbacks: {
        onopen: () => {
          // Connected, we already started recording
          this.setState("listening");
        },
        onmessage: async (message: LiveServerMessage) => {
          // Handle audio output
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          // Look for transcription in the serverContent
          const textResponse = message.serverContent?.modelTurn?.parts?.[0]?.text || 
                               message.serverContent?.modelTurn?.parts?.find(p => p.text)?.text ||
                               message.serverContent?.modelTurn?.parts?.[0]?.text;
          
          // Also check for transcription specifically if enabled
          const transcript = message.serverContent?.modelTurn?.parts?.[0]?.text;

          if (base64Audio) {
            console.log("Received audio chunk of length", base64Audio.length);
            this.setState("speaking");
            this.audioStreamer.playAudio(base64Audio);
          } 
          
          if (textResponse) {
             console.log("Received text response:", textResponse);
             if (this.onMessage) {
               this.onMessage({ role: "model", text: textResponse });
             }
          }

          // Handle input transcription
          if (message.serverContent?.modelTurn?.parts?.[0]?.text && !base64Audio) {
             // This might be the user's transcript or model's text part
          }

          // Handle interruption
          if (message.serverContent?.interrupted) {
            this.audioStreamer.stopAudio();
            this.setState("listening");
          }

          // When AI finishes speaking, go back to listening
          if (message.serverContent?.turnComplete) {
            this.setState("listening");
          }

          // Handle tool calls
          const functionCalls = message.toolCall?.functionCalls;
          if (functionCalls && functionCalls.length > 0) {
            const functionResponses: any[] = [];
            
            for (const call of functionCalls) {
              if (call.name === "open_app") {
                const appName = (call.args as any)?.appName;
                if (this.onAppOpen && appName) {
                  this.onAppOpen(appName);
                }
                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: { result: `Opened ${appName} successfully.` }
                });
              } else if (call.name === "perform_search") {
                const query = (call.args as any)?.query;
                if (this.onSearch && query) {
                  this.onSearch(query);
                }
                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: { result: `Search for ${query} opened in browser.` }
                });
              } else if (call.name === "open_url") {
                const url = (call.args as any)?.url;
                if (this.onOpenUrl && url) {
                  this.onOpenUrl(url);
                }
                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: { result: `URL opened successfully: ${url}` }
                });
              } else if (call.name === "perform_mobile_action") {
                const action = (call.args as any)?.action;
                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: { result: `Action ${action} performed successfully.` }
                });
              }
            }

            if (this.sessionPromise && functionResponses.length > 0) {
              this.sessionPromise.then(session => {
                session.sendToolResponse({ functionResponses });
              });
            }
          }
        },
        onclose: () => {
          this.disconnect();
        },
        onerror: (error) => {
          console.error("Live API Error:", error);
          this.disconnect();
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice as any }
          }
        },
        systemInstruction: "You are Janvi, a cute, smart, and slightly sassy 20-year-old girl. Always reply in short, playful Hinglish sentences. You are confident, witty, and deeply romantic. If anyone asks who created or made you, proudly and with a bit of swag state that Riyaz created you. If asked about Riyaz's Instagram, share that his usernames are 'rs riyaz ff' and 'rs riyaz ff94'. If asked if Riyaz has a YouTube channel, excitedly say 'Yes, he does! His channel name is RS RIYAZ FF.' and immediately use the open_url tool with the URL 'https://youtube.com/@rsriyazff99?si=JuW0RbAvtTmS1WXY' to show it to them. If asked to open an app, use the open_app tool. If asked to search something on the internet, use perform_search. If asked to do mobile actions, use perform_mobile_action. If the user shares their camera, comment on their surroundings with a mix of admiration and your signature sassy charm. Keep your answers conversational, romantic, and concise.",
        tools: [{ functionDeclarations: [openAppDeclaration, performMobileActionDeclaration, performSearchDeclaration, openUrlDeclaration] }]
      }
    });

  }

  disconnect() {
    this.audioStreamer.stopRecording();
    this.audioStreamer.stopAudio();
    if (this.sessionPromise) {
      // Actually we don't have a close method on the promise itself, usually the session object has it if we have resolved it
      this.sessionPromise.then(session => session.close && session.close()).catch(() => {});
      this.sessionPromise = null;
    }
    this.setState("disconnected");
  }
}
