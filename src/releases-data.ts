import type { Release } from "./releases"

// هذا الملف مولّد بالتحليل اليدوي لتاريخ Git — لا تُحرّره يدويًا بلا سبب.
//
// المستودع لا يحتوي على وسوم Git (`git tag -l` فاضية)، فالإصدارات استُنتجت من
// التاريخ الفعلي: كل يوم عمل مكثّف = إصدار، والترقيم نصف الدلالي (Major.Minor)
// مبني على أهم تغيير تراكمي في اليوم، مع Patch للدفعات الصغيرة والترقيعية.
//
// كل نص هنا مزدوج اللغة (ar/en) بنفس أسلوب i18n.ts — العربية فصحى بلا لهجة،
// والإنجليزية فصيحة. إضافة إصدار جديد = إضافة كائن بنصوص اللغتين معًا.
//
// التسلسل الزمني الحقيقي من الأقدم (5775b51) للأحدث (d262332):
//   v1.4.0 (2026-10-02)  →  8 commits توجيه الطلبات + أداء العرض
//   v1.3.0 (2026-10-01)  → 19 commit  أدوات Git + منتقي النماذج + حالة المهمة
//   v1.2.0 (2026-09-29)  → 16 commit  إعادة التسمية RemoteCode + مشغّل Windows
//   v1.1.0 (2026-09-28)  → 16 commit  الترحيل إلى OpenCode v2 + عزل قاعدة البيانات
//   v1.0.1 (2026-09-27)  →  7 commit  git revert + بطاقات المهام
//   v1.0.0 (2026-09-26)  → 30 commit  البنية الأساسية: i18n، الطابور، الملفات
//
// إعادة التوليد: شغّل `scripts/generate-releases.mjs` لأخذ صورة جديدة من
// التاريخ، ثم راجع المجموعة الناتجة قبل إضافتها كإصدار جديد هنا.
export const releases: Release[] = [
  {
    version: "v1.4.0",
    date: "2026-10-02",
    title: {
      ar: "توجيه الطلبات في الطابور وتحسين الأداء",
      en: "Queued request steering and rendering performance",
    },
    summary: {
      ar: "نداءات أقوى للطلبات المنتظرة، وأداء ألطف في العرض، مع إظهار واضح للأسئلة المعلّقة بعد اكتمال المهمة.",
      en: "Stronger control over queued requests, lighter rendering, and clearer pending questions once a task completes.",
    },
    commits: ["bcbfa73", "82e9e6a", "cabb818", "1393b6e", "f44701f", "e86171f", "d262332"],
    changes: [
      {
        category: "features",
        title: {
          ar: "توجيه الطلبات المنتظرة إلى المهمة الجارية",
          en: "Steer queued requests into the running task",
        },
        description: {
          ar: "الطلب المكتوب أثناء عمل مهمة يُوجَّه داخلها بدل انتظاره في طابور منفصل.",
          en: "A request written while a task is running is steered into it instead of waiting in a separate queue.",
        },
        commits: ["bcbfa73"],
      },
      {
        category: "improvements",
        title: {
          ar: "أسئلة معلّقة موثوقة مع بطاقات ثابتة",
          en: "Reliable pending questions with sticky cards",
        },
        description: {
          ar: "ظهور الأسئلة المعلّقة بشكل ثابت مع حارس اتصال SSE يمنع تجمّد الواجهة.",
          en: "Pending questions stay visible as sticky cards, with an SSE watchdog that prevents the UI from freezing.",
        },
        commits: ["82e9e6a"],
      },
      {
        category: "improvements",
        title: {
          ar: "رسالة اكتمال واضحة بدل آخر أداة",
          en: "Clear completion message instead of the last tool",
        },
        description: {
          ar: "بعد انتهاء المهمة تُعرض رسالة الاكتمال بدل اسم آخر أداة استُخدمت.",
          en: "After a task finishes, the completion message is shown instead of the name of the last tool used.",
        },
        commits: ["1393b6e"],
      },
      {
        category: "performance",
        title: {
          ar: "كاش أذونات وذاكرة لعرض الطلبات والشريط الجانبي",
          en: "Permission caching and memoized request and sidebar subtrees",
        },
        description: {
          ar: "تخزين أذونات ETag وتثبيت أشجار العرض وكاش قراءات localStorage لتقليل إعادة الرسم.",
          en: "ETag-cached permissions, memoized render trees, and cached localStorage reads to reduce re-renders.",
        },
        commits: ["f44701f", "d262332"],
      },
      {
        category: "technical",
        title: {
          ar: "إزالة كود ميت ومسارات توافق قديمة",
          en: "Remove dead code and legacy compatibility paths",
        },
        description: {
          ar: "تنظيف أنواع وأدوات غير مستخدمة لتبسيط الصيانة دون تغيير السلوك.",
          en: "Clean up unused types and helpers to simplify maintenance without changing behavior.",
        },
        commits: ["cabb818", "e86171f"],
      },
    ],
  },
  {
    version: "v1.3.0",
    date: "2026-10-01",
    title: {
      ar: "أدوات Git ومنتقي النماذج وحالة المهمة",
      en: "Git actions, model picker, and task status",
    },
    summary: {
      ar: "إجراءات Git منفصلة ومؤكَّدة، منتقي نماذج مثبّتة، وعرض أدق لحالة الجلسة والأدوات المستخدمة.",
      en: "Separate confirmed Git actions, a model picker with pinned models, and a more accurate view of session status and used tools.",
    },
    commits: ["2b0349d", "b2588fe", "8d9108b", "15837ff", "f0fb411", "98c21da", "9eab6e0", "64cf62c", "a5f0201", "33f6c2f", "023725e", "82e4b74", "edff272", "15ab78f", "d254112", "684d328", "d67b719", "8b37758", "2115add"],
    changes: [
      {
        category: "features",
        title: {
          ar: "فصل commit و push و pull إلى إجراءات مؤكَّدة",
          en: "Split commit, push, and pull into confirmed actions",
        },
        description: {
          ar: "أزرار Git مستقلة بخطوة تأكيد لكل إجراء بدل زر واحد يدمج commit و push.",
          en: "Independent Git buttons with a confirmation step for each action instead of one button that merged commit and push.",
        },
        commits: ["2b0349d", "b2588fe", "8d9108b", "9eab6e0"],
      },
      {
        category: "features",
        title: {
          ar: "رفع الـ commits غير المدفوعة من شجرة نظيفة",
          en: "Push unpushed commits from a clean tree",
        },
        description: {
          ar: "عرض عدد الـ commits غير المدفوعة والعمل على رفعها حتى مع عدم وجود تغييرات محلية.",
          en: "Show the unpushed commit count and allow pushing even when there are no local changes.",
        },
        commits: ["d254112", "684d328", "d67b719"],
      },
      {
        category: "features",
        title: {
          ar: "قسم النماذج المثبّتة في منتقي النماذج",
          en: "Pinned models section in the model picker",
        },
        description: {
          ar: "تثبيت النماذج الأكثر استخدامًا مع كاش محلي وطيّ المجموعات.",
          en: "Pin the most-used models with a local cache and collapsible groups.",
        },
        commits: ["023725e", "33f6c2f"],
      },
      {
        category: "features",
        title: {
          ar: "عرض حالة الجلسة والنشاط الحالي في بطاقة المهمة",
          en: "Show session status and current activity in the task card",
        },
        description: {
          ar: "بطاقة المهمة تُظهر حالة الجلسة وما تعمل عليه الآن مع الأدوات المستخدمة.",
          en: "The task card shows the session status and what it is working on now, along with the tools it used.",
        },
        commits: ["15ab78f", "2115add"],
      },
      {
        category: "features",
        title: {
          ar: "تسجيل أسئلة المهام الفرعية على جذرها",
          en: "Collapse subtask sessions onto their root",
        },
        description: {
          ar: "أسئلة المهام الفرعية تُطوى على المحادثة الجذرية بدل تفرّعها في القائمة.",
          en: "Subtask questions fold onto the root conversation instead of branching out in the list.",
        },
        commits: ["98c21da"],
      },
      {
        category: "fixes",
        title: {
          ar: "إصلاحات ثبات المحادثة النشطة",
          en: "Active conversation stability fixes",
        },
        description: {
          ar: "تثبيت المحادثة على أحدث مهمة عند التبديل ومعالجة مشكلات الجلسة النشطة.",
          en: "Pin the conversation to the latest task on switch and fix active-session issues.",
        },
        commits: ["15837ff", "f0fb411", "8b37758"],
      },
      {
        category: "fixes",
        title: {
          ar: "حل تعارضات الدمج في درج التغييرات",
          en: "Resolve merge conflict markers in the Git changes drawer",
        },
        description: {
          ar: "إزالة علامات تعارض الدمج التي كانت تظهر داخل درج Git.",
          en: "Remove the merge conflict markers that appeared inside the Git drawer.",
        },
        commits: ["64cf62c"],
      },
      {
        category: "technical",
        title: {
          ar: "إظهار كل نماذج الذكاء الاصطناعي المتاحة",
          en: "Show every available AI model",
        },
        description: {
          ar: "توسيع قائمة النماذج لتشمل كل ما توفره OpenCode.",
          en: "Expand the model list to include everything OpenCode offers.",
        },
        commits: ["a5f0201", "82e4b74", "edff272"],
      },
    ],
  },
  {
    version: "v1.2.0",
    date: "2026-09-29",
    title: {
      ar: "RemoteCode: مشغّل موثوق وقاعدة أوضح",
      en: "RemoteCode: a reliable launcher and a clearer base",
    },
    summary: {
      ar: "إعادة تسمية التطبيق إلى RemoteCode، بدء صامت وموثوق لمحرّك OpenCode، وشاشة بناء جديدة.",
      en: "Rebranding the app to RemoteCode, a silent and reliable OpenCode engine start, and a new build screen.",
    },
    commits: ["1a6afa7", "2809061", "a50cbbb", "c07edd6", "b0ea373", "dc9373a", "3fad42c", "9d98f2d", "1ec3e6c", "6263a5c", "fc4f39c", "385d662", "fb0ee00", "460f414", "5ff051b", "35b8d2e"],
    changes: [
      {
        category: "features",
        title: {
          ar: "إعادة التسمية إلى RemoteCode مع بدء هادئ",
          en: "Rebrand to RemoteCode with a quiet startup",
        },
        description: {
          ar: "اسم وهوية جديدة، وسجلات تشغيل بالعربية بدل الضجيج في الطرفية.",
          en: "A new name and identity, with localized console logs instead of terminal noise.",
        },
        commits: ["c07edd6"],
      },
      {
        category: "features",
        title: {
          ar: "إظهار عنوان الجهاز على الشبكة ومساره في المشغّل",
          en: "Show the device LAN IP and phone URL in the launcher",
        },
        description: {
          ar: "المشغّل يعرض عنوان IP المحلي ورابط الهاتف لفتح التطبيق مباشرة.",
          en: "The launcher shows the local IP address and the phone URL to open the app directly.",
        },
        commits: ["5ff051b"],
      },
      {
        category: "features",
        title: {
          ar: "شجرة خطوات البناء بدل شريط التقدم",
          en: "Build step tree instead of a progress bar",
        },
        description: {
          ar: "استبدال شريط التقدم بشجرة خطوات محاذية مع إبراز سجل جاهزية OpenCode.",
          en: "Replace the progress bar with an aligned step tree and highlight the OpenCode ready log.",
        },
        commits: ["1ec3e6c"],
      },
      {
        category: "improvements",
        title: {
          ar: "إدارة أوضح لإصدار OpenCode CLI وتثبيته",
          en: "Clearer OpenCode CLI version handling and installation",
        },
        description: {
          ar: "التحقق من الإصدار ومعالجة أخطاء التثبيت ورسائل أوضح للمستخدم.",
          en: "Version checks, installation error handling, and clearer messages for the user.",
        },
        commits: ["1a6afa7", "2809061"],
      },
      {
        category: "improvements",
        title: {
          ar: "إعادة ترتيب أدوات الشريط العلوي",
          en: "Reorder the top bar actions",
        },
        description: {
          ar: "نقل زر تغييرات Git بجوار المحادثات النشطة وتخفيف تلوين زر السجل.",
          en: "Move the Git changes button next to active conversations and mute the history button tint.",
        },
        commits: ["6263a5c", "fc4f39c"],
      },
      {
        category: "fixes",
        title: {
          ar: "بدء محرّك OpenCode بصمت على Windows",
          en: "Start the OpenCode engine silently on Windows",
        },
        description: {
          ar: "تشغيل المحرّك من غير نافذة PowerShell مع سقف زمني لفحص الجاهزية.",
          en: "Run the engine without a PowerShell window, with a capped health check.",
        },
        commits: ["a50cbbb"],
      },
      {
        category: "fixes",
        title: {
          ar: "نص النتيجة النهائية قابل للتمرير",
          en: "Scrollable final result text",
        },
        description: {
          ar: "إبقاء زر العرض الكامل في متناول اليد مع نتيجة طويلة.",
          en: "Keep the expand toggle within reach when the result is long.",
        },
        commits: ["385d662"],
      },
      {
        category: "fixes",
        title: {
          ar: "إظهار المشاريع المسجَّلة بلا محادثات",
          en: "Show registered projects that have no conversations",
        },
        description: {
          ar: "مشروع جديد بدون أي جلسة كان يختفي من القائمة.",
          en: "A newly registered project with no sessions used to disappear from the list.",
        },
        commits: ["35b8d2e"],
      },
      {
        category: "uiux",
        title: {
          ar: "تحسينات مظهر الأزرار في الثيمين",
          en: "Button tint polish across both themes",
        },
        description: {
          ar: "تخفيف تلوين زر السجل ليتماشى مع الثيم الفاتح والداكن.",
          en: "Mute the history button tint to fit both the light and dark themes.",
        },
        commits: ["fc4f39c"],
      },
      {
        category: "technical",
        title: {
          ar: "توحيد اسم ملف البناء وتوثيق الوصول البعيد",
          en: "Unify the build script name and document remote access",
        },
        description: {
          ar: "إعادة تسمية run.bat إلى build.bat وتحديث المراجع وتوثيق Tailscale.",
          en: "Rename run.bat to build.bat, update all references, and document Tailscale remote access.",
        },
        commits: ["b0ea373", "dc9373a", "3fad42c", "fb0ee00"],
      },
    ],
  },
  {
    version: "v1.1.0",
    date: "2026-09-28",
    title: {
      ar: "الترحيل إلى OpenCode v2",
      en: "Port to OpenCode v2",
    },
    summary: {
      ar: "نقل الباك إند والواجهة إلى عميل OpenCode الإصدار الثاني، مع عزل قاعدة البيانات وبطاقات مهام جديدة.",
      en: "Move the backend and UI to the OpenCode v2 client, with database isolation and redesigned task cards.",
    },
    commits: ["9627c8e", "726852d", "2cdf364", "6130679", "8e8855d", "87022f3", "0b38e52", "32bafcb", "5c21d1a", "09055ed", "7668cdb", "1c85781", "1bbb9f8", "d23bb25", "ab09b28", "d309ad3"],
    changes: [
      {
        category: "features",
        title: {
          ar: "الترحيل الكامل إلى OpenCode v2",
          en: "Full migration to OpenCode v2",
        },
        description: {
          ar: "الباك إند والواجهة يعملان على عميل الإصدار الثاني مع عقد أحداث ثابت.",
          en: "The backend and UI run on the v2 client with a stable event contract.",
        },
        commits: ["ab09b28"],
      },
      {
        category: "features",
        title: {
          ar: "عزل قاعدة بيانات OpenCode واستيراد مشاريع الديسكتوب",
          en: "Isolate the OpenCode database and import desktop project folders",
        },
        description: {
          ar: "قاعدة بيانات مستقلة مع إمكانية استيراد مجلدات المشاريع من تطبيق الديسكتوب.",
          en: "An isolated database with the ability to import project folders from the desktop app.",
        },
        commits: ["1c85781"],
      },
      {
        category: "improvements",
        title: {
          ar: "بطاقة مهمة مجمّعة بعنوان كامل",
          en: "Consolidated task card with a full-width title",
        },
        description: {
          ar: "رأس البطاقة يعرض العنوان بعرض كامل والمحادثة داخل بطاقة عائمة مثبّتة.",
          en: "The card header shows the title full width, with the conversation in a pinned floating card.",
        },
        commits: ["726852d", "2cdf364", "6130679"],
      },
      {
        category: "fixes",
        title: {
          ar: "معالجة المهام التي تعلّقت كأنها تعمل بلا تقدّم",
          en: "Fix tasks stuck showing as working with no progress",
        },
        description: {
          ar: "كشف الجمود وإظهار الحالة الحقيقية بدل بقاء المهمة قيد التنفيذ.",
          en: "Detect stalls and show the real state instead of leaving the task marked as running.",
        },
        commits: ["9627c8e"],
      },
      {
        category: "fixes",
        title: {
          ar: "احتساب جلسات العمل في شارة المحادثات النشطة",
          en: "Count working sessions in the active conversations badge",
        },
        description: {
          ar: "الشارة كانت لا تحصي الجلسات النشطة في الشريط الجانبي.",
          en: "The badge was not counting active sessions in the sidebar.",
        },
        commits: ["5c21d1a"],
      },
      {
        category: "fixes",
        title: {
          ar: "رسائل أوضح من سكربت التشغيل",
          en: "Clearer messages from the run script",
        },
        description: {
          ar: "فشل سريع عند غياب OpenCode CLI وإنشاء ملف البيئة تلقائيًا في وضع التطوير.",
          en: "Fail fast when the OpenCode CLI is missing and auto-create the env file in dev mode.",
        },
        commits: ["09055ed", "7668cdb"],
      },
      {
        category: "uiux",
        title: {
          ar: "توحيد الحواف وتنسيقة البطاقات",
          en: "Flatten corners and tidy card spacing",
        },
        description: {
          ar: "تسطيح انحناءات الحواف في كل التطبيق وتضييق المسافات أعلى البطاقات.",
          en: "Flatten border radii across the app and tighten the gaps above cards.",
        },
        commits: ["8e8855d", "87022f3", "0b38e52", "32bafcb"],
      },
      {
        category: "technical",
        title: {
          ar: "توثيق البنية وواجهة API",
          en: "Document the architecture and API",
        },
        description: {
          ar: "توسيع README بخطوات الإعداد والبنية ومرجع واجهة الـ API.",
          en: "Expand the README with setup steps, architecture, and an API reference.",
        },
        commits: ["1bbb9f8"],
      },
    ],
  },
  {
    version: "v1.0.1",
    date: "2026-09-27",
    title: {
      ar: "إجراءات Git وبطاقات مهام مقروءة",
      en: "Git actions and readable task cards",
    },
    summary: {
      ar: "تراجع عن تغييرات Git، سِمة معدنية جديدة، وأزرار نسخ وتحسين عرض الرسائل.",
      en: "Revert Git changes, a new metal theme, and copy buttons with better message presentation.",
    },
    commits: ["39cdcb8", "7ecec18", "908dee6", "03d46c7", "00a43cf", "3299165", "1f15763"],
    changes: [
      {
        category: "features",
        title: {
          ar: "إجراءات التراجع في Git",
          en: "Git revert actions",
        },
        description: {
          ar: "التراجع عن ملف واحد أو عن الكل مع أيقونات Git جديدة وسِمة معدنية.",
          en: "Revert a single file or everything, with new Git icons and a metal theme.",
        },
        commits: ["7ecec18", "00a43cf"],
      },
      {
        category: "features",
        title: {
          ar: "أزرار نسخ في كارت المهمة",
          en: "Copy buttons in the task card",
        },
        description: {
          ar: "نسخ سريع للطلب والنتيجة مع تحديث شكل بطاقات المحادثة.",
          en: "Quick copy for the request and the result, with refreshed conversation cards.",
        },
        commits: ["39cdcb8"],
      },
      {
        category: "improvements",
        title: {
          ar: "تعديل العنوان داخل الحبّة",
          en: "Edit the title inside the pill",
        },
        description: {
          ar: "نقل تحرير اسم المحادثة داخل الحبّة وتحديث أيقونات Git.",
          en: "Move conversation renaming inside the pill and refresh the Git icons.",
        },
        commits: ["908dee6"],
      },
      {
        category: "fixes",
        title: {
          ar: "تعطيل أدوات Git بدون تغييرات",
          en: "Disable Git controls with no changes",
        },
        description: {
          ar: "منع الإجراءات أثناء خطوة التأكيد أو عند عدم وجود ملفات متغيّرة.",
          en: "Prevent actions during the confirmation step or when there are no changed files.",
        },
        commits: ["03d46c7"],
      },
      {
        category: "fixes",
        title: {
          ar: "منع تكرار المحادثات النشطة عند الإرسال",
          en: "Prevent duplicate active conversations on send",
        },
        description: {
          ar: "إرسال مهمة جديدة لم يعد يضيف نسخة مكرّرة في القائمة.",
          en: "Sending a new task no longer adds a duplicate entry to the list.",
        },
        commits: ["3299165"],
      },
      {
        category: "fixes",
        title: {
          ar: "طيّ النتيجة النهائية إلى ستة أسطر",
          en: "Clamp the final result to six lines",
        },
        description: {
          ar: "تحديد حد الطيّ قبل زر العرض الكامل.",
          en: "Set the collapse limit before the show-more toggle.",
        },
        commits: ["1f15763"],
      },
    ],
  },
  {
    version: "v1.0.0",
    date: "2026-09-26",
    title: {
      ar: "الإصدار الأول: أساس OpenCode Mobile",
      en: "First release: the OpenCode Mobile foundation",
    },
    summary: {
      ar: "أول إصدار عملي: ثنائية اللغة، إدارة الطابور، ملفات النتائج، وتثبيت المحادثات على السيرفر.",
      en: "The first working release: bilingual UI, queue management, result files, and server-side conversation pins.",
    },
    commits: ["0036955", "cc47a62", "5fc7127", "2b04726", "6eb6c99", "5e6be7c", "dae1cb8", "727937d", "dafdd8e", "a2a630e", "216888e", "d9a7d2a", "0eb3594", "8b8cb5e", "97ab66e", "619539f", "6e1eff9", "1847851", "d2fa087", "b0770aa", "ecec77e", "7aaa063", "486a0e0", "adc472e", "61db7fc", "b2f522a", "5b03166", "29ea672", "5349fec", "86ce781"],
    changes: [
      {
        category: "features",
        title: {
          ar: "واجهة ثنائية اللغة (العربية والإنجليزية)",
          en: "Bilingual UI (Arabic and English)",
        },
        description: {
          ar: "نظام ترجمة كامل بفصحى وإنجليزي مع تبديل فوري واتجاه RTL/LTR.",
          en: "A full translation system in Arabic and English with instant switching and RTL/LTR direction.",
        },
        commits: ["0036955"],
      },
      {
        category: "features",
        title: {
          ar: "إدارة الطابور: إزالة وتخطٍّ وتنفيذ فوري",
          en: "Queue management: remove, skip, and run now",
        },
        description: {
          ar: "تحكّم كامل في الطلبات المنتظرة مع دوال API لإدارتها.",
          en: "Full control over queued requests with API functions to manage them.",
        },
        commits: ["5fc7127", "2b04726"],
      },
      {
        category: "features",
        title: {
          ar: "ملفات النتائج مع تحميل ومشاركة",
          en: "Result files with download and share",
        },
        description: {
          ar: "عرض ملفات المهمة النهائية مع تحميل مباشر على الهاتف ومشاركتها لأي تطبيق.",
          en: "Show the task's final files with direct download on the phone and sharing to any app.",
        },
        commits: ["dae1cb8"],
      },
      {
        category: "features",
        title: {
          ar: "تثبيت المحادثات على السيرفر لكل مشروع",
          en: "Server-side conversation pins per project",
        },
        description: {
          ar: "محادثات مثبّتة مخزّنة على السيرفر وتظهر في كل الأجهزة وتتزامن مباشرة.",
          en: "Pinned conversations stored on the server, shown on every device, and synced live.",
        },
        commits: ["ecec77e", "7aaa063", "adc472e", "61db7fc", "5b03166"],
      },
      {
        category: "features",
        title: {
          ar: "نموذج افتراضي لكل مشروع",
          en: "Per-project default model",
        },
        description: {
          ar: "حفظ النموذج ومستوى التفكير المختار لكل مشروع على حدة.",
          en: "Save the chosen model and thinking level for each project separately.",
        },
        commits: ["29ea672"],
      },
      {
        category: "features",
        title: {
          ar: "شريط علوي جديد مع تبديل الصوت",
          en: "New top bar with a sound toggle",
        },
        description: {
          ar: "إعادة تصميم رأس الجوال وتجميع الأيقونات بفواصل وإضافة كتم الصوت.",
          en: "Redesign the mobile header, group icons with dividers, and add sound muting.",
        },
        commits: ["5349fec", "86ce781"],
      },
      {
        category: "improvements",
        title: {
          ar: "نصوص المهام والنتائج قابلة للتوسيع",
          en: "Expandable task and result text",
        },
        description: {
          ar: "عرض أول ستة أسطر من الطلب والنتيجة مع زر عرض كامل.",
          en: "Show the first six lines of the request and result with a show-more button.",
        },
        commits: ["727937d"],
      },
      {
        category: "improvements",
        title: {
          ar: "تمرير تلقائي ذكي عند وصول ردود جديدة",
          en: "Smart auto-scroll on new replies",
        },
        description: {
          ar: "التمرير لأسفل فقط عند وجود المستخدم قرب النهاية، وعند فتح محادثة.",
          en: "Scroll down only when the user is near the bottom, and when a conversation is opened.",
        },
        commits: ["d9a7d2a", "8b8cb5e"],
      },
      {
        category: "performance",
        title: {
          ar: "تقليل استهلاك بيانات الجوال",
          en: "Reduce mobile data usage",
        },
        description: {
          ar: "استقصاء ETag وتنزيل متدفّق وتقسيم الكود لتقليل الحِمل على شبكات Wi-Fi الضعيفة.",
          en: "ETag polling, streaming downloads, and code splitting to lighten the load on weak Wi-Fi.",
        },
        commits: ["6eb6c99"],
      },
      {
        category: "fixes",
        title: {
          ar: "معالجة الطلبات العالقة وثبات القائمة",
          en: "Fix stuck requests and stabilize the list",
        },
        description: {
          ar: "إصلاح الطلبات التي تبقى قيد التنفيذ والحفاظ على موضع قائمة الجلسات.",
          en: "Fix requests that stay running and keep the session list position stable.",
        },
        commits: ["cc47a62"],
      },
      {
        category: "fixes",
        title: {
          ar: "تحديث الحالة إلى خاملة فور الإيقاف",
          en: "Set status to idle immediately on abort",
        },
        description: {
          ar: "إيقاف المهمة يحدّث حالة الجلسة فورًا بدل انتظار نبضة لاحقة.",
          en: "Aborting a task updates the session status at once instead of waiting for a later tick.",
        },
        commits: ["0eb3594"],
      },
      {
        category: "fixes",
        title: {
          ar: "أزرار النسخ في السجل والنتيجة",
          en: "Copy buttons in the history and result panels",
        },
        description: {
          ar: "نسخ نص السؤال والنتيجة يعمل بشكل صحيح في اللوحات.",
          en: "Copying the question and result text now works correctly in the panels.",
        },
        commits: ["619539f"],
      },
      {
        category: "fixes",
        title: {
          ar: "دقة شارة عدد ملفات Git",
          en: "Accurate Git file count badge",
        },
        description: {
          ar: "الشارة كانت تعرض رقمًا غير صحيح.",
          en: "The badge was showing an incorrect number.",
        },
        commits: ["1847851"],
      },
      {
        category: "uiux",
        title: {
          ar: "تنسيق الثيم الفاتح ورأس الجوال",
          en: "Polish the light theme and mobile header",
        },
        description: {
          ar: "صقل الثيم الفاتح وأيقونات الرأس وضبط تخطيط المحرّر.",
          en: "Refine the light theme, header icons, and composer layout.",
        },
        commits: ["5e6be7c", "216888e"],
      },
      {
        category: "uiux",
        title: {
          ar: "إضافة مستوى التفكير إلى اسم النموذج",
          en: "Show the thinking level next to the model name",
        },
        description: {
          ar: "عرض مستوى التفكير (variant) بجوار اسم النموذج في الرأس.",
          en: "Display the thinking level (variant) beside the model name in the header.",
        },
        commits: ["a2a630e"],
      },
      {
        category: "technical",
        title: {
          ar: "زر commit داخل درج Git وإصلاح الكوكي",
          en: "Commit button in the Git drawer and a cookie fix",
        },
        description: {
          ar: "إضافة زر commit إلى شريط أدوات درج Git وضبط sameSite للكوكي.",
          en: "Add a commit button to the Git drawer toolbar and fix the cookie's sameSite setting.",
        },
        commits: ["dafdd8e", "486a0e0"],
      },
    ],
  },
]
