import { spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { Service, type Endpoint } from "@opencode/client/service"
import { consoleLang, serverMessage } from "../i18n.js"

// تشغيل الخدمة المحلية بصمت على Windows: اكتشاف أولًا، وتشغيل مخفي
// عند الحاجة، وترك `Service.ensure()` كملاذ أخير فقط.
// السبب: أمر `opencode` على Windows شيم `opencode.cmd` لا يعمل مع
// `spawn` بدون shell (يفشل بـ ENOENT)، ولو نجح التشغيل المرئي لفتح
// نافذة PowerShell جديدة مع كل إقلاع — وهذا ما لا نريده. التشغيل هنا
// يستهدف ملف `.exe` مباشرة مع `windowsHide` فلا تظهر أي نافذة.
// الخدمة مشتركة مع تطبيق الديسكتوب (نفس `service.json`)، فإعادة
// استخدامها أولى دائمًا من تشغيل نسخة ثانية، ولا نوقفها أبدًا عند
// إغلاق السيرفر.

export function isCompatibleVersion(version: string): boolean {
  return version.startsWith("2.")
}

// نفس مسار التسجيل الافتراضي في الـ SDK، حتى نرى ما يراه `ensure`.
export function registrationFilePath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const base = env.XDG_STATE_HOME?.trim() || join(home, ".local", "state")
  return join(base, "opencode", "service.json")
}

interface ServiceRegistration {
  pid?: unknown
}

function registeredPid(file: string): number | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ServiceRegistration
    if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) {
      return parsed.pid
    }
  } catch {
    // ملف ناقص أو تالف = لا خدمة مسجلة
  }
  return undefined
}

// العملية المسجلة ما زالت حية؟ ملف قديم لعملية ميتة يعامل كأنه مفقود،
// أما المسجل الحي (حتى لو إصداره مختلف) فيترك لمنطق الاستبدال في الـ SDK.
export function isRegisteredServiceAlive(file: string = registrationFilePath()): boolean {
  const pid = registeredPid(file)
  if (pid === undefined) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// نسخة الديسكتوب المجمّعة تطابق إصدار العميل المثبّت غالبًا، فهي أولى
// من النسخة العامة — تشغيل نفس الإصدار يجنّب استبدال خدمة الديسكتوب.
function desktopCliBinary(appData: string): string | undefined {
  const cliDirectory = join(appData, "ai.opencode.desktop", "cli")
  let entries: string[]
  try {
    entries = readdirSync(cliDirectory)
  } catch {
    return undefined
  }
  const latest = entries.filter((name) => name.startsWith("2.")).sort().reverse()[0]
  if (!latest) {
    return undefined
  }
  const binary = join(cliDirectory, latest, "opencode-cli.exe")
  return existsSync(binary) ? binary : undefined
}

// مرشحات التنفيذ المباشر على Windows فقط — على Unix يتولى الـ SDK التشغيل
// بنفسه دون أي نافذة، فلا حاجة لمسار مخصص.
export function candidateBinaries(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  if (process.platform !== "win32") {
    return []
  }
  const appData = env.APPDATA?.trim() || join(home, "AppData", "Roaming")
  const explicit = env.OPENCODE_BIN?.trim()
  const desktop = desktopCliBinary(appData)
  return [
    ...(explicit ? [explicit] : []),
    ...(desktop ? [desktop] : []),
    join(appData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
  ]
}

export function resolveOpencodeBinary(candidates: string[] = candidateBinaries()): string | undefined {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

// اكتشاف صامت: لا يشغّل أي عملية ولا يفتح أي نافذة.
async function discoverLocalEndpoint(): Promise<Endpoint | undefined> {
  try {
    return await Service.discover({ version: isCompatibleVersion })
  } catch {
    return undefined
  }
}

// تشغيل مخفي تمامًا: منفصل عن السيرفر، بلا stdio، وبلا نافذة على Windows.
// الفشل يصل عبر حدث `error` لا عبر throw، فسجّله هنا ولا ترمه.
export function spawnHiddenService(binary: string): void {
  try {
    const child = spawn(binary, ["serve", "--service"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", (cause: unknown) => {
      console.error(serverMessage("serviceLaunchFailed", consoleLang()), cause instanceof Error ? cause.message : cause)
    })
    child.unref()
  } catch (error) {
    console.error(serverMessage("serviceLaunchFailed", consoleLang()), error instanceof Error ? error.message : error)
  }
}

async function waitForLocalEndpoint(timeoutMs = 30_000): Promise<Endpoint | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const endpoint = await discoverLocalEndpoint()
    if (endpoint) {
      return endpoint
    }
    await sleep(250)
  }
  return discoverLocalEndpoint()
}

// المسار الكامل: موجودة؟ استخدمها. مفقودة على Windows؟ شغّلها مخفيًا.
// غير ذلك (إصدار مختلف أو خدمة عالقة) فوضه للـ SDK الذي يعرف الاستبدال
// مع تسليم الجلسات الطرفية.
export async function ensureLocalEndpoint(): Promise<Endpoint> {
  const discovered = await discoverLocalEndpoint()
  if (discovered) {
    return discovered
  }
  if (process.platform === "win32" && !isRegisteredServiceAlive()) {
    const binary = resolveOpencodeBinary()
    if (binary) {
      spawnHiddenService(binary)
      const started = await waitForLocalEndpoint()
      if (started) {
        return started
      }
    }
  }
  return Service.ensure({ version: isCompatibleVersion })
}
