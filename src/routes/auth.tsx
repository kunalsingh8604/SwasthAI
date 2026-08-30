import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, FormEvent } from "react";
import { z } from "zod";
import { signInFn, signUpFn } from "@/server/functions/auth";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MobileShell } from "@/components/MobileShell";
import { toast } from "sonner";
import { Heart } from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => ({ redirect: (s.redirect as string) || "/" }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
});

function AuthPage() {
  const nav = useNavigate();
  const search = Route.useSearch();
  const { user, setAuth } = useAuth();
  const { lang } = useLanguage();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) nav({ to: search.redirect as any });
  }, [user, nav, search.redirect]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const res = await signUpFn({
          data: {
            email,
            password,
            preferredLanguage: lang,
          },
        });
        setAuth(res.user, res.token);
        toast.success("Account created. You're signed in.");
      } else {
        const res = await signInFn({
          data: {
            email,
            password,
          },
        });
        setAuth(res.user, res.token);
        toast.success("Welcome back!");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <MobileShell hideNav>
      <Card className="mt-6 rounded-3xl border-0 bg-card p-6 shadow-lg">
        <div className="mb-5 flex flex-col items-center text-center">
          <img src="/logo.png" alt="SwasthAI" className="h-16 w-16 rounded-2xl object-contain shadow-md" />
          <h1 className="mt-3 text-xl font-bold">{t("appName", lang)}</h1>
          <p className="text-xs text-muted-foreground">{t("tagline", lang)}</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">{t("email", lang)}</label>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 h-12 rounded-xl"
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">{t("password", lang)}</label>
            <Input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-12 rounded-xl"
              minLength={6}
              required
            />
          </div>
          <Button type="submit" disabled={loading} className="h-12 w-full rounded-xl text-base font-semibold">
            {loading ? "…" : mode === "signup" ? t("signUp", lang) : t("signIn", lang)}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 w-full text-center text-sm text-trust hover:underline"
        >
          {mode === "signin"
            ? lang === "hi"
              ? "नया खाता बनाएँ"
              : "Don't have an account? Sign up"
            : lang === "hi"
            ? "पहले से खाता है? साइन इन"
            : "Already have an account? Sign in"}
        </button>
      </Card>
    </MobileShell>
  );
}
