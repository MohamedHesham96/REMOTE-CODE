import type { Request } from "express";

// لغة رسائل الخادم: العربية الفصحى + الإنجليزية — بدون أي لهجات عامية.
export type ServerLang = "ar" | "en";

const messages = {
  opencodeConnecting: {
    ar: "جارٍ الاتصال بـ OpenCode…",
    en: "Connecting to OpenCode…",
  },
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
