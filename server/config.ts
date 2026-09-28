import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

const envPath = resolve(process.cwd(), ".env")

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    const separator = trimmed.indexOf("=")
    if (separator <= 0) {
      continue
    }
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function integer(name: string, fallback: number): number {
  const value = process.env[name]?.trim()

  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid environment variable: ${name}`)
  }

  return parsed
}

function optionalPath(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? resolve(process.cwd(), value) : undefined
}

const projectDirectory = resolve(process.cwd(), process.env.OPENCODE_PROJECT_DIR?.trim() || ".")

if (!existsSync(projectDirectory) || !statSync(projectDirectory).isDirectory()) {
  throw new Error(`OpenCode project directory does not exist: ${projectDirectory}`)
}

const accessToken = required("APP_ACCESS_TOKEN")

if (accessToken.length < 24) {
  throw new Error("APP_ACCESS_TOKEN must contain at least 24 characters")
}

const tlsCertificatePath = optionalPath("APP_TLS_CERT_PATH")
const tlsPrivateKeyPath = optionalPath("APP_TLS_KEY_PATH")

if ((tlsCertificatePath && !tlsPrivateKeyPath) || (!tlsCertificatePath && tlsPrivateKeyPath)) {
  throw new Error("APP_TLS_CERT_PATH and APP_TLS_KEY_PATH must be configured together")
}

export const config = {
  accessToken,
  host: process.env.APP_HOST?.trim() || "0.0.0.0",
  port: integer("APP_PORT", 7171),
  tlsCertificatePath,
  tlsPrivateKeyPath,
  openCode: {
    projectDirectory,
    serverUrl: process.env.OPENCODE_SERVER_URL?.trim(),
    username: process.env.OPENCODE_SERVER_USERNAME?.trim() || "opencode",
    password: process.env.OPENCODE_SERVER_PASSWORD?.trim(),
    port: integer("OPENCODE_PORT", 4196),
  },
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim(),
    privateKey: process.env.VAPID_PRIVATE_KEY?.trim(),
    subject: process.env.VAPID_SUBJECT?.trim() || "mailto:opencode@localhost",
  },
} as const

if ((config.push.publicKey && !config.push.privateKey) || (!config.push.publicKey && config.push.privateKey)) {
  throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together")
}
