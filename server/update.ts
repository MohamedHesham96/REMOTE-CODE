import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { withTimeout } from "./opencode/utils.js"

// مصدر التحديث هو مستودع المشروع على GitHub: نقرأ نسخة `package.json` من
// الفرع الرئيسي ونقارنها بالنسخة المحلية. المصدر ده يعمل حتى قبل وجود أي وسم
// إصدار أو صفحة Releases، ولو الشبكة أو المستودع غير متاحين يفشل الفحص بصمت.
const FALLBACK_REPOSITORY = "MohamedHesham96/REMOTE-CODE"
const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000
// فشل الفحص يتخزن لمدة أقصر من النجاح: لا يضرب الشبكة مع كل فتح صفحة، وفي
// الوقت نفسه يعيد المحاولة من نفسه عندما يرجع الاتصال.
const UPDATE_RETRY_MS = 15 * 60 * 1000
const UPDATE_TIMEOUT_MS = 8000

export interface UpdateRelease {
  title: string
  body: string
  url: string
  publishedAt: string | null
}

export interface UpdateInfo {
  currentVersion: string
  // null عندما يفشل الفحص أو تكون النسخة البعيدة غير صالحة — وقتها لا تنبيه
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  releaseNotes: UpdateRelease | null
  checkedAt: number
}

// تحويل النسخة لأرقام: يقبل "v1.8.1" و"1.8" و"2.10.3"، ويرفض أي نص غير رقمي.
// الشرائح المفقودة تعامل كصفر وقت المقارنة، والمقارنة تتم رقمًا رقمًا عشان
// 2.10.0 تسبق 2.9.0 بدل المقارنة النصية اللي بتغلط فيها.
export function parseVersion(value: string | null | undefined): number[] | null {
  const clean = (value || "").trim().replace(/^v/i, "")
  if (!clean) {
    return null
  }
  const core = clean.split(/[-+]/)[0] ?? ""
  const parts = core.split(".")
  if (parts.length === 0) {
    return null
  }
  const numbers: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null
    }
    numbers.push(Number.parseInt(part, 10))
  }
  return numbers
}

// 1 يعني يسار أحدث، -1 العكس، 0 تساوٍ، وnull لو إحدى النسختين غير صالحة.
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) {
    return null
  }
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1
}

// نسخة التطبيق الحالية من package.json. الفشل يرجّع نصًا فاضيًا (وليس استثناء)
// عشان فحص التحديث ما يمنعش الإقلاع ولا ينتج تنبيهًا كاذبًا.
export function readPackageVersion(directory: string = process.cwd()): string {
  try {
    const raw = readFileSync(resolve(directory, "package.json"), "utf8")
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === "string" ? parsed.version.trim() : ""
  } catch {
    return ""
  }
}

// "owner/repo" من عنوان remote المعتاد (https أو git@). أي مضيف غير GitHub
// يرجّع null فيستخدم المستودع الاحتياطي.
export function repositoryFromRemoteUrl(value: string): string | null {
  const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/i.exec((value || "").trim())
  return match ? `${match[1]}/${match[2]}` : null
}

// اكتشاف المستودع من remote الأصل يخلّي النسخ المشتقة (forks) تفحص مستودعها
// هي. يشغل مرة واحدة لكل عمر سيرفر وبيرجع للاحتياطي عند أي فشل.
export async function detectRepository(directory: string = process.cwd()): Promise<string> {
  try {
    const output = await new Promise<string>((resolvePromise, reject) => {
      execFile("git", ["remote", "get-url", "origin"], { cwd: directory, timeout: 3000, windowsHide: true }, (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise(stdout)
      })
    })
    return repositoryFromRemoteUrl(output) ?? FALLBACK_REPOSITORY
  } catch {
    return FALLBACK_REPOSITORY
  }
}

export interface UpdateServiceOptions {
  currentVersion: string
  // يُمرَّر صريحًا في الاختبارات عشان ما نشغّلش git ولا نعتمد على المستودع الفعلي
  repository?: string
  directory?: string
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export class UpdateService {
  private readonly currentVersion: string
  private readonly directory: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly explicitRepository: string | null
  private repositoryPromise: Promise<string> | null = null
  private cache: { expiresAt: number; value: UpdateInfo } | null = null
  // إلغاء تكرار الفحوص المتزامنة: كل الأجهزة والتبويبات تشارك فحصًا واحدًا
  private inflight: Promise<UpdateInfo> | null = null

  constructor(options: UpdateServiceOptions) {
    this.currentVersion = options.currentVersion.trim()
    this.directory = options.directory ?? process.cwd()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.timeoutMs = options.timeoutMs ?? UPDATE_TIMEOUT_MS
    this.explicitRepository = options.repository?.trim() || null
  }

  async check(): Promise<UpdateInfo> {
    const now = this.now()
    const cached = this.cache
    if (cached && cached.expiresAt > now) {
      return cached.value
    }
    if (this.inflight) {
      return this.inflight
    }
    const task = this.refresh(now).finally(() => {
      if (this.inflight === task) {
        this.inflight = null
      }
    })
    this.inflight = task
    return task
  }

  private repositoryName(): Promise<string> {
    if (this.explicitRepository) {
      return Promise.resolve(this.explicitRepository)
    }
    if (!this.repositoryPromise) {
      this.repositoryPromise = detectRepository(this.directory)
    }
    return this.repositoryPromise
  }

  private request(url: string): Promise<Response> {
    return withTimeout(
      this.fetchImpl(url, { headers: { accept: "application/json", "user-agent": "RemoteCode" } }),
      this.timeoutMs,
      "update check",
    )
  }

  // أي فشل شبكة/تحليل يتحول لنتيجة "لا يوجد تحديث" مع إعادة محاولة لاحقة —
  // المستخدم ما يشوفش خطأ ولا يتعطّل أي شيء.
  private async refresh(now: number): Promise<UpdateInfo> {
    try {
      const repository = await this.repositoryName()
      const response = await this.request(`https://raw.githubusercontent.com/${repository}/main/package.json`)
      if (!response.ok) {
        throw new Error(`update source responded ${response.status}`)
      }
      const payload = await response.json() as { version?: unknown }
      const latestVersion = typeof payload.version === "string" ? payload.version.trim() : ""
      const updateAvailable = isNewerVersion(latestVersion, this.currentVersion)
      let releaseUrl: string | null = `https://github.com/${repository}/releases`
      let releaseNotes: UpdateRelease | null = null
      if (updateAvailable) {
        releaseNotes = await this.fetchReleaseNotes(repository, latestVersion)
        if (releaseNotes) {
          releaseUrl = releaseNotes.url
        }
      }
      const value: UpdateInfo = {
        currentVersion: this.currentVersion,
        latestVersion: latestVersion || null,
        updateAvailable,
        releaseUrl,
        releaseNotes,
        checkedAt: now,
      }
      this.cache = { expiresAt: now + UPDATE_CACHE_MS, value }
      return value
    } catch {
      const value: UpdateInfo = {
        currentVersion: this.currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseNotes: null,
        checkedAt: now,
      }
      this.cache = { expiresAt: now + UPDATE_RETRY_MS, value }
      return value
    }
  }

  // ملاحظات الإصدار من GitHub Releases (اختياري، بلا فشل صاخب). تُقبل فقط لو
  // وسم الإصدار مطابق للنسخة البعيدة؛ غير كده ممكن نعرض ملاحظات إصدار آخر.
  private async fetchReleaseNotes(repository: string, version: string): Promise<UpdateRelease | null> {
    try {
      const response = await this.request(`https://api.github.com/repos/${repository}/releases/latest`)
      if (!response.ok) {
        return null
      }
      const payload = await response.json() as {
        tag_name?: unknown
        name?: unknown
        body?: unknown
        html_url?: unknown
        published_at?: unknown
      }
      const tag = typeof payload.tag_name === "string" ? payload.tag_name : ""
      if (compareVersions(tag, version) !== 0) {
        return null
      }
      if (typeof payload.html_url !== "string" || !payload.html_url) {
        return null
      }
      return {
        title: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : version,
        body: typeof payload.body === "string" ? payload.body.trim() : "",
        url: payload.html_url,
        publishedAt: typeof payload.published_at === "string" ? payload.published_at : null,
      }
    } catch {
      return null
    }
  }
}
