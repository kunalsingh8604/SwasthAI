# SwasthAI (Swasthya AI)

**SwasthAI** is a bilingual (English / Hindi) health companion for everyday users. It helps people describe symptoms, understand a prescription photo, find nearby care on an OpenStreetMap, and keep simple health records — with a clear reminder that it is **not a replacement for a doctor**.

The app is built with **TanStack Start**, **React**, **Vite**, **MongoDB Atlas**, and **Groq** for AI.

---

## Features

| Area | What it does |
| --- | --- |
| **Symptom Checker** | Chat about symptoms (text or voice). Optional **camera / gallery** photo of a physical symptom (skin, rash, etc.). AI gives a simple explanation and a **mild / moderate / emergency** card. |
| **Find nearby care** | After triage, open the **map** already filtered for hospitals, clinics, doctors, or pharmacies for that concern. |
| **Prescription Scan** | Upload or capture a prescription photo. AI explains medicines in plain language (no Latin shorthand). |
| **Nearby Care** | Leaflet + OpenStreetMap map. Overpass search for hospitals, clinics, pharmacies, and doctors. GPS, city search, filters, and in-app driving directions (OSRM). |
| **Health Hub** | Extra services entry point (reminders, women’s health, and related tools). |
| **Reminders** | In-app medication / reminder UI (demo-style local flow). |
| **Women’s Health** | Period tracker and related guidance (saved data needs a signed-in account). |
| **Alerts** | Public-health style alerts and copy. |
| **History** | Saved symptom reports and scans for the logged-in user (MongoDB). |
| **Swasthya Agent** | Longer-form health chat using the same Groq text model. |
| **Auth** | Sign up / sign in. Passwords are stored as **bcrypt hashes** only (`passwordHash`), never as plain text. |

Language can be switched between English and Hindi in the header.

---

## Tech stack

- **UI:** React 19, TanStack Router / Start, Tailwind CSS, Radix UI, Lucide icons  
- **AI:** Groq Chat Completions API (text + vision)  
- **Maps:** Leaflet, OpenStreetMap tiles, Overpass API, Nominatim, OSRM (no Google Maps key)  
- **Data:** MongoDB Atlas (`swasthya` database), Mongoose, JWT sessions  
- **Tooling:** Vite 7, TypeScript, ESLint, Prettier  

---

## Prerequisites

- **Node.js** 20+ (recommended)  
- **npm**  
- A **Groq API key** from [console.groq.com/keys](https://console.groq.com/keys)  
- A **MongoDB Atlas** cluster (or local MongoDB)  
- Atlas **Network Access** must allow your current IP (or `0.0.0.0/0` while developing)

---

## Setup

1. Clone or unzip the project and install dependencies:

```bash
cd Astra-main
npm install
```

2. Create a `.env` file in the project root (do **not** commit this file):

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@YOUR-CLUSTER.mongodb.net/swasthya?retryWrites=true&w=majority&appName=Swasthya-AI
JWT_SECRET=replace_with_a_long_random_string

GROQ_API_KEY=gsk_your_groq_key
```

Optional model overrides (defaults are already set in code):

```env
GROQ_TEXT_MODEL=openai/gpt-oss-20b
GROQ_VISION_MODEL=qwen/qwen3.6-27b
```

3. Start the dev server:

```bash
npm run dev
```

Open **http://localhost:8080** (or the port Vite prints). Use **localhost**, not the LAN IP, if you need browser GPS — geolocation is blocked on insecure network URLs.

### Production / Render (Node.js)

This project builds with **Nitro** (`node-server` preset), not Cloudflare Workers.

```bash
npm run build
npm run start
# equivalent: node .output/server/index.mjs
```

The production server listens on **`process.env.PORT`** (or `3000`). On Render, set:

| Setting | Value |
| --- | --- |
| Build command | `npm install && npm run build` |
| Start command | `npm run start` |
| Node version | **22.12+** (see `engines` in `package.json`) |

Env vars: `MONGODB_URI`, `JWT_SECRET`, `GROQ_API_KEY`.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run test:db` | Quick MongoDB connection check |

---

## Project layout

```
src/
  routes/                 # Pages: home, auth, check, scan, nearby, …
  components/             # Shell, map, UI primitives
  server/functions/       # Auth, AI, reports (server functions)
  lib/                    # MongoDB, healthcare places (OSM), i18n, triage
```

Accounts are written to Atlas database **`swasthya`**, collection **`users`**. Symptom reports and prescription scans use the same database. In Compass, open **`swasthya`**, not sample databases such as `sample_mflix`.

---

## How AI is used

- **Text** (symptom chat, agent, triage after a photo): `openai/gpt-oss-20b` (fallback `openai/gpt-oss-120b`).  
- **Vision** (symptom photo, prescription photo): `qwen/qwen3.6-27b` (fallback `qwen/qwen3.8-27b`).  

Groq sometimes returns **503 over capacity** or is slow on vision models. The app retries a fallback model and shows a message in chat if the photo AI is busy. Wait a short time and send the photo again.

On some Windows machines, `mongodb+srv://` fails with `querySrv ETIMEOUT`. The server resolves Atlas hosts via DNS-over-HTTPS so Node can connect even when Compass already works.

---

## Medical disclaimer

SwasthAI is an **educational assistant**. It does not diagnose, prescribe, or replace a qualified clinician. For emergencies, go to a hospital or call local emergency services immediately.

---

## License

Private student / project repository. Add a license file if you intend to distribute the code.
