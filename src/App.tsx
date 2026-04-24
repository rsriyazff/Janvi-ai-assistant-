import { useState, useEffect, useRef } from "react";
import { Mic, Power, Loader2, Smartphone, Camera, RefreshCw, Radio, MessageSquare, Send } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GeminiLiveSession } from "./lib/gemini-live";

export default function App() {
  const [geminiSession, setGeminiSession] = useState<GeminiLiveSession | null>(null);
  const [state, setState] = useState<"disconnected" | "connecting" | "listening" | "speaking">("disconnected");
  const [lastAction, setLastAction] = useState<string>("");
  
  // Camera & Stream states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [systemError, setSystemError] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Chat states
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("Kore");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "model"; text: string }[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isChatOpen]);

  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
  }, []);

  useEffect(() => {
    let interval: number;
    
    if ((state === "listening" || state === "speaking") && isLiveStreaming && isCameraActive && videoRef.current) {
      interval = window.setInterval(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !geminiSession) return;
        
        const ctx = canvas.getContext("2d");
        if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth / 2; // Reduce resolution to save bandwidth
          canvas.height = video.videoHeight / 2;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
          const base64 = dataUrl.split(",")[1];
          geminiSession.sendVisionFrame(base64);
        }
      }, 2000); // 1 frame every 2 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [state, isLiveStreaming, isCameraActive, geminiSession]);

  const startCamera = async (mode: "user" | "environment") => {
    setSystemError("");
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode }
      });
      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (error: any) {
      console.error("Error accessing camera:", error);
      setSystemError(error.name === "NotAllowedError" || error.message.includes("Permission denied")
        ? "Camera access denied. Please check your browser permissions or open in a new tab."
        : error.message || "Failed to access camera.");
      setIsCameraActive(false);
      setTimeout(() => setSystemError(""), 15000);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsLiveStreaming(false);
  };

  const toggleCamera = () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      setIsCameraActive(true);
      startCamera(facingMode);
    }
  };

  const switchCamera = () => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    if (isCameraActive) {
      startCamera(newMode);
    }
  };

  useEffect(() => {
    // Only initialize once, we need the API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Missing Gemini API Key");
      return;
    }

    const session = new GeminiLiveSession(apiKey);
    session.onStateChange = (newState) => {
      setState(newState);
    };
    session.onError = (error) => {
      setSystemError(error);
      setTimeout(() => setSystemError(""), 15000);
    };

    session.onAppOpen = (appName) => {
      setLastAction(`Opening ${appName}...`);
      setTimeout(() => setLastAction(""), 3000);
      
      const appNameLower = appName.toLowerCase();
      let url = "";

      if (appNameLower.includes("youtube")) {
        url = "vnd.youtube://";
      } else if (appNameLower.includes("whatsapp")) {
        url = "whatsapp://";
      } else if (appNameLower.includes("instagram")) {
        url = "instagram://";
      } else if (appNameLower.includes("facebook")) {
        url = "fb://";
      } else if (appNameLower.includes("twitter") || appNameLower.includes("x")) {
        url = "twitter://";
      } else if (appNameLower.includes("map")) {
        url = "googlemaps://";
      } else if (appNameLower.includes("spotify")) {
        url = "spotify://";
      } else if (appNameLower.includes("tiktok")) {
        url = "tiktok://";
      } else if (appNameLower.includes("snapchat")) {
        url = "snapchat://";
      } else if (appNameLower.includes("telegram")) {
        url = "tg://";
      } else {
        // Fallback: search for the app on Play Store
        url = `market://search?q=${encodeURIComponent(appName)}`;
      }

      try {
        window.location.href = url;
      } catch (e) {
        console.error("Could not open app", e);
      }
    };

    session.onSearch = (query) => {
      setLastAction(`Searching for: ${query}`);
      setTimeout(() => setLastAction(""), 3000);
      try {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
      } catch (e) {
        window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
    };

    session.onOpenUrl = (url) => {
      setLastAction(`Opening Link...`);
      setTimeout(() => setLastAction(""), 3000);
      window.open(url, '_blank');
    };

    session.onMessage = (msg) => {
      setMessages((prev) => {
        const newMsgs = [...prev, msg];
        return newMsgs.slice(-10); // Keep only last 10
      });
    };
    
    setGeminiSession(session);

    return () => {
      session.disconnect();
    };
  }, []);

  const handleToggleConnect = async () => {
    if (!geminiSession) return;
    
    if (state === "disconnected") {
      geminiSession.connect(selectedVoice);
    } else if (state === "listening" || state === "speaking") {
      geminiSession.disconnect();
    }
  };

  // UI state derived configurations
  const isConnected = state === "listening" || state === "speaking";
  const isConnecting = state === "connecting";
  const isSpeaking = state === "speaking";

  return (
    <div className="relative w-full h-screen bg-[#080808] text-white overflow-hidden font-sans flex flex-col items-center justify-between p-6 md:p-10">
      {/* Camera View Side Panel */}
      <AnimatePresence>
        {isCameraActive && (
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.9 }}
            className="absolute top-8 right-4 md:top-10 md:right-10 z-40 w-28 h-40 md:w-48 md:h-64 rounded-2xl overflow-hidden border border-white/20 shadow-[-10px_10px_30px_rgba(0,0,0,0.5)] bg-black"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {isLiveStreaming && (
              <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md border border-white/10">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-[8px] uppercase font-bold text-rose-100 tracking-widest">Live</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Immersive Background */}
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
        <div className={`absolute top-[-10%] left-[-10%] w-[300px] md:w-[500px] h-[300px] md:h-[500px] rounded-full blur-[120px] md:blur-[160px] transition-colors duration-1000 ${isSpeaking ? 'bg-rose-600' : 'bg-amber-600/50'}`}></div>
        <div className={`absolute bottom-[-10%] right-[-10%] w-[300px] md:w-[500px] h-[300px] md:h-[500px] rounded-full blur-[120px] md:blur-[160px] transition-colors duration-1000 ${isSpeaking ? 'bg-amber-600' : 'bg-rose-600/50'}`}></div>
      </div>

      {/* Existing wave logic (moved slightly to adapt) - keep it low opacity at the bottom */}
      <div className="absolute bottom-0 left-0 w-full h-[30vh] opacity-20 pointer-events-none overflow-hidden flex items-end justify-center z-0">
        <svg className="w-[150%] h-full mix-blend-screen opacity-50" viewBox="0 0 100 100" preserveAspectRatio="none">
          <motion.path
            fill="none"
            stroke={isSpeaking ? "#f43f5e" : "#fbbf24"}
            strokeWidth="0.5"
            initial={{ d: "M 0 50 Q 25 50 50 50 T 100 50" }}
            animate={
              isSpeaking
              ? { d: ["M 0 50 Q 25 20 50 50 T 100 50", "M 0 50 Q 25 80 50 50 T 100 50"] }
              : isConnected
                ? { d: ["M 0 50 Q 25 40 50 50 T 100 50", "M 0 50 Q 25 60 50 50 T 100 50"] }
                : { d: "M 0 50 Q 25 50 50 50 T 100 50" }
            }
            transition={{ duration: isSpeaking ? 0.3 : 2, repeat: Infinity, repeatType: "mirror" }}
          />
        </svg>
      </div>

      {/* Header from Immersive UI */}
      <header className="w-full flex justify-between items-center z-10">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-rose-500 animate-pulse shadow-[0_0_10px_#f43f5e]' : 'bg-zinc-600'}`}></div>
          <span className="text-xs md:text-sm font-medium tracking-[0.2em] uppercase text-zinc-400">
            {isConnected ? "Session Active: Gemini Live" : "System Standby"}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <h1 className="text-xl md:text-2xl font-light tracking-widest text-white italic">JANVI AI</h1>
          <span className="text-[8px] md:text-[10px] uppercase tracking-[0.3em] text-rose-300">Sassy & Synthetic</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center w-full z-10 relative mt-8">
        
        {/* Action Log Overlay / Error Overlay */}
        <AnimatePresence>
          {(lastAction || systemError) && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`absolute top-0 flex flex-col items-center gap-2 px-6 py-4 rounded-3xl border z-50 backdrop-blur-md shadow-2xl ${systemError ? 'bg-rose-950/80 border-rose-500/50' : 'bg-black/60 border-white/10'}`}
            >
              <div className="flex items-center gap-2">
                <Smartphone className={`w-5 h-5 ${systemError ? 'text-rose-400' : 'text-amber-400'}`} />
                <span className="text-sm font-medium tracking-wide text-white">{systemError || lastAction}</span>
              </div>
              
              {systemError && systemError.includes("new tab") && (
                <button
                  onClick={() => window.open(window.location.href, '_blank')}
                  className="mt-2 text-xs uppercase tracking-widest font-bold bg-white text-black px-4 py-2 rounded-full hover:bg-zinc-200 transition-colors"
                >
                  Open in New Tab
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col items-center">
          <div className="text-white/60 text-sm mb-4 h-6 relative z-30 font-medium tracking-wide">
            <AnimatePresence mode="wait">
              {isConnecting ? (
                <motion.span key="connecting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Connecting...</motion.span>
              ) : state === "disconnected" ? (
                <motion.span key="disconnected" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Tap to connect</motion.span>
              ) : state === "listening" ? (
                <motion.span key="listening" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-amber-400">Listening... tap to disconnect</motion.span>
              ) : (
                <motion.span key="speaking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-rose-400">Janvi is speaking...</motion.span>
              )}
            </AnimatePresence>
          </div>

          <div className="relative flex items-center justify-center w-full max-w-[400px] aspect-square">
            {/* Static outer ring from design */}
            <div className="absolute w-full h-full border border-white/5 rounded-full pointer-events-none"></div>
            <div className="absolute w-[75%] h-[75%] border border-white/10 rounded-full pointer-events-none"></div>
          
          {/* Animated rings for speaking/listening */}
          {isConnected && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className={`absolute rounded-full border ${isSpeaking ? "border-rose-500/30" : "border-amber-500/20"}`}
                  initial={{ width: "60%", height: "60%", opacity: 0 }}
                  animate={
                    isSpeaking
                    ? {
                        width: ["60%", `${80 + i * 10}%`, "60%"],
                        height: ["60%", `${80 + i * 10}%`, "60%"],
                        opacity: [0.8, 0, 0.8]
                      }
                    : {
                        width: ["60%", `${65 + i * 5}%`, "60%"],
                        height: ["60%", `${65 + i * 5}%`, "60%"],
                        opacity: [0.3, 0.1, 0.3]
                      }
                  }
                  transition={{
                    duration: isSpeaking ? 1.5 : 3,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut"
                  }}
                />
              ))}
            </div>
          )}

          {/* Central Dial Button */}
          <div className="relative w-48 h-48 sm:w-64 sm:h-64 flex items-center justify-center group cursor-pointer z-10" onClick={() => handleToggleConnect()}>
            {/* Underlying glow */}
            <div className={`absolute inset-0 bg-gradient-to-tr from-rose-500 via-amber-400 to-rose-600 rounded-full blur-2xl transition-opacity duration-500 ${isSpeaking ? 'opacity-40' : isConnected ? 'opacity-15' : 'opacity-0'}`}></div>
            
            {/* The black glass circle */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`absolute inset-4 sm:inset-8 bg-black/40 backdrop-blur-3xl rounded-full border border-white/20 shadow-2xl flex items-center justify-center transition-all ${isConnecting ? 'border-white/40' : ''}`}
            >
              {isConnecting ? (
                <Loader2 className="w-10 h-10 animate-spin text-white/70" />
              ) : state === "disconnected" ? (
                <Power className="w-12 h-12 text-white/50 group-hover:text-white/80 transition-colors" />
              ) : isSpeaking ? (
                /* Audio visualizer bar group from theme */
                <div className="flex items-end space-x-1.5 h-12">
                  <motion.div animate={{ height: [16, 32, 16] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-1.5 bg-rose-400 rounded-full"></motion.div>
                  <motion.div animate={{ height: [24, 48, 24] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.1 }} className="w-1.5 bg-amber-400 rounded-full"></motion.div>
                  <motion.div animate={{ height: [32, 64, 32] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-1.5 bg-white rounded-full"></motion.div>
                  <motion.div animate={{ height: [24, 40, 24] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.3 }} className="w-1.5 bg-rose-400 rounded-full"></motion.div>
                  <motion.div animate={{ height: [16, 24, 16] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-1.5 bg-amber-400 rounded-full"></motion.div>
                </div>
              ) : (
                <Mic className="w-12 h-12 text-zinc-300" />
              )}
            </motion.div>
          </div>
        </div>
        </div>

        {/* Camera & Stream Controls */}
        <div className="flex items-center gap-4 mt-8 z-20">
          <button 
            onClick={toggleCamera} 
            className={`p-3 rounded-full border transition-all ${isCameraActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'}`}
          >
            <Camera className="w-5 h-5" />
          </button>
          
          <AnimatePresence>
            {isCameraActive && (
              <motion.button 
                initial={{ opacity: 0, scale: 0.8, w: 0 }}
                animate={{ opacity: 1, scale: 1, w: "auto" }}
                exit={{ opacity: 0, scale: 0.8, w: 0 }}
                onClick={switchCamera} 
                className="p-3 rounded-full border bg-white/5 border-white/10 text-white/50 cursor-pointer hover:bg-white/10 hover:text-white/80 transition-all"
              >
                <RefreshCw className="w-5 h-5" />
              </motion.button>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isCameraActive && (
              <motion.button 
                initial={{ opacity: 0, scale: 0.8, w: 0 }}
                animate={{ opacity: 1, scale: 1, w: "auto" }}
                exit={{ opacity: 0, scale: 0.8, w: 0 }}
                onClick={() => setIsLiveStreaming(!isLiveStreaming)} 
                className={`p-3 rounded-full border transition-all ${isLiveStreaming ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'}`}
              >
                <Radio className="w-5 h-5" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Chat Toggle Button */}
          <button 
            onClick={() => setIsChatOpen(!isChatOpen)} 
            className={`p-3 rounded-full border transition-all ${isChatOpen ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'}`}
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        </div>

        {/* Chat Overlay */}
        <AnimatePresence>
          {isChatOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-28 w-full max-w-sm px-6 z-40 flex flex-col gap-4"
            >
              {/* Chat History */}
              <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto scrollbar-hide px-2">
                {messages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: msg.role === "user" ? 10 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div 
                      className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm shadow-lg ${
                        msg.role === "user" 
                          ? "bg-rose-500/20 border border-rose-500/30 text-rose-100 rounded-tr-none" 
                          : "bg-white/10 border border-white/10 text-white/90 rounded-tl-none backdrop-blur-md"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </motion.div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chatInput.trim() && geminiSession && state !== "disconnected") {
                    geminiSession.sendTextMessage(chatInput.trim());
                    setChatInput("");
                  }
                }} 
                className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-xl border border-white/20 rounded-full shadow-2xl"
              >
                <input
                  type="text"
                  placeholder="Type a message to Janvi..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={state === "disconnected" || state === "connecting"}
                  className="flex-1 bg-transparent border-none text-white px-4 py-2 text-sm focus:outline-none placeholder:text-white/30 disabled:opacity-50"
                />
                <button 
                  type="submit" 
                  disabled={!chatInput.trim() || state === "disconnected"}
                  className="p-3 bg-rose-500/20 text-rose-400 rounded-full hover:bg-rose-500/40 disabled:opacity-30 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-8 md:mt-12 text-center h-16 flex items-center justify-center">
           <AnimatePresence mode="wait">
            <motion.div
              key={state}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {state === 'disconnected' && (
                <p className="text-sm md:text-xl font-light text-zinc-500 italic max-w-lg">
                  "System asleep. Wake me up when you have something interesting to say."
                </p>
              )}
              {state === 'connecting' && (
                <p className="text-sm md:text-xl font-light text-amber-300/80 italic max-w-lg">
                  "Booting neural pathways... hold your horses."
                </p>
              )}
              {state === 'listening' && (
                <p className="text-sm md:text-xl font-light text-zinc-300 italic max-w-lg">
                  "I'm listening, sugar... say something smart for once."
                </p>
              )}
              {state === 'speaking' && (
                <p className="text-sm md:text-xl font-light text-rose-300 italic max-w-lg">
                  "Shh... I'm talking now."
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full grid grid-cols-2 md:grid-cols-3 items-center z-10">
        <div className="flex flex-col gap-1">
          <div className="flex items-center space-x-2">
            <div className="w-1 h-1 bg-zinc-500 rounded-full"></div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Neural Load: {isConnected ? '42%' : '12%'}</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-1 h-1 bg-zinc-500 rounded-full"></div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Attitude: High Sassy</span>
          </div>
        </div>

        <div className="hidden md:flex justify-center text-[10px] uppercase tracking-[0.2em] text-white/20">
           {/* Empty center, or some decorative element */}
           Core Online
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full shadow-sm">
            <span className="text-[10px] uppercase tracking-widest text-rose-300">Mobile Link: Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
