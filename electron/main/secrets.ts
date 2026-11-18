import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "./fs-utils.js";
import { getAppPaths } from "./paths.js";

interface EncryptedEntry {
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
}

interface SecretsStore {
  version: 1;
  secrets: Record<string, EncryptedEntry>;
}

const EMPTY_STORE: SecretsStore = {
  version: 1,
  secrets: {}
};

async function getOrCreateMasterKey(): Promise<Buffer> {
  const { masterKeyFile } = getAppPaths();
  if (await pathExists(masterKeyFile)) {
    const raw = (await fs.readFile(masterKeyFile, "utf8")).trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) {
      return key;
    }
  }
  await ensureDir(path.dirname(masterKeyFile));
  const key = crypto.randomBytes(32);
  await fs.writeFile(masterKeyFile, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
  return key;
}

export async function upsertProfileSecret(profileId: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  const key = await getOrCreateMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const { secretsFile } = getAppPaths();
  const store = await readJsonFile<SecretsStore>(secretsFile, EMPTY_STORE);
  store.secrets[profileId] = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    updatedAt: new Date().toISOString()
  };
  await writeJsonFile(secretsFile, store);
}

export async function getProfileSecret(profileId: string): Promise<string | null> {
  const { secretsFile } = getAppPaths();
  const store = await readJsonFile<SecretsStore>(secretsFile, EMPTY_STORE);
  const entry = store.secrets[profileId];
  if (!entry) {
    return null;
  }
  try {
    const key = await getOrCreateMasterKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(entry.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(entry.ciphertext, "base64")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

export async function deleteProfileSecret(profileId: string): Promise<void> {
  const { secretsFile } = getAppPaths();
  if (!(await pathExists(secretsFile))) {
    return;
  }
  const store = await readJsonFile<SecretsStore>(secretsFile, EMPTY_STORE);
  if (profileId in store.secrets) {
    delete store.secrets[profileId];
    await writeJsonFile(secretsFile, store);
  }
}
