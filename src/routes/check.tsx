import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { MobileShell } from "@/components/MobileShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { useAuth } from "@/hooks/useAuth";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { triageAiFn, visualSymptomAiFn } from "@/server/functions/ai";
import { saveSymptomReportFn } from "@/server/functions/reports";
import { useSpeechRecognition, speak, speakSlow, repeatLast, stopSpeaking } from "@/hooks/useSpeech";
import { defaultCareType, type TriageResult } from "@/lib/triage-care";
import { FILTER_META } from "@/lib/healthcare-places";
import {
  Mic,
  Send,
  Square,
  AlertTriangle,
  Clock,
  Sparkles,
  Save,
  RefreshCw,
  Volume2,
  Repeat,
  Type,
  Turtle,
  VolumeX,
  Camera,
  ImagePlus,
  X,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { compressImageFile } from "@/lib/compress-image";

export const Route = createFileRoute("/check")({
  component: () => (
    <RequireAuth redirect="/check">
      <SymptomCheck />
    </RequireAuth>
  ),
});

type Msg = { role: "user" | "assistant"; content: string; imageUrl?: string };
type Triage = TriageResult;

function SymptomCheck() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [triage, setTriage] = useState<Triage | null>(null);
  const [largeText, setLargeText] = useState(false);
  const speech = useSpeechRecognition(lang);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messages.length === 0) {
      const greet =
        lang === "hi"
          ? "नमस्ते! मुझे बताइए — आपको क्या तकलीफ़ है? चाहें तो लक्षण की फोटो भी भेज सकते हैं।"
          : "Hello! Please tell me — what symptoms are you feeling? You can also send a photo of a physical symptom.";
      setMessages([{ role: "assistant", content: greet }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, triage, loading, pendingImage]);

  useEffect(() => {
    if (speech.transcript) setInput(speech.transcript);
  }, [speech.transcript]);

  const onPickImage = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error(lang === "hi" ? "फोटो बहुत बड़ी है (अधिकतम 8MB)" : "Image too large (max 8MB)");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(lang === "hi" ? "कृपया एक फोटो चुनें" : "Please choose an image");
      return;
    }
    try {
      const dataUrl = await compressImageFile(file);
      setPendingImage(dataUrl);
    } catch {
      toast.error(lang === "hi" ? "फोटो पढ़ नहीं सके" : "Could not read that photo");
    }
  };

  const applyAiResult = (data: { triage?: unknown; assistant?: string }) => {
    const assistant = typeof data.assistant === "string" ? data.assistant.trim() : "";
    if (assistant) {
      setMessages((m) => [...m, { role: "assistant", content: assistant }]);
      speak(assistant, lang);
    }

    if (data.triage && typeof data.triage === "object") {
      const raw = data.triage as Partial<TriageResult> & {
        severity: TriageResult["severity"];
        summary: string;
        advice: string;
      };
      if (raw.severity && raw.summary && raw.advice) {
        const next: TriageResult = {
          severity: raw.severity,
          summary: raw.summary,
          advice: raw.advice,
          red_flags: raw.red_flags,
          condition_label: raw.condition_label || raw.summary.slice(0, 80),
          care_type: raw.care_type || defaultCareType(raw.severity),
        };
        setTriage(next);
      }
    } else if (!assistant) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            lang === "hi"
              ? "जवाब नहीं मिला। कृपया फोटो दोबारा भेजें।"
              : "No answer came back. Please send the photo again.",
        },
      ]);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (loading) return;
    if (!text && !pendingImage) return;

    stopSpeaking();
    const attachedNow = pendingImage;
    const userContent =
      text ||
      (lang === "hi" ? "यह मेरे शारीरिक लक्षण की फोटो है।" : "Here is a photo of my physical symptom.");

    const userMsg: Msg = {
      role: "user",
      content: userContent,
      ...(attachedNow ? { imageUrl: attachedNow } : {}),
    };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setPendingImage(null);
    speech.setTranscript("");
    setLoading(true);

    try {
      if (attachedNow) {
        const data = await visualSymptomAiFn({
          data: { imageBase64: attachedNow, note: text || undefined, language: lang },
        });
        applyAiResult(data);
      } else {
        const data = await triageAiFn({
          data: {
            messages: newMsgs.map(({ role, content }) => ({ role, content })),
            language: lang,
          },
        });
        applyAiResult(data);
      }
    } catch (e: any) {
      const msg = e.message ?? "Could not reach the AI. Please try again.";
      toast.error(msg);
      setMessages((m) => [...m, { role: "assistant", content: msg }]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    stopSpeaking();
    setMessages([]);
    setTriage(null);
    setInput("");
    setPendingImage(null);
  };

  const save = async () => {
    if (!triage || !token) return;
    const symptoms = messages
      .filter((m) => m.role === "user")
      .map((m) => (m.imageUrl ? `[photo] ${m.content}` : m.content))
      .join(" | ");
    try {
      await saveSymptomReportFn({
        data: {
          token,
          symptoms,
          severity: triage.severity,
          advice: triage.advice,
          conversation: messages.map(({ role, content }) => ({ role, content })),
          language: lang,
        },
      });
      toast.success(lang === "hi" ? "रिपोर्ट सहेज ली गई" : "Report saved");
    } catch (error: any) {
      toast.error(error.message || "Failed to save report");
    }
  };

  const canSend = !loading && (!!input.trim() || !!pendingImage);

  return (
    <MobileShell>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t("symptomChecker", lang)}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant={largeText ? "default" : "outline"}
            size="sm"
            onClick={() => setLargeText((v) => !v)}
            aria-pressed={largeText}
            aria-label={t("largeText", lang)}
          >
            <Type className="mr-1 h-4 w-4" />
            {largeText ? t("normalText", lang) : t("largeText", lang)}
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RefreshCw className="mr-1 h-4 w-4" />
            {t("newCheck", lang)}
          </Button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          className="h-12 rounded-2xl"
          onClick={() => {
            const last = [...messages].reverse().find((m) => m.role === "assistant");
            if (last) speakSlow(last.content, lang);
          }}
          aria-label={t("slow", lang)}
        >
          <Turtle className="mr-1 h-5 w-5" /> {t("slow", lang)}
        </Button>
        <Button
          variant="secondary"
          className="h-12 rounded-2xl"
          onClick={() => repeatLast()}
          aria-label={t("repeat", lang)}
        >
          <Repeat className="mr-1 h-5 w-5" /> {t("repeat", lang)}
        </Button>
        <Button
          variant="outline"
          className="h-12 rounded-2xl"
          onClick={() => stopSpeaking()}
          aria-label={t("stop", lang)}
        >
          <VolumeX className="mr-1 h-5 w-5" /> {t("stop", lang)}
        </Button>
      </div>

      <Card className="mx-auto flex h-[70vh] max-w-4xl flex-col rounded-3xl border bg-card/50 p-4 shadow-xl backdrop-blur-sm md:p-6 lg:h-[75vh]">
        <div ref={scrollRef} className="custom-scrollbar flex-1 space-y-4 overflow-y-auto pr-2">
          {messages.map((m, i) => (
            <Bubble key={i} msg={m} lang={lang} largeText={largeText} />
          ))}
          {loading && (
            <div className={cn("flex items-center gap-3 text-muted-foreground", largeText ? "text-lg" : "text-sm")}>
              <Sparkles className="h-4 w-4 animate-pulse text-primary" />
              {[...messages].reverse().find((m) => m.role === "user")?.imageUrl
                ? lang === "hi"
                  ? "फोटो देख रहा हूँ…"
                  : "Looking at your photo…"
                : lang === "hi"
                  ? "सोच रहा हूँ…"
                  : "Thinking…"}
            </div>
          )}
          {triage && <TriageCard triage={triage} lang={lang} onSave={save} largeText={largeText} />}
        </div>
      </Card>

      <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-3">
        {pendingImage && (
          <div className="flex items-center gap-3 rounded-2xl border bg-secondary/40 p-2 pl-3">
            <img
              src={pendingImage}
              alt={t("photoSymptom", lang)}
              className="h-16 w-16 rounded-xl object-cover ring-1 ring-border"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("photoSymptom", lang)}</p>
              <p className="text-xs text-muted-foreground">
                {lang === "hi"
                  ? "वैकल्पिक: नीचे लिखें कि कहाँ दर्द है या कब से है।"
                  : "Optional: type where it hurts or how long it has been there."}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 shrink-0 rounded-xl"
              onClick={() => setPendingImage(null)}
              aria-label={t("removePhoto", lang)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickImage(f);
            e.target.value = "";
          }}
        />
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickImage(f);
            e.target.value = "";
          }}
        />

        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            type="button"
            size="icon"
            variant={speech.listening ? "destructive" : "secondary"}
            className="h-14 w-14 shrink-0 rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95"
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            disabled={!speech.supported}
            aria-label={t("speak", lang)}
          >
            {speech.listening ? <Square className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant={pendingImage ? "default" : "secondary"}
            className="h-14 w-14 shrink-0 rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95"
            onClick={() => camRef.current?.click()}
            disabled={loading}
            aria-label={t("camera", lang)}
            title={t("camera", lang)}
          >
            <Camera className="h-6 w-6" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-14 w-14 shrink-0 rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            aria-label={t("addPhoto", lang)}
            title={t("addPhoto", lang)}
          >
            <ImagePlus className="h-6 w-6" />
          </Button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSend && send()}
            placeholder={
              speech.listening
                ? t("listening", lang)
                : pendingImage
                  ? lang === "hi"
                    ? "फोटो के बारे में लिखें (वैकल्पिक)…"
                    : "Add a note about the photo (optional)…"
                  : t("describe", lang)
            }
            className="h-14 flex-1 rounded-2xl border-2 px-4 text-base shadow-inner transition-colors focus:border-primary sm:px-6 sm:text-lg"
          />
          <Button
            type="button"
            size="icon"
            className="h-14 w-14 shrink-0 rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95"
            onClick={() => send()}
            disabled={!canSend}
            aria-label={t("send", lang)}
          >
            <Send className="h-6 w-6" />
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">{t("disclaimer", lang)}</p>
      </div>
    </MobileShell>
  );
}

function Bubble({ msg, lang, largeText }: { msg: Msg; lang: "en" | "hi"; largeText?: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 leading-relaxed shadow-sm",
          largeText ? "text-lg" : "text-sm",
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-secondary text-secondary-foreground"
        )}
      >
        {msg.imageUrl && (
          <img
            src={msg.imageUrl}
            alt={t("photoSymptom", lang)}
            className="mb-2 max-h-48 w-full rounded-xl object-cover ring-1 ring-black/10"
          />
        )}
        {msg.content}
        {!isUser && (
          <button
            onClick={() => speak(msg.content, lang)}
            className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
            aria-label="Listen"
          >
            <Volume2 className={cn("inline", largeText ? "h-5 w-5" : "h-3.5 w-3.5")} />
          </button>
        )}
      </div>
    </div>
  );
}

function TriageCard({
  triage,
  lang,
  onSave,
  largeText,
}: {
  triage: Triage;
  lang: "en" | "hi";
  onSave: () => void;
  largeText?: boolean;
}) {
  const cfg = {
    emergency: {
      bg: "bg-emergency text-emergency-foreground",
      ring: "ring-emergency",
      icon: AlertTriangle,
      label: t("emergency", lang),
      emoji: "🔴",
    },
    moderate: {
      bg: "bg-moderate text-moderate-foreground",
      ring: "ring-moderate",
      icon: Clock,
      label: t("moderate", lang),
      emoji: "🟠",
    },
    mild: {
      bg: "bg-mild text-mild-foreground",
      ring: "ring-mild",
      icon: Sparkles,
      label: t("mild", lang),
      emoji: "🟢",
    },
  }[triage.severity];

  const Icon = cfg.icon;
  const careMeta = FILTER_META[triage.care_type];
  const careLabel = lang === "hi" ? careMeta.hi : careMeta.en;

  return (
    <div className={cn("mt-3 rounded-2xl border-2 p-4 ring-2 ring-offset-2", cfg.ring)}>
      <div className={cn("mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold", cfg.bg)}>
        <Icon className="h-4 w-4" /> {cfg.emoji} {cfg.label}
      </div>
      <p className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", largeText && "text-sm")}>
        {lang === "hi" ? "संभावित चिंता" : "Possible concern"}
      </p>
      <p className={cn("font-semibold leading-relaxed", largeText ? "text-lg" : "text-sm")}>
        {triage.condition_label}
      </p>
      <p className={cn("mt-2 leading-relaxed text-foreground", largeText ? "text-lg" : "text-sm")}>{triage.summary}</p>
      <p className={cn("mt-2 leading-relaxed text-foreground", largeText ? "text-lg" : "text-sm")}>{triage.advice}</p>
      {triage.red_flags && triage.red_flags.length > 0 && (
        <ul className={cn("mt-3 space-y-1 rounded-xl bg-muted/60 p-3", largeText ? "text-base" : "text-xs")}>
          {triage.red_flags.map((r, i) => (
            <li key={i} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-emergency" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button asChild className="flex-1 rounded-xl">
          <Link
            to="/nearby"
            search={{
              type: triage.care_type,
              condition: triage.condition_label,
              emergency: triage.severity === "emergency" ? "1" : undefined,
            }}
          >
            <MapPin className="mr-2 h-4 w-4" />
            {lang === "hi"
              ? `नक्शे पर नज़दीकी ${careLabel} देखें`
              : `Find nearby ${careLabel.toLowerCase()} on map`}
          </Link>
        </Button>
        <Button onClick={onSave} variant="secondary" className="flex-1 rounded-xl">
          <Save className="mr-2 h-4 w-4" /> {t("saveReport", lang)}
        </Button>
      </div>
    </div>
  );
}
