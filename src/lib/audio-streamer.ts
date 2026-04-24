export class AudioStreamer {
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private isRecording = false;

  public onAudioInput: ((base64: string) => void) | null = null;

  // Simple playback queue
  private playbackQueue: Float32Array[] = [];
  private isPlaying = false;
  private nextPlayTime = 0;

  constructor() {}

  async initialize() {
    if (this.inputContext && this.outputContext) {
      if (this.inputContext.state === 'suspended') {
        await this.inputContext.resume().catch(() => {});
      }
      if (this.outputContext.state === 'suspended') {
        await this.outputContext.resume().catch(() => {});
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.inputContext = new AudioContextClass({ sampleRate: 16000 });
    this.outputContext = new AudioContextClass({ sampleRate: 24000 });
    
    // Resume them if they are in suspended state (this handles strict autoplay policies if called from user interaction)
    if (this.inputContext.state === 'suspended') {
      await this.inputContext.resume().catch(() => {});
    }
    if (this.outputContext.state === 'suspended') {
      await this.outputContext.resume().catch(() => {});
    }
  }

  async startRecording() {
    if (!this.inputContext || !this.outputContext) await this.initialize();
    
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone API not available.");
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      await this.inputContext!.resume();
      await this.outputContext!.resume();

      const source = this.inputContext!.createMediaStreamSource(this.stream);
      
      // Using ScriptProcessor for simplicity and compatibility across browsers without serving files
      this.inputProcessor = this.inputContext!.createScriptProcessor(2048, 1, 1);
      
      this.inputProcessor.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert to base64
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        if (this.onAudioInput) {
          this.onAudioInput(base64);
        }
      };

      source.connect(this.inputProcessor);
      this.inputProcessor.connect(this.inputContext!.destination);

      this.isRecording = true;
    } catch (error: any) {
      console.warn("Could not access microphone, continuing with playback only:", error);
      // Even if mic fails, we want the speaker to work.
      await this.outputContext?.resume().catch(console.error);
      throw new Error(error.name === "NotAllowedError" || error.message.includes("Permission denied") 
        ? "Microphone access denied. You can only chat using text." 
        : error.message || "Failed to access microphone. Text chat only.");
    }
  }

  stopRecording() {
    this.isRecording = false;
    if (this.inputProcessor) {
      this.inputProcessor.disconnect();
      this.inputProcessor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.inputContext?.suspend();
    this.outputContext?.suspend();
    this.playbackQueue = [];
    this.isPlaying = false;
  }

  playAudio(base64Data: string) {
    if (!this.outputContext) return;

    // Decode base64 to Int16
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);

    // Convert Int16 to Float32
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    this.playbackQueue.push(float32);
    if (!this.isPlaying) {
      this.scheduleNextBuffer();
    }
  }

  private scheduleNextBuffer() {
    if (!this.outputContext) return;
    if (this.playbackQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const float32 = this.playbackQueue.shift()!;
    const audioBuffer = this.outputContext.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.outputContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputContext.destination);

    const currentTime = this.outputContext.currentTime;
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;

    source.onended = () => {
      this.scheduleNextBuffer();
    };
  }

  stopAudio() {
    this.playbackQueue = [];
    this.isPlaying = false;
    // Fast way to stop is suspend and resume the context, or just reset nextPlayTime
    this.nextPlayTime = this.outputContext ? this.outputContext.currentTime : 0;
  }
}
