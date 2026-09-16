import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  Clipboard,
  LoaderCircle,
  Mic,
  Plus,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Engine = "gemini" | "groq";
type Session = {
  id: string;
  createdAt: string;
  duration: number;
  transcript: string;
  notes: string;
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const HISTORY_KEY = "smork-history-v1";
const SETTINGS_KEY = "smork-settings-v1";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smork — Record less. Remember more." },
      { name: "description", content: "Record lectures and meetings, then turn them into clear AI transcripts and Smart Notes." },
      { property: "og:title", content: "Smork — Record less. Remember more." },
      { property: "og:description", content: "Record lectures and meetings, then turn them into clear AI transcripts and Smart Notes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Smork,
});

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}


const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
const GEMINI_NOTES_MODEL = "gemini-3.6-flash";
const NOTES_PROMPT = `You are turning a raw recording transcript into clean, structured notes.

Keep only what the main speaker actually taught, explained or decided. Remove background chatter, side conversations, small talk and off-topic tangents.

Format in Markdown: a short title, clear section headers and bullet points. Keep the speaker's own terminology. Never invent details.

If the recording sounds like a meeting, end with an "Action Items" section listing each item with its owner when mentioned.

Transcript:
`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  onRetry: (busy: boolean) => void,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status !== 503 && response.status !== 429) {
      onRetry(false);
      return response;
    }
    lastResponse = response;
    if (attempt === 3) break;
    onRetry(true);
    await delay(1000 * 2 ** attempt);
  }
  onRetry(false);
  return lastResponse as Response;
}

function extractText(payload: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === "text" && typeof child === "string") parts.push(child);
        else walk(child);
      }
    }
  };
  walk(payload);
  return parts.join("\n").trim();
}

async function uploadAudioToGemini(blob: Blob, apiKey: string, onRetry: (busy: boolean) => void) {
  const mimeType = blob.type || "audio/webm";
  const startResponse = await fetchWithRetry("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(blob.size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "smork-recording" } }),
  }, onRetry);
  if (!startResponse.ok) {
    const detail = await startResponse.text();
    throw new Error(`Could not start the audio upload. ${detail.slice(0, 200)}`);
  }
  const uploadUrl = startResponse.headers.get("x-goog-upload-url") ?? startResponse.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini did not return an upload location for the audio.");

  const uploadResponse = await fetchWithRetry(uploadUrl, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Length": String(blob.size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: blob,
  }, onRetry);
  const uploadPayload = await uploadResponse.json() as { error?: { message?: string }; file?: { uri?: string; mimeType?: string } };
  if (!uploadResponse.ok || !uploadPayload.file?.uri) {
    throw new Error(uploadPayload.error?.message || "Uploading the recording to Gemini failed.");
  }
  return { fileUri: uploadPayload.file.uri, mimeType: uploadPayload.file.mimeType || mimeType };
}

async function processWithGemini(blob: Blob, apiKey: string, onRetry: (busy: boolean) => void) {
  const { fileUri, mimeType } = await uploadAudioToGemini(blob, apiKey, onRetry);

  const transcriptResponse = await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMINI_TRANSCRIBE_MODEL,
      input: [
        {
          role: "user",
          parts: [
            { fileData: { mimeType, fileUri } },
            { text: "Transcribe this audio accurately and completely. Return the transcript text only." },
          ],
        },
      ],
    }),
  }, onRetry);
  const transcriptPayload = await transcriptResponse.json() as { error?: { message?: string } };
  if (!transcriptResponse.ok) throw new Error(transcriptPayload.error?.message || "Gemini could not transcribe this recording.");
  const transcript = extractText(transcriptPayload);
  if (!transcript) throw new Error("Gemini returned an empty transcript.");

  const notesResponse = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_NOTES_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${NOTES_PROMPT}${transcript}` }] }],
    }),
  }, onRetry);
  const notesPayload = await notesResponse.json() as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  if (!notesResponse.ok) throw new Error(notesPayload.error?.message || "Gemini could not create notes.");
  const notes = notesPayload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  return { transcript, notes: notes || "No notes were generated." };
}


async function processWithGroq(blob: Blob, apiKey: string) {
  const form = new FormData();
  form.append("file", blob, `smork-recording.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");
  const transcriptResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const transcriptPayload = await transcriptResponse.json() as { text?: string; error?: { message?: string } };
  if (!transcriptResponse.ok) throw new Error(transcriptPayload.error?.message || "Groq could not transcribe this recording.");
  const transcript = transcriptPayload.text?.trim() ?? "";
  const notesResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Create concise, useful meeting or lecture notes in Markdown. Start with a short title, then key points, decisions, and action items when present. Never invent details." },
        { role: "user", content: transcript },
      ],
    }),
  });
  const notesPayload = await notesResponse.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!notesResponse.ok) throw new Error(notesPayload.error?.message || "Groq could not create notes.");
  return { transcript, notes: notesPayload.choices?.[0]?.message?.content?.trim() || "No notes were generated." };
}

function Smork() {
  const [engine, setEngine] = useState<Engine>("gemini");
  const [keys, setKeys] = useState<Record<Engine, string>>({ gemini: "", groq: "" });
  const [history, setHistory] = useState<Session[]>([]);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [busyRetry, setBusyRetry] = useState(false);

  const [seconds, setSeconds] = useState(0);
  const [liveCaption, setLiveCaption] = useState("");
  const [current, setCurrent] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"notes" | "transcript" | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const secondsRef = useRef(0);

  useEffect(() => {
    try {
      const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as { engine?: Engine; keys?: Record<Engine, string> };
      if (savedSettings.engine) setEngine(savedSettings.engine);
      if (savedSettings.keys) setKeys(savedSettings.keys);
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as Session[]);
    } catch { /* Ignore malformed local data. */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ engine, keys }));
  }, [engine, keys]);

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [recording]);

  const saveHistory = (next: Session[]) => {
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  const newSession = () => {
    if (recording) return;
    setCurrent(null);
    setSeconds(0);
    secondsRef.current = 0;
    setLiveCaption("");
    setError("");
  };

  const startRecording = async () => {
    setError("");
    if (!keys[engine].trim()) {
      setError(`Add your ${engine === "gemini" ? "Gemini" : "Groq"} API key in Settings first.`);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      setCurrent(null);
      setSeconds(0);
      secondsRef.current = 0;
      setLiveCaption("");
      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType: preferred });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => void finishRecording(new Blob(chunksRef.current, { type: preferred }));
      recorder.start();
      setRecording(true);

      const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
          let text = "";
          for (let i = 0; i < event.results.length; i += 1) text += `${event.results[i]?.[0]?.transcript ?? ""} `;
          setLiveCaption(text.trim());
        };
        recognition.onerror = () => {};
        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch {
      setError("Microphone access is needed to record. Check your browser permission and try again.");
    }
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    setProcessing(true);
  };

  const finishRecording = async (blob: Blob) => {
    if (blob.size < 2048) {
      setProcessing(false);
      setError("That recording was empty. Please try again.");
      return;
    }
    try {
      const result = engine === "gemini"
        ? await processWithGemini(blob, keys.gemini, setBusyRetry)
        : await processWithGroq(blob, keys.groq);
      const session: Session = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        duration: secondsRef.current,
        transcript: result.transcript,
        notes: result.notes,
      };
      setCurrent(session);
      saveHistory([session, ...history].slice(0, 50));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong while processing the recording.");
    } finally {
      setProcessing(false);
      setBusyRetry(false);
    }
  };

  const copyText = async (kind: "notes" | "transcript", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold">Smork<span className="text-primary">.</span></h1>
            <p className="mt-1 text-sm text-muted-foreground">Record less. Remember more.</p>
          </div>
          <button className="icon-button" onClick={newSession} disabled={recording} aria-label="Start a new session" title="New session">
            <Plus size={18} /><span>New</span>
          </button>
        </header>

        <details className="settings-panel group mt-8">
          <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><Settings2 size={15} /> Settings</span>
            <ChevronDown className="transition-transform group-open:rotate-180" size={16} />
          </summary>
          <div className="grid gap-4 border-t border-border py-5 sm:grid-cols-2">
            <label className="field-label">AI engine
              <select value={engine} onChange={(event) => setEngine(event.target.value as Engine)} className="field-control">
                <option value="gemini">Gemini</option><option value="groq">Groq</option>
              </select>
            </label>
            <label className="field-label">{engine === "gemini" ? "Gemini" : "Groq"} API key
              <input type="password" value={keys[engine]} onChange={(event) => setKeys({ ...keys, [engine]: event.target.value })} placeholder="Paste API key" className="field-control" autoComplete="off" />
            </label>
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">Saved only in this browser. Your recording is sent directly to your selected AI engine.</p>
          </div>
        </details>

        {!current && (
          <section className="flex min-h-[460px] flex-col items-center justify-center py-12 text-center sm:min-h-[520px]">
            <div className={`record-ring ${recording ? "is-recording" : ""}`}>
              <button className="record-button" onClick={recording ? stopRecording : startRecording} disabled={processing} aria-label={recording ? "Stop recording" : "Start recording"}>
                {processing ? <LoaderCircle className="animate-spin" size={30} /> : recording ? <Square fill="currentColor" size={26} /> : <Mic size={31} />}
              </button>
            </div>
            <p className="mt-7 font-display text-4xl tabular-nums tracking-normal">{formatTime(seconds)}</p>
            <p className="mt-2 text-sm text-muted-foreground">{processing ? "Creating your Smart Notes…" : recording ? "Recording — tap to stop" : "Tap to start recording"}</p>
            {recording && (
              <div className="mt-10 w-full max-w-xl text-left">
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Live preview</p>
                <div className="live-preview">{liveCaption || "Listening… rough captions will appear here."}</div>
              </div>
            )}
            {error && <div role="alert" className="error-message">{error}</div>}
          </section>
        )}

        {current && (
          <section className="mt-10 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div><p className="section-kicker">Smart Notes</p><p className="mt-1 text-sm text-muted-foreground">{new Date(current.createdAt).toLocaleString()} · {formatTime(current.duration)}</p></div>
            </div>
            <article className="notes-card">
              <button className="copy-button" onClick={() => copyText("notes", current.notes)} aria-label="Copy Smart Notes" title="Copy Smart Notes">
                {copied === "notes" ? <Check size={17} /> : <Clipboard size={17} />}
              </button>
              <div className="notes-content">{current.notes}</div>
            </article>
            <details className="transcript-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
                <div><h2 className="font-medium">Transcript</h2><p className="mt-1 text-xs text-muted-foreground">Accurate source text</p></div>
                <ChevronDown className="transition-transform group-open:rotate-180" size={18} />
              </summary>
              <div className="relative border-t border-border p-5 pr-14">
                <button className="copy-button top-4" onClick={() => copyText("transcript", current.transcript)} aria-label="Copy transcript" title="Copy transcript">
                  {copied === "transcript" ? <Check size={17} /> : <Clipboard size={17} />}
                </button>
                <p className="whitespace-pre-wrap text-sm leading-7 text-secondary-foreground">{current.transcript}</p>
              </div>
            </details>
            {error && <div role="alert" className="error-message">{error}</div>}
          </section>
        )}

        <section className="mt-14 border-t border-border pt-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">History</h2>
            {history.length > 0 && <button className="text-button" onClick={() => saveHistory([])}>Clear all</button>}
          </div>
          {history.length === 0 ? <p className="py-10 text-sm text-muted-foreground">Your past recordings will appear here.</p> : (
            <div className="mt-4 divide-y divide-border">
              {history.map((session) => (
                <div className="history-row" key={session.id}>
                  <button className="min-w-0 flex-1 py-4 text-left" onClick={() => { setCurrent(session); setSeconds(session.duration); secondsRef.current = session.duration; window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <span className="block text-sm font-medium">{new Date(session.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">{session.notes.replace(/[#*_]/g, "").slice(0, 100)}</span>
                  </button>
                  <button className="delete-button" onClick={() => saveHistory(history.filter((item) => item.id !== session.id))} aria-label="Delete session" title="Delete session"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
