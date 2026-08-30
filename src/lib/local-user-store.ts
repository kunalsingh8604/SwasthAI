import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LocalUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  preferredLanguage: string;
  createdAt: string;
};

const dataDir = path.join(process.cwd(), ".data");
const usersPath = path.join(dataDir, "users.json");

function readUsers(): LocalUser[] {
  try {
    return JSON.parse(fs.readFileSync(usersPath, "utf8")) as LocalUser[];
  } catch {
    return [];
  }
}

function writeUsers(users: LocalUser[]) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), "utf8");
}

export function findLocalUserByEmail(email: string) {
  return readUsers().find((u) => u.email === email.toLowerCase()) ?? null;
}

export function findLocalUserById(id: string) {
  return readUsers().find((u) => u.id === id) ?? null;
}

export function createLocalUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
  preferredLanguage: string;
}): LocalUser {
  const users = readUsers();
  const user: LocalUser = {
    id: randomUUID(),
    email: input.email.toLowerCase(),
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    preferredLanguage: input.preferredLanguage,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  return user;
}
