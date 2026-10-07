#!/usr/bin/env node
// يتحقق أن شهادة PEM تغطي كل عناوين IP المعروضة للمشغّل:
//   0 = كلها مغطاة، 1 = بعضها ناقص فيحتاج المشغّل تجديد الشهادة،
//   2 = تعذّر الفحص (ملف تالف أو غير مقروء) — المشغّل يتعامل مع النتيجة 2
//       كأنها «غير معروفة» فيترك الشهادة كما هي، فلا يخاطر بحذف شهادة سليمة
//       بسبب قراءة فاشلة.
import { X509Certificate } from "node:crypto"
import { readFileSync } from "node:fs"

const [file, ...addresses] = process.argv.slice(2)

try {
  const certificate = new X509Certificate(readFileSync(file))
  const entries = new Set(certificate.subjectAltName ? certificate.subjectAltName.split(", ") : [])
  const missing = addresses.some((address) => !entries.has(`IP Address:${address}`))
  process.exit(missing ? 1 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
