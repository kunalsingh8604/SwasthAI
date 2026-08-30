/**
 * Demo: connect with .env, insert a user, read it back, then delete the demo doc.
 * Run: node scripts/test-mongodb.mjs
 */
import dns from "node:dns";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

const __dirname = dirname(fileURLToPath(import.meta.url));
const envLine = readFileSync(resolve(__dirname, "../.env"), "utf8")
  .split("\n")
  .find((line) => line.startsWith("MONGODB_URI="));

if (!envLine) {
  console.error("MONGODB_URI not found in .env");
  process.exit(1);
}

const rawUri = envLine.replace(/^MONGODB_URI=/, "").trim();
const publicIp = await fetch("https://api.ipify.org").then((r) => r.text()).catch(() => "unknown");
console.log("Public IP:", publicIp);
console.log("URI host:", rawUri.includes("swasthya-ai.rukmpuv.mongodb.net") ? "swasthya-ai.rukmpuv.mongodb.net" : "(unexpected host)");
console.log("Target DB: swasthya  Collection: users");

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    displayName: String,
    preferredLanguage: { type: String, default: "en" },
  },
  { timestamps: true }
);
const User = mongoose.models.User || mongoose.model("User", UserSchema);

try {
  const parsed = new URL(rawUri.replace("mongodb+srv://", "https://"));
  const srv = await dns.promises.resolveSrv(`_mongodb._tcp.${parsed.hostname}`);
  const hosts = srv.map((r) => `${r.name}:${r.port}`).join(",");
  const user = encodeURIComponent(decodeURIComponent(parsed.username));
  const pass = encodeURIComponent(decodeURIComponent(parsed.password));
  const uri = `mongodb://${user}:${pass}@${hosts}/swasthya?tls=true&authSource=admin&retryWrites=true&w=majority`;

  await mongoose.connect(uri, { dbName: "swasthya", serverSelectionTimeoutMS: 20000, family: 4 });
  console.log("1) CONNECT: OK  database =", mongoose.connection.name);

  const demoEmail = `demo.verify.${Date.now()}@swasthai.local`;
  const created = await User.create({
    email: demoEmail,
    passwordHash: "demo-not-a-real-password",
    displayName: "Atlas Demo",
    preferredLanguage: "en",
  });
  console.log("2) INSERT: OK  _id =", String(created._id), " email =", created.email);

  const found = await User.findOne({ email: demoEmail }).lean();
  if (!found) throw new Error("Insert succeeded but findOne returned nothing");
  console.log("3) READ:   OK  found email =", found.email);

  await User.deleteOne({ _id: created._id });
  const gone = await User.findById(created._id);
  console.log("4) DELETE: OK  leftover =", gone ? "still there" : "none");

  console.log("\nVERIFIED: .env Atlas URI can write and read swasthya.users");
  await mongoose.disconnect();
  process.exit(0);
} catch (error) {
  console.error("\nFAILED:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
