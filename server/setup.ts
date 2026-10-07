import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import webpush from "web-push"
import { consoleLang, serverMessage } from "./i18n.js"

const envPath = resolve(process.cwd(), ".env")
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : ""
const values = new Map<string, string>()

for (const line of current.split(/\r?\n/)) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) {
    continue
  }
  const separator = trimmed.indexOf("=")
  if (separator > 0) {
    values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1))
  }
}

const generatedKeys = webpush.generateVAPIDKeys()
const defaults: Record<string, string> = {
  APP_ACCESS_TOKEN: randomBytes(32).toString("base64url"),
  APP_HOST: "0.0.0.0",
  APP_PORT: "7171",
  APP_LANG: "",
  APP_LAN_IP: "",
  APP_TLS_CERT_PATH: "",
  APP_TLS_KEY_PATH: "",
  OPENCODE_PROJECT_DIR: ".",
  OPENCODE_SERVER_URL: "",
  VAPID_PUBLIC_KEY: generatedKeys.publicKey,
  VAPID_PRIVATE_KEY: generatedKeys.privateKey,
  VAPID_SUBJECT: "mailto:opencode@localhost",
}

for (const [key, value] of Object.entries(defaults)) {
  if (!values.get(key)) {
    values.set(key, value)
  }
}

const content = [...values.entries()].map(([key, value]) => `${key}=${value}`).join("\n") + "\n"
writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 })

const lang = consoleLang()
console.log(serverMessage("setupCreated", lang).replace("{path}", envPath))
console.log(serverMessage("accessTokenIs", lang).replace("{token}", values.get("APP_ACCESS_TOKEN") || ""))
console.log(serverMessage("httpsNote", lang))
