import type { Request } from "express";

// لغة رسائل الخادم: العربية الفصحى + الإنجليزية — بدون أي لهجات عامية.
export type ServerLang = "ar" | "en";

const messages = {
  opencodeUnavailable: {
    ar: "خدمة OpenCode غير متاحة حاليًا. خادم الهاتف يعمل ويعيد المحاولة تلقائيًا — يرجى الانتظار قليلًا ثم تحديث الصفحة.",
    en: "The OpenCode service is currently unavailable. The phone server is running and retrying automatically — please wait a moment then refresh the page.",
  },
  invalidAccessToken: {
    ar: "رمز الوصول غير صحيح",
    en: "Invalid access token",
  },
  projectRequired: {
    ar: "اختر مشروعًا",
    en: "A project is required",
  },
  invalidTitle: {
    ar: "العنوان مطلوب",
    en: "A title is required",
  },
  emptyMessage: {
    ar: "اكتب رسالة أولًا",
    en: "Write a message first",
  },
  messageTooLong: {
    ar: "الرسالة طويلة جدًا",
    en: "The message is too long",
  },
  modelRequired: {
    ar: "اختر نموذجًا",
    en: "A model is required",
  },
  // اختيار نموذج من الكتالوج العام بنجاح، بس المزوّد لسه مش متوصل على
  // المضيف — فالنموذج محفوظ على الجلسة وبيشتغل بمجرد الربط
  modelProviderNotConnected: {
    ar: "اربط المزوّد من OpenCode على المضيف لاستخدام هذا النموذج",
    en: "Please connect from OpenCode to use this model",
  },
  questionRequired: {
    ar: "السؤال مطلوب",
    en: "A question is required",
  },
  filePathRequired: {
    ar: "مسار الملف مطلوب",
    en: "A file path is required",
  },
  requestRequired: {
    ar: "الطلب مطلوب",
    en: "A request is required",
  },
  invalidPermissionResponse: {
    ar: "رد الإذن غير صالح",
    en: "Invalid permission response",
  },
  invalidPinIds: {
    ar: "قائمة المعرّفات مطلوبة",
    en: "A list of ids is required",
  },
  invalidPin: {
    ar: "بيانات التثبيت غير صالحة",
    en: "Invalid pin data",
  },
  newConversation: {
    ar: "محادثة جديدة",
    en: "New conversation",
  },
  taskReady: {
    ar: "المهمة جاهزة",
    en: "Task ready",
  },
  retryingNow: {
    ar: "يعيد OpenCode المحاولة الآن",
    en: "OpenCode is retrying now",
  },
  usesTool: {
    ar: "يستخدم OpenCode الأداة",
    en: "OpenCode is using",
  },
  // وصف العملية اللي OpenCode بيعملها دلوقتي. أسماء الأدوات في المحرك نص
  // حر (مش اتحاد مغلق) — فبنترجمها لفئات يفهمها المستخدم، ونقفلها على
  // "يستخدم الأداة <اسم>" لأي اسم جديد بدل ما نكسر.
  activityAwaitingTool: {
    ar: "في انتظار أداة",
    en: "Waiting for a tool",
  },
  activityReadingFiles: {
    ar: "يقرأ الملفات",
    en: "Reading files",
  },
  activitySearchingFiles: {
    ar: "يبحث في الكود",
    en: "Searching the code",
  },
  activityRunningCommand: {
    ar: "يشغّل أمرًا",
    en: "Running a command",
  },
  activityApplyingChanges: {
    ar: "يطبّق تعديلات",
    en: "Applying changes",
  },
  activityBrowsingWeb: {
    ar: "يستعرض الويب",
    en: "Browsing the web",
  },
  activityDelegating: {
    ar: "يستعين بمهمة فرعية",
    en: "Delegating a sub-task",
  },
  workingOnTask: {
    ar: "يعمل OpenCode على المهمة",
    en: "OpenCode is working on the task",
  },
  queuedWaiting: {
    ar: "في الانتظار — سيبدأ بعد انتهاء الطلب الذي قبله",
    en: "Waiting — it starts once the request before it finishes",
  },
  fileFallback: {
    ar: "ملف",
    en: "file",
  },
  pushQuestionFallback: {
    ar: "يطلب OpenCode اختيارك",
    en: "OpenCode asks for your choice",
  },
  pushQuestionTitle: {
    ar: "سؤال من OpenCode",
    en: "Question from OpenCode",
  },
  pushDoneTitle: {
    ar: "انتهت المهمة",
    en: "Task finished",
  },
  pushDoneBody: {
    ar: "اكتملت المهمة — افتح التطبيق لعرض النتيجة وتحميل الملفات إن وجدت",
    en: "The task is complete — open the app to view the result and download any files",
  },
  pushPermissionTitle: {
    ar: "طلب إذن",
    en: "Permission request",
  },
  pushErrorTitle: {
    ar: "توقفت المهمة",
    en: "Task stopped",
  },
  pushErrorBody: {
    ar: "حدث خطأ في OpenCode. افتح التطبيق للتفاصيل.",
    en: "An error occurred in OpenCode. Open the app for details.",
  },
  pushTestBody: {
    ar: "الإشعارات تعمل بنجاح",
    en: "Notifications are working",
  },
  // سطور السجل والطرفية (console) — نفس المفاتيح باللغتين، والاختيار عبر
  // consoleLang(). الرسائل التي تحتاج قيمًا متغيرة تستخدم {name}
  // ويستبدلها المنادي بـ replace.
  serviceLaunchFailed: {
    ar: "تعذّر تشغيل خدمة OpenCode في الخلفية:",
    en: "Failed to start the OpenCode background service:",
  },
  connectRetry: {
    ar: "الخادم على :{port} يعمل ويعيد المحاولة بعد 5 ثوانٍ…",
    en: "Server on :{port} is up and retrying in 5s…",
  },
  spawnHint: {
    ar: "السبب: تعذّر تشغيل أمر opencode — تأكد من تثبيت CLI بالإصدار 2 أو اضبط OPENCODE_SERVER_URL",
    en: "Cause: cannot run the opencode command — install CLI v2 or set OPENCODE_SERVER_URL",
  },
  portInUse: {
    ar: "Port {port} مشغول — اقفل أي نسخة قديمة من السيرفر أو غيّر APP_PORT في .env",
    en: "Port {port} is busy — stop any old server copy or change APP_PORT in .env",
  },
  cliRunFailed: {
    ar: "تعذّر تشغيل opencode CLI",
    en: "Cannot run the opencode CLI",
  },
  cliInstallHint: {
    ar: "تأكد من تثبيته أو اضبط OPENCODE_SERVER_URL",
    en: "Make sure it is installed or set OPENCODE_SERVER_URL",
  },
  versionUnknown: {
    ar: "غير معروفة",
    en: "unknown",
  },
  cliVersionMismatch: {
    ar: "نسخة OpenCode CLI المثبتة {version} — المطلوب الإصدار 2 أو أحدث. ثبته بـ: npm uninstall -g opencode-ai && npm install -g @opencode/cli",
    en: "Installed OpenCode CLI is {version} — version 2 or newer is required. Install it with: npm uninstall -g opencode-ai && npm install -g @opencode/cli",
  },
  serviceStartFailed: {
    ar: "تعذّر تشغيل خدمة OpenCode المحلية",
    en: "Cannot start the local OpenCode service",
  },
  cliV2Hint: {
    ar: "تأكد من تثبيت CLI بالإصدار 2 (opencode --version) أو اضبط OPENCODE_SERVER_URL لخادم خارجي",
    en: "Make sure CLI v2 is installed (opencode --version) or set OPENCODE_SERVER_URL to an external server",
  },
  setupCreated: {
    ar: "تم إنشاء {path}",
    en: "Created {path}",
  },
  accessTokenIs: {
    ar: "رمز الوصول: {token}",
    en: "Access token: {token}",
  },
  httpsNote: {
    ar: "لتشغيل PWA/Web Push من الهاتف، فعّل HTTPS عبر APP_TLS_CERT_PATH وAPP_TLS_KEY_PATH.",
    en: "To run PWA/Web Push from the phone, enable HTTPS via APP_TLS_CERT_PATH and APP_TLS_KEY_PATH.",
  },
} as const;

export type ServerMessageKey = keyof typeof messages;

export function isServerLang(value: unknown): value is ServerLang {
  return value === "ar" || value === "en";
}

// الأولوية لمعامل lang الصريح، ثم ترويسة Accept-Language، ثم العربية.
export function getServerLang(request: Pick<Request, "query" | "headers" | "body">): ServerLang {
  const fromQuery = Array.isArray(request.query?.lang) ? request.query.lang[0] : request.query?.lang;
  if (isServerLang(fromQuery)) {
    return fromQuery;
  }
  const fromBody = (request.body as { lang?: unknown } | undefined)?.lang;
  if (isServerLang(fromBody)) {
    return fromBody;
  }
  const header = request.headers["accept-language"];
  const first = Array.isArray(header) ? header[0] : header;
  if (typeof first === "string") {
    const primary = first.split(",")[0]?.trim().toLowerCase() ?? "";
    if (primary.startsWith("en")) {
      return "en";
    }
    if (primary.startsWith("ar")) {
      return "ar";
    }
  }
  return "ar";
}

export function serverMessage(key: ServerMessageKey, lang: ServerLang): string {
  return messages[key][lang];
}

// لغة سطور السجل والطرفية فقط (لا تمس رسائل الـ API — تلك حسب لغة كل
// طلب عبر getServerLang). من APP_LANG (يضبطها build.bat على en)، والافتراضي
// العربية للحفاظ على السلوك الحالي لمن يشغّل يدويًا.
export function consoleLang(env: NodeJS.ProcessEnv = process.env): ServerLang {
  return env.APP_LANG?.trim().toLowerCase().startsWith("en") ? "en" : "ar";
}
