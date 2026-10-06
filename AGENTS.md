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

قائمة الاعتماديات كاملة في `package.json` ومقصودة كده. **متضيفش package جديد من غير سؤال** — الموجود يكفي لأي شغل UI.

## أمر التحقق الوحيد

```powershell
npm run check   # lint + typecheck + test + build
```

لازم يبقى أخضر قبل ما تقول "خلص". لو فشل من سبب مش ليك علاقة، قول السبب صراحةً ومتقولش إنه نجح.

## تقسيم الـ TypeScript — اتبعه

| | `tsconfig.app.json` | `tsconfig.server.json` |
|---|---|---|
| الملفات | `src` + `vite.config.ts` + `vitest.config.ts` | `server/**/*.ts` |
| resolution | `Bundler` | `NodeNext` |
| globals | `browser` | `node` |
| `noUncheckedIndexedAccess` | لأ | أيوه |
| output | `noEmit` | `dist-server/` |

نقطتين ليهم أثر يومي:
1. **`noUncheckedIndexedAccess` مفعّط في السيرفر بس** — يعني `list[i]` نوعه `T | undefined`. لازم guard قبل الاستخدام. لو لقيت نفسك بتعمل casts عشان تتخطى ده، ارجع للـ guard.
2. **`npm run typecheck` بيشغّل الـ tsconfig الاتنين** — فملف في `src` مش بيتفحص بقواعد السيرفر والعكس.

## شكل الكود

- **بدون semicolons** في آخر السطور. الاستثناء الوحيد `src/i18n.ts` و `server/i18n.ts` — سيبهم زي ما هم، **متعملش reformat**، ومتضيفش semicolons في ملف جديد.
- double quotes، مسافة بادئة 2.
- **named exports فقط.** `export default` موجود في `vite.config.ts` و `vitest.config.ts` و `src/App.tsx` بس. ملف جديد = named exports.
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
2. **كل route file يصدّر `registerXRoutes(app, ctx: RouteContext)`** ويجيب كل اعتماده من `ctx` — ممنوع يستورد من route تاني (استثناء واحد: `registerCertificateRoutes(app)` مش محتاج `ctx`).
3. **ترتيب التركيب مقصود** (`server/index.ts:101`): public (health/login/logout) → `requireAuthentication` على `/api` → `readinessGate()` → الباقي. أي route عام لازم يروح **قبل** `requireAuthentication`. والـ route اللي مالوش علاقة بالمحرك لازم يروح **قبل** `readinessGate()` (زي الشهادة) أو يتضاف لاستثناءاته (زي المثبّتات وpush)، وإلا هيرجّع 503 وهو واقع. واللي محتاج OpenCode فعلًا **بعد** `readinessGate()`.
4. **عقد الخطأ ثابت:** `{ error: "SCREAMING_SNAKE", message: <مترجم> }`. الكود الثابت مقروء بالبرمجة — **متترجمش**؛ الرسالة هي المترجمة. أمثلة: `UNAUTHORIZED`, `INVALID_PIN`, `INVALID_MODEL_PIN`, `MODEL_PINS_FULL`, `OPENCODE_UNAVAILABLE` (بوابة الجهوزية، 503). أي خطأ غير متوقع: `ctx.connection.handleError(error, response, request)`.

### العميل
5. **`src/api/*.ts` = wrappers typed فوق `request()` في `src/api/http.ts`.** كل GET بيتلغى تكراره تلقائيًا. أي function جديدة في `src/api/` لازم تُعاد تصديرها من `src/api/index.ts`، و`src/api.ts` shim إعادة تصدير — سيبه عشان الاستيرادات الحالية من `./api` ما تتكسرش.
6. **السيرفر مصدر حقيقة، الـ localStorage كاش عرض بس.** النمط: تعديل optimistic محلي → نداء السيرفر → السيرفر يبثّ لـ SSE → باقي الأجهزة. النموذجان المرجعيان: `usePinnedConversations` (مثبّتات المحادثات، لكل مشروع، قناة `pins`) و`usePinnedModels` (مثبّتات النماذج، عالمية، قناة `modelPins`) — الاتنين على `createPinSyncGate()` (`src/utils/pin-sync.ts`). **مفيش poll كبديل بثّ**، و`refresh` على `visibilitychange`/`focus` هو backup لا أكثر.
7. **اللوحة الجديدة:** الملف في `src/panels/` → named export في `src/panels/index.ts` → `lazy` في `App.tsx:72` بنفس النمط بالظبط:
   ```ts
   const XPanel = lazy(() => import("./panels").then((module) => ({ default: module.XPanel })))
   ```
   مستحيل default export هنا. و`src/panels.tsx` يفضل shim إعادة تصدير — سيبه كده عشان التحميل الكسول ما يتكسرش.

### منتقي النماذج — أداء ومزامنة
8. **البحث بفهرس جاهز، مش فلترة ثقيلة مع كل حرف.** `buildModelCatalog()` (`src/utils/model-search.ts`) بيبني النص المصغّر والترتيب وخريطة المفاتيح **مرة واحدة** لكل كتالوج، والفلترة بتبقى `includes` على نصوص جاهزة، والنتايج بتتحدّث بـ `useDeferredValue` (الكتابة عاجلة والرندر مؤجّل). ممنوع `toLowerCase`/`localeCompare` في مسار كل ضغطة (بره بناء الفهرس).
9. **سقف المثبّتات 5 في مكانين:** `PINNED_MODELS_LIMIT` (`src/constants.ts`) و`MAX_PINNED_MODELS` (`server/model-pins.ts`) — غيّر الاتنين مع بعض. السيرفر بيرفض السادس بدل ما يقتطع تثبيت جهاز تاني.
10. **مستوى التفكير (variant) بيتبع آخر موديل اتضغط عليه في القائمة** — حالة `focus` محلية بتتحرك فورًا من غير انتظار الشبكة، وبعد تأكيد السيرفر قيمته هي المرجع. الهدف: القائمة ما تفضلش معروضة على مستويات الموديل القديم بعد اختيار موديل جديد.

### i18n — مكرّرة في مكانين
11. **نظامان مترجَمان منفصلان بنفس الشكل:** نصوص الواجهة في `src/i18n.ts` (`ar` + `en`، و`Strings = typeof ar`)، ورسائل السيرفر في `server/i18n.ts` (`messages` + `serverMessage(key, lang)`). ماتكرّرش النص في الملفين — كل ملف للجهة اللي بتعرضه، وفي الحالتين لازم يكون بالعربية والإنجليزية. **`npm run typecheck` هيفشل لو ضفت مفتاح في `ar` ناقص في `en`** — ده مقصود. اللغتين بس، فصحى + إنجليزي، **ولا لهجة عامية**. على السيرفر: `getServerLang(request)` بيقرأ `?lang=` ثم body ثم `Accept-Language` ثم العربية.

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
- الـ client tests بـ vitest على الدوال البحتة (أغلبها في `src/utils/`، وفيه اختبارات في جذر `src/` زي `api.test.ts`).
- `vitest.config.ts` بيستثني `dist-server/**` لأن `tsc` بيصرّف نسخة من ملفات اختبار السيرفر جواه. الاستثناء شامل، فأي test file جديد بيتغطّى تلقائيًا.
- `ctx` المزيف في الاختبارات: `{ ... } as unknown as RouteContext` — ده النمط المقصود، مش كسل.

## Commits

Conventional Commits، **بالإنجليزي، بدون نقطة في الآخر**:

```
feat: add task message copy buttons and refresh conversation cards
refactor: drop pinned row tint and mark pins with a red pin button
fix: <what broke>
```

- lowercase، imperative mood، **سطر واحد**.
- change منطقي واحد في الـ commit. `feat` لـ feature، `refactor` لـ تنظيف بلا تغيير سلوك، `fix` لـ bug.
- **branch لكل feature**، والـ branch مش محتاجة تكون perfect.
- **ماتفتحش PR ولا تـ commit من غير طلب صريح** — اسأل الأول.

## الريليز نوت

ملف `src/releases-data.ts` ثابت ومُراجَع بشريًا، وبيتعرض للمستخدم في لوحة الإصدارات.

- **المهم بس**: إمكانيات جديدة للمستخدم، وإصلاحات محسوسة، وتغييرات سلوكية.
- **متضيفش**: refactor داخلي، ولا تجميل شكلي بحت (أيقونة، توهّج، ترتيب شارات)، ولا كوميتات إضافة الريليز نوت نفسها، ولا merges. لو التغيير مش هيفرق لحاجة المستخدم لاحظها — مكانه الـ commit log مش هنا.
- الإدخال الجديد يتجمّع بإدخال واحد (features/improvements/fixes/performance/uiux/technical)، وباللغتين معًا، والعنوان فريد داخل الإصدار، والترتيب من الأحدث للأقدم — `src/releases.test.ts` بيتحقق من ده كله.
- المصدر الخام من `node scripts/generate-releases.mjs`، وتراجع وتُفلتر قبل الإضافة.

## Gotchas

- قاعدة المحرك v2 مشتركة مع تطبيق الديسكتوب (`~/.local/share/opencode/opencode.db`) — نفس الجلسات في المكانين دون عزل أو استيراد. `server/index.ts` لا يضبط `OPENCODE_DB` إطلاقًا. الخدمة المحلية تُدار عبر `Service.ensure()` من `@opencode/client/service` (تثبيت الإصدار `2.`) بدل توليد `opencode serve` يدويًا، فلا `OPENCODE_PORT` ولا مصادقة أساسية. الاستثناء الوحيد: على Windows التشغيل عبر `server/opencode/service-launch.ts` — اكتشاف صامت أولًا، ثم تشغيل مخفي (`windowsHide` على ملف `.exe` مباشرة) لأن `spawn("opencode")` الافتراضي يفشل (`ENOENT` مع شيم `.cmd`) ولو نجح لفتح نافذة PowerShell جديدة. v2 بلا `project.current` (الاختيار حالة محلية فقط في `OpenCodeService`)، وبلا `session.status` (الحالة من `session.active()` + الأحداث)، وبلا todos أو أسئلة v1 (استُبدلت باستمارات `session.form.*` وأذونات `permission.*`). أسماء أحداث SSE على السلك (`question.asked`، `permission.updated`، `message.part.updated`…) ثابتة منذ v1 — الترجمة في `server/sse/filter.ts` فقط، فالواجهة لا تتغير مع تبديل المحرك. نفس البوابة (`isListableProjectDirectory` في `server/opencode/utils.ts`) ترشّح قائمة `/api/project` كلها.
- `src/App.tsx` = **2377 سطر**، `server/opencode.ts` = **2066**. معروفين. **ماتزوّدهمش** — استخرج الجزء الجديد لملف مستقل، ولو وُجد barrel للمكان ده (`src/panels/index.ts` أو `src/api/index.ts`) سجّله فيه.
- `@opencode/client` pinned بالظبط. أي bump = مراجعة breaking changes من الـ release notes، مش تخمين.
- `express.json({ limit: "8mb" })` — طلبات أكبر بترمي 413. السقف مرفوع عشان مرفقات الرسائل (الصور مضمّنة كـ data URI، والترميز يكبّر الحجم ~33%).
- `compression` موجود لـ gzip على شبكات Wi-Fi الضعيفة. `/api/events` عليه `no-transform` — متشيلش ولا تغيّره.
- `data/` gitignored وبيخزّن `pins.json` (مثبّتات المحادثات) و`model-pins.json` (مثبّتات النماذج) — حالة السيرفر المحلية. متقتارشش.
- **الاختبارات في `server/` بتبقى compiled جوه `dist-server/`** — لو شفت test بيشتغل مرتين، دي السبب.

## عند الشك

1. `git log --oneline -15` — إزاي الكود بيتكتب فعلاً
2. `npm run check` — بصرّح
3. اقرأ الكود نفسه. **متفترضش حاجة من الكود اللي ماتقراش.**
