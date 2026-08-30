import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/useAuth";
import { LanguageProvider } from "@/hooks/useLanguage";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { name: "theme-color", content: "#0f9b8e" },
      { title: "SwasthAI – Your Pocket Public Health Companion" },
      {
        name: "description",
        content:
          "AI-powered symptom checker, prescription scanner, nearby care and health alerts in English & Hindi.",
      },
      { property: "og:title", content: "SwasthAI – Your Pocket Public Health Companion" },
      {
        property: "og:description",
        content: "Voice-first AI triage, prescription scanning and nearby healthcare in English & Hindi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "SwasthAI – Your Pocket Public Health Companion" },
      { name: "description", content: "Health Companion AI analyzes symptoms via voice or text to classify severity and suggest next steps." },
      { property: "og:description", content: "Health Companion AI analyzes symptoms via voice or text to classify severity and suggest next steps." },
      { name: "twitter:description", content: "Health Companion AI analyzes symptoms via voice or text to classify severity and suggest next steps." },
      { property: "og:image", content: "/logo.png" },
      { name: "twitter:image", content: "/logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/logo.png" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <Outlet />
        <Toaster position="top-center" />
      </AuthProvider>
    </LanguageProvider>
  );
}
