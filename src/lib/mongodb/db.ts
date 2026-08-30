import mongoose from "mongoose";
import dns from "node:dns";
import { getServerEnv } from "@/server/env";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

export const APP_DB_NAME = "swasthya";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache || (global.mongooseCache = { conn: null, promise: null });

function mongodbUri() {
  return getServerEnv("MONGODB_URI") || "mongodb://127.0.0.1:27017/swasthya";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

type SrvHost = { name: string; port: number };

async function resolveSrvLocal(hostname: string): Promise<SrvHost[]> {
  const records = await withTimeout(
    dns.promises.resolveSrv(`_mongodb._tcp.${hostname}`),
    4000,
    "querySrv"
  );
  return records.map((r) => ({ name: r.name.replace(/\.$/, ""), port: r.port }));
}

async function resolveTxtLocal(hostname: string): Promise<string> {
  try {
    const txt = await withTimeout(dns.promises.resolveTxt(hostname), 3000, "queryTxt");
    return txt.flat().join("&");
  } catch {
    return "";
  }
}

/** Windows DNS often fails querySrv; Google/Cloudflare DoH still works (Compass uses its own resolver). */
async function resolveSrvDoh(hostname: string): Promise<SrvHost[]> {
  const name = `_mongodb._tcp.${hostname}`;
  const urls = [
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=SRV`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=SRV`,
  ];

  for (const url of urls) {
    try {
      const res = await withTimeout(
        fetch(url, { headers: { Accept: "application/dns-json" } }),
        6000,
        "DoH SRV"
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { Answer?: { data: string }[] };
      const hosts = (data.Answer || [])
        .map((a) => {
          const parts = a.data.trim().split(/\s+/);
          const port = Number(parts[2]);
          const target = (parts[3] || "").replace(/\.$/, "");
          if (!target || !Number.isFinite(port)) return null;
          return { name: target, port };
        })
        .filter((h): h is SrvHost => !!h);
      if (hosts.length) return hosts;
    } catch {
      /* try next DoH */
    }
  }
  return [];
}

async function resolveTxtDoh(hostname: string): Promise<string> {
  try {
    const res = await withTimeout(
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=TXT`, {
        headers: { Accept: "application/dns-json" },
      }),
      5000,
      "DoH TXT"
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { Answer?: { data: string }[] };
    return (data.Answer || []).map((a) => a.data.replace(/"/g, "")).join("&");
  } catch {
    return "";
  }
}

async function lookupSrv(hostname: string): Promise<SrvHost[]> {
  try {
    const local = await resolveSrvLocal(hostname);
    if (local.length) return local;
  } catch (e) {
    console.warn("Node querySrv failed, using DNS-over-HTTPS:", e instanceof Error ? e.message : e);
  }
  const doh = await resolveSrvDoh(hostname);
  if (!doh.length) {
    throw new Error(
      `querySrv failed for ${hostname}. Compass can still work because it uses its own DNS. Check internet/VPN, or Atlas Network Access (your IP).`
    );
  }
  return doh;
}

async function toDirectUri(uri: string): Promise<string> {
  if (!uri.startsWith("mongodb+srv://")) return uri;

  const parsed = new URL(uri.replace("mongodb+srv://", "https://"));
  const hostname = parsed.hostname;
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);

  const srv = await lookupSrv(hostname);
  const hosts = srv.map((r) => `${r.name}:${r.port}`).join(",");

  let replicaSet = "";
  let authSource = "admin";
  const text = (await resolveTxtLocal(hostname).catch(() => "")) || (await resolveTxtDoh(hostname));
  replicaSet = text.match(/replicaSet=([^&]+)/)?.[1] || "";
  authSource = text.match(/authSource=([^&]+)/)?.[1] || "admin";
  const params = new URLSearchParams({
    tls: "true",
    authSource,
    retryWrites: "true",
    w: "majority",
    appName: parsed.searchParams.get("appName") || "Swasthya-AI",
  });
  if (replicaSet) params.set("replicaSet", replicaSet);

  return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hosts}/${APP_DB_NAME}?${params.toString()}`;
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = (async () => {
      const uri = await toDirectUri(mongodbUri());
      const m = await mongoose.connect(uri, {
        dbName: APP_DB_NAME,
        bufferCommands: false,
        serverSelectionTimeoutMS: 20000,
        socketTimeoutMS: 45000,
        family: 4,
      });
      console.log(`Connected to MongoDB (database: ${APP_DB_NAME})`);
      return m;
    })();
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}
