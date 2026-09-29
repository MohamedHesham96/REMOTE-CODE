# AGENTS.md — RemoteCode

اقرأ ده قبل أي تعديل. القواعد مستخرجة من الكود الفعلي — لو فيه قاعدة غلط، عدّلها في نفس الـ commit.

## المشروع

واجهة ويب للموبايل للتحدث مع OpenCode من جوه نفس شبكة Wi-Fi. باختصار:
- **سيرفر Express** thin proxy على OpenCode + تخزين المثبّتات + Web Push + بثّ SSE.
- **عميل React 19 SPA** — لا router ولا مكتبة حالة، CSS في ملف واحد.
- **OpenCode هو مصدر الحقيقة** — السيرفر يبدأه محليًا على `127.0.0.1` ويتصل بيه.

## الستاك

| | |
|---|---|
| العميل | React 19.3, Vite 8, TypeScript 5.9, CSS عادي في `src/styles.css` |
| السيرفر | Express 5.2, Node ESM (`module: NodeNext`), يُصرَّف بـ `tsc` |
| الاختبارات | Vitest 4 — بيئة Node، **مش** jsdom |
| الـ SDK | `@opencode/client` مثبّت **pinned** على `2.0.18` (عميل v2 + `Service.ensure()` للخدمة المحلية) |
| Push | `web-push` 3.6.7 |

مفيش أي runtime dependency تانية. **متضيفش package جديد من غير سؤال** — الموجود يكفي لأي شغل UI.

## أمر التحقق الوحيد

```powershell
npm run check   # lint + typecheck + test + build
```

لازم يبقى أخضر قبل ما تقول "خلص". لو فشل من سبب مش ليك علاقة، قول السبب صراحةً ومت claiming النجاح.

## تقسيم الـ TypeScript — اتبعه

| | `tsconfig.app.json` | `tsconfig.server.json` |
|---|---|---|
| الملفات | `src` + `vite/vitest.config.ts` | `server/**/*.ts` |
| resolution | `Bundler` | `NodeNext` |
| globals | `browser` | `node` |
| `noUncheckedIndexedAccess` | لأ | أيوه |
| output | `noEmit` | `dist-server/` |

نقطتين ليهم أثر يومي:
1. **`noUncheckedIndexedAccess` مفعّط في السيرفر بس** — يعني `list[i]` نوعه `T | undefined`. لازم guard قبل الاستخدام. لو لقيت نفسك بتعمل casts عشان تتخطى ده، ارجع للـ guard.
2. **`npm run typecheck` بيشغّل الـ tsconfig اتنين** — ملف في `src` مش هيت نوعش مع قواعد السيرفر والعكس.

## شكل الكود

- **بدون semicolons** في آخر السطور. الاستثناء الوحيد `src/i18n.ts` و `server/i18n.ts` — سيبهم زي ما هم، **متعملش reformat**، ومتضيفش semicolons في ملف جديد.
- double quotes، مسافة بادئة 2.
- **named exports فقط.** `export default` موجود في `vite.config.ts` و `vitest.config.ts` و `src/App.tsx:2034` بس. ملف جديد = named exports.
- `import type` للـ types. على السيرفر **لازم** `.js` على الـ relative imports (`from "../i18n.js"`) — NodeNext ESM. على العميل **من غير** امتداد (`from "../api/pins"`).
- return type صريح على أي function مُصدَّرة.
- `interface` للـ object types، `type` للـ unions.

## التعليقات — دي مش optional

تعليقات المشروع **بالعربية الفصحى** (من غير لهجة عامية)، وبتشرح **ليه** مش **إيه**. مثال الأسلوب من `server/routes/pins.ts`:

```ts
// المثبّتات على السيرفر عشان تكون مشتركة بين كل الأجهزة. كل التغييرات متطبّقة
// على السيرفر (تثبيت/إزالة/مسح) ومفيش استبدال كامل — الدمج بيضيف الجديد
// فوق الموجود، فجهازين ما يخسروش تحديث بعض.
```

القاعدة: لو الكود فيه **قرار** اتخد (ليه merge مش replace، ليه حاجز المزامنة، ليه `no-transform` على SSE) — سيب الكود يشرحه. لو الكود بيشرح نفسه، متكتبش تعليق.

## Architecture — قواعد ملزمة

### السيرفر
1. **`server/index.ts` = composition root فقط.** إنشاء الخدمات وحقنها في `RouteContext` وربط المسارات. ممنوع منطق routes أو SSE أو اتصال هنا.
2. **كل route file يصدّر `registerXRoutes(app, ctx: RouteContext)`** ويجيب كل اعتماده من `ctx` — ممنوع يستورد من route تاني.
3. **ترتيب التركيب مقصود** (`server/index.ts:75`): public (health/login/logout) → `requireAuthentication` على `/api` → `readinessGate()` → الباقي. أي route محتاج توثيق لازم يروح **قبل** `requireAuthentication`، واللي محتاج OpenCode شغال **بعد** `readinessGate()`.
4. **عقد الخطأ ثابت:** `{ error: "SCREAMING_SNAKE", message: <مترجم> }`. الأكواد الموجودة: `UNAUTHORIZED`, `INVALID_PIN`, `INVALID_PIN_IDS`, `SERVER_ERROR`, `BACKEND_STARTING`. الكود الثابت مقروء بالبرمجة — **متترجمش**. في الحالة الأخيرة: `ctx.connection.handleError(error, response, request)`.

### العميل
5. **`src/api/*.ts` = wrappers typed فوق `request()` في `src/api/http.ts`.** كل GET بيتلغى تكراره تلقائيًا. أي function جديدة في `src/api/` لازم تُعاد تصديرها من `src/api/index.ts`.
6. **السيرفر مصدر حقيقة، الـ localStorage كاش عرض بس.** النمط: تعديل optimistic محلي → نداء السيرفر → السيرفر يبثّ لـ SSE → باقي الأجهزة. استخدم `createPinSyncGate()` (`src/utils/pin-sync.ts`) لو عدّلت التثبيتات. **مفيش poll كبديل بثّ**، و`refresh` على `visibilitychange`/`focus` هو backup لا أكثر.
7. **اللوحة الجديدة:** الملف في `src/panels/` → named export في `src/panels/index.ts` → `lazy` في `App.tsx:66` بنفس النمط بالظبط:
   ```ts
   const XPanel = lazy(() => import("./panels").then((module) => ({ default: module.XPanel })))
   ```
   مستحيل default export هنا. و`src/panels.tsx` يفضل shim إعادة تصدير — سيبه كده عشان التحميل الكسول ما يتكسرش.

### i18n — مكرّرة في مكانين
8. أي نص للمستخدم لازم يتبعت في **الاتنين**: `src/i18n.ts` (`ar` + `en`, و`Strings = typeof ar`) و `server/i18n.ts` (`messages`, مستخدَمة بـ `serverMessage(key, lang)`). **`npm run typecheck` هيفشل لو ضفت مفتاح في `ar` ناقص في `en`** — ده مقصود. اللغتين بس، فصحى + إنجليزي، **ولا لهجة عامية**. على السيرفر: `getServerLang(request)` بيقرأ `?lang=` ثم body ثم `Accept-Language` ثم العربية.

## الأمان — خطوط حمراء

- **`.env` ما يتقراش، ما يتطبعش، ما يتـ commitش أبدًا.** فيه `APP_ACCESS_TOKEN` و VAPID private key. `.env.example` هو الوحيد المسموح تلمسه.
- **`APP_ACCESS_TOKEN` 24 حرف على الأقل** (بيتـ validate في `server/config.ts`). متبعّدهاش لضعف.
- **`opencode serve` ماتعرضهاش على الشبكة أبدًا.** التطبيق بيشغّله على `127.0.0.1` بس. `APP_HOST=0.0.0.0` ده الباك إند بس.
- مقارنة التوكن بـ `timingSafeEqual` (`server/auth.ts`) — متستبدلهاش بـ `===`.
- `VAPID_*` و `APP_TLS_*` لازم يتظبّطوا **أزواج** (config بيرمي لو واحد بس). سيب الـ validation زي ما هي.
- **ماتفتحش `securityHeaders` (`server/middleware/security.ts`)** — `X-Frame-Options: DENY` و `nosniff` مقصودين.
- غير `APP_ACCESS_TOKEN`؟ كل الأجهزة هتخرج. قول للمستخدم قبل ما تعمله.

## إعدادات Vite — لا تلمسها

`vite.config.ts` فيه إعدادات شيلها بتكسّر الموبايل على LAN:
- `host: "0.0.0.0"` + `allowedHosts: true` — الموبايل بيفتح بـ IP مش hostname
- `hmr.clientPort: 5173` — من غيره المتصفح بيرجع لـ `localhost` والتحديث الفوري بيموت
- `sourcemap: false` — كانت ~1.2MB تُحمّل مع كل تحميل
- `manualChunks` vendor لـ React

## الاختبارات

- جنب المصدر: `foo.ts` → `foo.test.ts`. **مفيش `__tests__/` ولا `tests/`.**
- اختبار الـ routes = **HTTP حقيقي على بورت 0**، مش سوبرفيس. أنشئ express app، `server.listen(0, "127.0.0.1")`، وادعِ `registerXRoutes`، وامسح الـ temp dir في `afterEach`. شوف `server/routes/pins.test.ts` كنموذج — بيغطي البثّ الحي كمان.
- الـ client tests بـ vitest على الدوال البحتة في `src/utils/`.
- `vitest.config.ts` بيستثني `dist-server/**` — لو ضفت test file جديد متنساش الاستثناء، وإلا هيتشغّل مرتين.
- `ctx` المزيف في الاختبارات: `{ ... } as unknown as RouteContext` — ده النمط المقصود، مش كسل.

## Commits

Conventional Commits، **بالإنجليزي، بدون نقطة في الآخر**:

```
feat: add task message copy buttons and refresh conversation cards
refactor: drop pinned row tint and mark pins with a red pin button
fix: <what broke>
```

- lowercase، Imperfative mood، **سطر واحد**.
- change منطقي واحد في الـ commit. `feat` لـ feature، `refactor` لـ تنظيف بلا تغيير سلوك، `fix` لـ bug.
- **branch لكل feature**، والـ branch مش محتاجة تكون perfect.
- **ماتفتحش PR ولا تـ commit من غير طلب صريح** — اسأل الأول.

## Gotchas

- قاعدة المحرك v2 مشتركة مع تطبيق الديسكتوب (`~/.local/share/opencode/opencode.db`) — نفس الجلسات في المكانين دون عزل أو استيراد. `server/index.ts` لا يضبط `OPENCODE_DB` إطلاقًا. الخدمة المحلية تُدار عبر `Service.ensure()` من `@opencode/client/service` (تثبيت الإصدار `2.`) بدل توليد `opencode serve` يدويًا، فلا `OPENCODE_PORT` ولا مصادقة أساسية. الاستثناء الوحيد: على Windows التشغيل عبر `server/opencode/service-launch.ts` — اكتشاف صامت أولًا، ثم تشغيل مخفي (`windowsHide` على ملف `.exe` مباشرة) لأن `spawn("opencode")` الافتراضي يفشل (`ENOENT` مع شيم `.cmd`) ولو نجح لفتح نافذة PowerShell جديدة. v2 بلا `project.current` (الاختيار حالة محلية فقط في `OpenCodeService`)، وبلا `session.status` (الحالة من `session.active()` + الأحداث)، وبلا todos أو أسئلة v1 (استُبدلت باستمارات `session.form.*` وأذونات `permission.*`). أسماء أحداث SSE على السلك (`question.asked`، `permission.updated`، `message.part.updated`…) ثابتة منذ v1 — الترجمة في `server/sse/filter.ts` فقط، فالواجهة لا تتغير مع تبديل المحرك. نفس البوابة (`isListableProjectDirectory` في `server/opencode/utils.ts`) ترشّح قائمة `/api/project` كلها.
- `src/App.tsx` = **2063 سطر**، `server/opencode.ts` = **1776**. معروفين. **ماتزوّدهمش** — استخرج الجزء الجديد لملف مستقل يسجّل في الـ barrel المناسب.
- `server/i18n.ts` بيستخدم semicolons والملف التاني لأ — **استثناء تاريخي مقصود**، سيبه.
- `@opencode/client` pinned بالظبط. أي bump = مراجعة breaking changes من الـ release notes، مش تخمين.
- `express.json({ limit: "2mb" })` — طلبات أكبر بترمي 413. لو feature محتاج رفع ملفات، ده السقف الحالي.
- `compression` موجود لـ gzip على شبكات Wi-Fi الضعيفة. `/api/events` عليه `no-transform` — متشيلش ولا تغيّره.
- `data/` gitignored وبيخزّن `pins.json` — حالته محلية. متقتارشش.
- **الاختبارات في `server/` بتبقى compiled جوه `dist-server/`** — لو شفت test بيشتغل مرتين، دي السبب.

## عند الشك

1. `git log --oneline -15` — إزاي الكود بيتكتب فعلاً
2. `npm run check` — بصرّح
3. اقرأ الكود نفسه. **متفترضش حاجة من الكود اللي ماتقراش.**
