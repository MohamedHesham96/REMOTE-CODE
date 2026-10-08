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
// التسلسل الزمني الحقيقي من الأقدم (5775b51) للأحدث (c33cfc2):
//   v1.9.0 (2026-10-08)  →  3 commits التحكم الصوتي الطبيعي + كلمة التنبيه + الزر العايم
//   v1.8.5 (2026-10-08)  →  1 commit  تنبيه التحديث + ملخص الاستهلاك + المسارات الكاملة
//   v1.8.4 (2026-10-08)  →  2 commits المفضّلة + ملخص المشاريع + تفرّع المحادثة
//   v1.8.3 (2026-10-08)  →  1 commit  لوحة الانتباه + إعادة المحاولة + إشعار الاكتمال
//   v1.8.2 (2026-10-07)  →  1 commit  واجهة المشغّل الجديدة
//   v1.8.1 (2026-10-07)  →  2 commits عنوان الشبكة في المشغّل + رقم النسخة
//   v1.8.0 (2026-10-07)  → 11 commits الثيمات + حالة التخطي + أوامر الصوت + الأداء
//   v1.7.0 (2026-10-06)  →  13 commit قفل المايك واللصق ومثبّتات النماذج والجداول
//   v1.6.0 (2026-10-05)  →  2 commits الإدخال الصوتي + مرفقات الرسائل + PWA وHTTPS
//   v1.5.0 (2026-10-03)  →  8 commits تبديل الفروع + ملاحظات الإصدار + بطاقات المهام
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
    version: "v1.9.0",
    date: "2026-10-08",
    title: {
      ar: "تحكم صوتي طبيعي وكلمة تنبيه",
      en: "Natural-language voice control and a wake word",
    },
    summary: {
      ar: "تحدّث بأسلوبك العادي فينفّذ التطبيق الأمر — التنقّل بين اللوحات، وفتح المشاريع والمحادثات، وتبديل النموذج والمظهر واللغة، وإجراءات Git — مع كلمة تنبيه تفتح اللوحة من دون لمس الهاتف، وزر عائم في متناول الإبهام.",
      en: "Speak in your own words and the app carries out the command — moving between panels, opening projects and conversations, switching the model, theme, and language, and running Git actions — with a wake phrase that opens the panel hands-free and a floating button within thumb reach.",
    },
    commits: ["c51c9b1", "80a82ca", "c33cfc2"],
    changes: [
      {
        category: "features",
        title: {
          ar: "تحكم صوتي بعبارات طبيعية داخل التطبيق",
          en: "Voice control with natural phrases inside the app",
        },
        description: {
          ar: "قل ما تريد بصياغتك: انتقل بين اللوحات، وافتح مشروعًا أو محادثة، وبدّل النموذج والمظهر واللغة، ونفّذ إجراءات Git. الأوامر الخطرة مثل إيقاف المهمة أو الرجوع عن التغييرات تطلب تأكيدًا قبل التنفيذ، ولو كان طلبك غامضًا تعرض اللوحة خيارات لتختار منها.",
          en: "Say what you want in your own words: move between panels, open a project or conversation, switch the model, theme, and language, and run Git actions. Risky commands such as stopping a task or reverting changes ask for confirmation first, and an ambiguous request shows choices to pick from.",
        },
        commits: ["c51c9b1"],
      },
      {
        category: "features",
        title: {
          ar: "كلمة تنبيه تفتح التحكم الصوتي بلا لمس",
          en: "A wake phrase opens voice control hands-free",
        },
        description: {
          ar: "فعّل مستمع كلمة التنبيه واختر عبارة من إعدادات الصوت، فيفتح المستمع في الخلفية اللوحة عند قول العبارة — مع عبارة افتراضية لكل لغة، وتوقف تلقائي أثناء فتح اللوحة أو إخفاء الصفحة أو انشغال الميكروفون بمستهلك آخر.",
          en: "Enable the wake listener and pick a phrase in the voice settings, and the background listener opens the panel when you say it — with a default phrase per language and automatic pausing while the panel is open, the page is hidden, or the mic is busy elsewhere.",
        },
        commits: ["80a82ca"],
      },
      {
        category: "improvements",
        title: {
          ar: "زر تحكم صوتي عائم فوق شريط الكتابة",
          en: "A floating voice-control button above the composer",
        },
        description: {
          ar: "انتقل زر التحكم الصوتي من الشريط العلوي إلى زر عائم منتصف الشاشة فوق الكومبوزر، فيبقى في المكان نفسه على كل الشاشات وفي متناول الإبهام.",
          en: "The voice-control button moved from the top bar to a floating button centered above the composer, so it stays in the same spot on every screen and within thumb reach.",
        },
        commits: ["c33cfc2"],
      },
      {
        category: "technical",
        title: {
          ar: "ملكية مشتركة للميكروفون بين الإملاء والأوامر والتنبيه",
          en: "Shared microphone ownership across dictation, commands, and wake listening",
        },
        description: {
          ar: "سجل واحد يحكم ملكية الميكروفون، فلا تتصادم جلسات الإملاء والتحكم الصوتي وكلمة التنبيه؛ من ليس صاحب الملكية يتوقف ويعيد المحاولة عندما يتحرر الميكروفون.",
          en: "A single registry governs microphone ownership so dictation, voice control, and the wake listener never clash; whoever lacks ownership stops and retries once the mic is free.",
        },
        commits: ["80a82ca"],
      },
    ],
  },
  {
    version: "v1.8.5",
    date: "2026-10-08",
    title: {
      ar: "تنبيه تحديث وملخص استهلاك ومسارات ملفات كاملة",
      en: "Update notifications, session usage, and full result paths",
    },
    summary: {
      ar: "شريط هادئ يخبرك بوجود إصدار أحدث مع ملاحظاته، وملخص استهلاك الجلسة في درج السجل، والمسار الكامل لملفات النتيجة معروضًا وقابلًا للنسخ.",
      en: "A quiet banner tells you a newer version exists, with its notes; a session usage summary lands in history; and result files show a full, copyable path.",
    },
    commits: ["9c224ef"],
    changes: [
      {
        category: "features",
        title: {
          ar: "تنبيه بوجود إصدار أحدث مع عرض التحديث",
          en: "A newer-version notice with an in-app overview",
        },
        description: {
          ar: "يفحص السيرفر نسخة المشروع على GitHub في الخلفية من دون تعطيل أي شيء، وعند وجود إصدار أحدث يظهر شريط هادئ في مساحة العمل يعرض الإصدارين مع زر لعرض الجديد أو تأجيله، وتُضاف بطاقة الإصدار الأحدث أعلى لوحة الإصدارات مع ملاحظاته من GitHub.",
          en: "The server checks the project version on GitHub in the background without blocking anything; when a newer release exists a quiet banner shows both versions with buttons to view or postpone, and the release notes panel gains a card for the newer version with its notes from GitHub.",
        },
        commits: ["9c224ef"],
      },
      {
        category: "features",
        title: {
          ar: "ملخص استهلاك الجلسة في درج السجل",
          en: "Session usage summary in the history drawer",
        },
        description: {
          ar: "يعرض أعلى السجل عدد الرموز (إدخال/إخراج/إجمالي) والتكلفة وعدد الطلبات ومدة العمل، ولا يعرض إلا الأرقام التي يرسلها المحرك فعلًا — فغيابها يظهر «غير متاح» لا صفرًا.",
          en: "The top of history shows token counts (input/output/total), cost, request count, and working duration, displaying only what the engine actually reports — missing numbers read as unavailable rather than zero.",
        },
        commits: ["9c224ef"],
      },
      {
        category: "improvements",
        title: {
          ar: "المسار الكامل لملفات النتيجة مع نسخ بضغطة",
          en: "Full result-file paths with one-tap copy",
        },
        description: {
          ar: "تعرض قائمة ملفات النتيجة المسار الكامل الذي يرسله المحرك، ويمكن الضغط عليه للتوسيع أو نسخه، وإذا لم يتوفر المسار الكامل تظهر ملاحظة بذلك بدل التخمين.",
          en: "The result-file list shows the full path the engine sends, tappable to expand or copy; when no full path is available a note says so instead of guessing.",
        },
        commits: ["9c224ef"],
      },
    ],
  },
  {
    version: "v1.8.4",
    date: "2026-10-08",
    title: {
      ar: "طلبات مفضّلة وملخصات مشاريع وتفرّع من المحادثة",
      en: "Favorite prompts, project summaries, and conversation branching",
    },
    summary: {
      ar: "احفظ الطلبات التي تكررها في مفضّلة مشتركة بين الأجهزة، وشاهد في قائمة المشاريع ما يعمل وما يحتاج انتباه، وابدأ فرعًا جديدًا من أي محادثة والأصل لا يتغيّر.",
      en: "Save repeated prompts in a favorites list shared across devices, see what is running and what needs attention in the project list, and start a branch from any conversation without touching the original.",
    },
    commits: ["1b71079", "69d6cbe"],
    changes: [
      {
        category: "features",
        title: {
          ar: "طلبات مفضّلة مشتركة بين الأجهزة",
          en: "Favorite prompts shared across devices",
        },
        description: {
          ar: "احفظ نص الطلب من الكومبوزر أو كارت المهمة أو السجل في مفضّلة محفوظة على السيرفر، فتتشترك فيها كل الأجهزة وتبقى بعد تحديث الصفحة وإعادة تشغيل السيرفر. لوحة منزلقة تتيح استخدام الطلب أو تعديل نصه واسمه أو حذفه، مع نجمة تبيّن الطلبات المحفوظة.",
          en: "Save a prompt from the composer, a task card, or history into a server-backed favorites list shared by every device and kept across page refreshes and server restarts. A bottom sheet lets you use, rename, edit, or delete a favorite, with a star marking saved prompts.",
        },
        commits: ["1b71079"],
      },
      {
        category: "features",
        title: {
          ar: "تفرّع جديد من محادثة قائمة",
          en: "Branch a new conversation from an existing one",
        },
        description: {
          ar: "زر في ترويسة كارت المهمة ينشئ محادثة جديدة بالسياق نفسه لمواصلة العمل في اتجاه آخر، ويبقى الأصل كما هو. الفرع جلسة مستقلة تظهر في القائمة وتُسمّى وتُعدَّل بحرية.",
          en: "A button in the task-card header creates a new conversation with the same context to continue in another direction while the original stays untouched. The branch is an independent session in the list that can be renamed and edited freely.",
        },
        commits: ["1b71079"],
      },
      {
        category: "improvements",
        title: {
          ar: "ملخص لكل مشروع في قائمة المشاريع",
          en: "A summary for every project in the project list",
        },
        description: {
          ar: "يظهر أسفل اسم كل مشروع عدد المحادثات الجارية والمحتاجة انتباه وإجمالي محادثاته، أو «خامل · آخر نشاط منذ…»، والبناء من الحالات الحية القائمة بلا نداءات إضافية.",
          en: "Under each project name the list shows running and attention counts and the conversation total, or \"idle · last activity\", built from existing live state with no extra calls.",
        },
        commits: ["1b71079"],
      },
      {
        category: "fixes",
        title: {
          ar: "المفضّلة لا تختفي بعد تحديث الصفحة",
          en: "Favorites no longer disappear after a refresh",
        },
        description: {
          ar: "كانت قائمة المفضّلة تُستبدل أحيانًا بنسخة السيرفر الأقدم أثناء التحديث فتضيع الطلبات الحديثة؛ الآن تُطبَّق أحدث صورة بعد انتهاء التعديل المحلي.",
          en: "The favorites list was sometimes replaced by an older server copy during a refresh, losing recent saves; the newest snapshot now wins after the local edit settles.",
        },
        commits: ["69d6cbe"],
      },
    ],
  },
  {
    version: "v1.8.3",
    date: "2026-10-08",
    title: {
      ar: "مركز انتباه للمعلّقات وإعادة محاولة المهام الفاشلة",
      en: "An attention center for pending work and failed-task retries",
    },
    summary: {
      ar: "لوحة واحدة تجمع الأسئلة والأذونات المعلّقة من كل المشاريع، وشارة تعدّها في الشريط العلوي، مع زر لإعادة تشغيل الطلب الذي فشل وإشعار عند اكتمال المهمة أو فشلها.",
      en: "One panel gathers pending questions and permissions from every project, a top-bar badge counts them, and a failed request can be retried, with a push when a task completes or fails.",
    },
    commits: ["80e2df4"],
    changes: [
      {
        category: "features",
        title: {
          ar: "لوحة انتباه موحّدة لكل المعلّقات",
          en: "A unified attention panel for everything pending",
        },
        description: {
          ar: "زر في الشريط العلوي يحمل شارة بعدد الأسئلة والأذونات المعلّقة من كل المشاريع، ويفتح لوحة تجمعها مع اسم المحادثة والمشروع للإجابة أو الرد عليها في مكان واحد.",
          en: "A top-bar button carries a badge counting pending questions and permissions across all projects and opens a panel that gathers them with their conversation and project names so they can be answered in one place.",
        },
        commits: ["80e2df4"],
      },
      {
        category: "features",
        title: {
          ar: "إعادة محاولة الطلب الفاشل من بطاقة المهمة",
          en: "Retry a failed request from its task card",
        },
        description: {
          ar: "عند فشل المهمة تعرض البطاقة تفاصيل الخطأ مع زر لإعادة المحاولة بالنموذج والوكيل نفسيهما، أو المتابعة يدويًا، وحارس يمنع تكرار الإرسال من الضغطات السريعة.",
          en: "When a task fails the card shows the error details with a button to retry with the same model and agent, or to continue manually, with a guard that blocks duplicate sends from rapid taps.",
        },
        commits: ["80e2df4"],
      },
      {
        category: "improvements",
        title: {
          ar: "إشعار عند اكتمال المهمة لا عند الفشل فقط",
          en: "A push when a task completes, not only when it fails",
        },
        description: {
          ar: "يُرسل إشعار عند نجاح تشغيل المهمة كذلك، فتعرف من الهاتف أن العمل انتهى حتى إن لم يصل حدث الخمول المتوقع.",
          en: "A push is now sent when a run succeeds as well, so the phone tells you the work finished even if the expected idle event never arrives.",
        },
        commits: ["80e2df4"],
      },
    ],
  },
  {
    version: "v1.8.2",
    date: "2026-10-07",
    title: {
      ar: "واجهة مشغّل جديدة بهوية بصرية موحّدة",
      en: "A redesigned launcher with a unified visual identity",
    },
    summary: {
      ar: "يعرض المشغّل شعار المشروع ورقم نسخته داخل لوحة هوية واضحة، وتوحّدت أشجار الخطوات وأقسامها ولوحات التحذير والخطأ في شكل واحد.",
      en: "The launcher draws the project wordmark and its version inside a clear identity panel, and step trees, section headers, and warning and error panels share one consistent look.",
    },
    commits: ["ebe5e22"],
    changes: [
      {
        category: "uiux",
        title: {
          ar: "لوحة هوية المشروع ورقم النسخة في المشغّل",
          en: "Project identity panel and version in the launcher",
        },
        description: {
          ar: "يظهر اسم المشروع ورقم النسخة المقروء من package.json داخل إطار، مع شعار حرفي بخط ثابت يظهر واحدًا في كل الطرفيات، وتُطبع النسخة الحية في تذييل كل شاشة.",
          en: "The banner shows the project name and the version read from package.json inside a frame, with lettering in a fixed block font that renders identically across terminals, and the live version prints in every screen footer.",
        },
        commits: ["ebe5e22"],
      },
      {
        category: "uiux",
        title: {
          ar: "أشجار خطوات ولوحات رسائل على محاذاة واحدة",
          en: "Step trees and message panels on one alignment",
        },
        description: {
          ar: "أشجار خطوات البناء وعناوين الأقسام ولوحات التحذير والخطأ صارت تُرسم بحدود صندوقية ولون موحّد مع علامات نجاح وفشل واضحة، ويتّسع كل صندوق لنصه فلا ينكسر سطره في طرفية ضيقة.",
          en: "Build step trees, section headers, and warning and error panels now use box-drawing borders and one brand color with clear success and failure marks, and each panel sizes itself to its text so lines never wrap in a narrow terminal.",
        },
        commits: ["ebe5e22"],
      },
    ],
  },
  {
    version: "v1.8.1",
    date: "2026-10-07",
    title: {
      ar: "المشغّل يختار عنوان الشبكة الصحيح ويجدد الشهادة",
      en: "The launcher picks the reachable network address and renews the certificate",
    },
    summary: {
      ar: "المشغّل بقى يختار عنوان IP اللي الهاتف يقدر يوصله فعلًا بدل محولات Hyper-V وWSL وVPN، ويجدد شهادة HTTPS تلقائيًا لما العنوان يتغيّر، مع رقم النسخة تحت البانر.",
      en: "The launcher now picks the LAN address the phone can actually reach instead of a Hyper-V, WSL, or VPN adapter, and renews the HTTPS certificate automatically when that address changes, with the version printed under the banner.",
    },
    commits: ["3c4499c", "1b753c5"],
    changes: [
      {
        category: "fixes",
        title: {
          ar: "المشغّل يختار العنوان الذي يصله الهاتف فعلًا",
          en: "The launcher picks the address the phone can actually reach",
        },
        description: {
          ar: "كان أول محول شغّال ببوابة افتراضية هو المرشح، فكانت النتيجة أحيانًا عنوان Hyper-V أو WSL أو VPN لا يستطيع الهاتف فتحه. الآن تُرتَّب المحولات الفيزيائية قبل الافتراضية، ويُدرج الباقي في صفوف عناوين بديلة مع اسم كل محول، ويمكن تثبيت العنوان يدويًا من APP_LAN_IP.",
          en: "The first adapter that was up with a gateway used to win, which sometimes meant a Hyper-V, WSL, or VPN address the phone cannot open. Physical adapters are now ranked ahead of virtual ones, the runners-up print as Alt IP rows with their adapter names, and APP_LAN_IP pins the address by hand.",
        },
        commits: ["1b753c5"],
      },
      {
        category: "fixes",
        title: {
          ar: "تجديد شهادة HTTPS تلقائيًا عند تغيير العنوان",
          en: "Automatic certificate renewal when the address changes",
        },
        description: {
          ar: "تغيير شبكة الجهاز كان يترك الهاتف على خطأ شهادة لأن العنوان الجديد غير مشمول. الآن تُفحص تغطية الشهادة لكل عنوان معروض قبل التشغيل، وتُجدَّد عند الحاجة فقط — والملفات الجديدة تُكتب جانبًا فالفشل لا يدمّر شهادة سليمة.",
          en: "Changing networks used to leave the phone on a certificate error because the new address was not covered. The certificate is now checked against every printed address before launch and renewed only when needed, with new files written aside so a failed run cannot destroy a working pair.",
        },
        commits: ["1b753c5"],
      },
      {
        category: "improvements",
        title: {
          ar: "رقم النسخة تحت بانر المشغّل",
          en: "The project version under the launcher banner",
        },
        description: {
          ar: "يطبع المشغّل اسم المشروع ورقم نسخته مباشرة تحت الشعار، مقروءًا من package.json في كل تشغيل فيتطابق مع الرقم اللي التطبيق يعرضه.",
          en: "The launcher prints the project name and version right under the logo, read from package.json on every launch so it always matches the number the app shows.",
        },
        commits: ["3c4499c"],
      },
    ],
  },
  {
    version: "v1.8.0",
    date: "2026-10-07",
    title: {
      ar: "ثيمات جديدة وتحكم أوضح في المهام والإملاء الصوتي",
      en: "Fresh themes and clearer task and voice controls",
    },
    summary: {
      ar: "لوحات ألوان جديدة للثيمين الفاتح والداكن، وحالة مستقلة للطلبات المتخطّاة، وأمر صوتي لمسح النص مع استمرار الاستماع، إلى جانب تحسينات استجابة المحادثات.",
      en: "New light and dark color palettes, a distinct state for skipped requests, a voice command to clear text while listening continues, and more responsive conversations.",
    },
    commits: ["7381b5f", "20c2467", "dccec1e", "7f2a39c", "08a34fa", "2f36ac8", "4abb132", "932b8a2", "be6e711", "839058e", "4f4e0c1"],
    changes: [
      {
        category: "features",
        title: {
          ar: "تمييز الطلبات المتخطّاة عن المكتملة",
          en: "Distinguish skipped requests from completed ones",
        },
        description: {
          ar: "تظهر الطلبات التي تخطّاها المستخدم بحالة مستقلة بدل احتسابها مكتملة، مع توضيح الحالة في بطاقة المهمة وسجل الطلبات.",
          en: "Requests skipped by the user now have their own state instead of appearing completed, shown consistently in task cards and request history.",
        },
        commits: ["dccec1e"],
      },
      {
        category: "features",
        title: {
          ar: "مسح النص بأمر صوتي من دون إيقاف الاستماع",
          en: "Clear text by voice without stopping dictation",
        },
        description: {
          ar: "قل «امسح الكلام كله» أو «Clear all text» لمسح محتوى حقل الكتابة، ثم واصل الإملاء في الجلسة نفسها.",
          en: "Say “Clear all text” or “start over” to clear the composer, then continue dictating in the same listening session.",
        },
        commits: ["dccec1e"],
      },
      {
        category: "improvements",
        title: {
          ar: "زر لمسح النص المكتوب من حقل الرسالة",
          en: "Clear typed text from the message composer",
        },
        description: {
          ar: "يظهر زر مسح بجوار أدوات الإرسال عند وجود نص، ويفرّغ الحقل من دون إزالة المرفقات.",
          en: "A clear button appears beside the composer actions when text is present and empties the field without removing attachments.",
        },
        commits: ["2f36ac8"],
      },
      {
        category: "uiux",
        title: {
          ar: "لوحات ألوان جديدة للثيمين الفاتح والداكن",
          en: "Refreshed color palettes for light and dark themes",
        },
        description: {
          ar: "تحديث ألوان الواجهة في الثيمين مع إبراز أوضح للحدود وتحسين تباين الوضع الفاتح.",
          en: "Refresh both theme palettes with clearer borders and improved contrast in light mode.",
        },
        commits: ["4abb132", "932b8a2"],
      },
      {
        category: "fixes",
        title: {
          ar: "إيقاف تكرار الكلام في الإملاء الصوتي على Android",
          en: "Prevent repeated words in Android voice dictation",
        },
        description: {
          ar: "معالجة إعادة إرسال المتصفح لمقاطع التعرّف حتى لا يتكرر الكلام في حقل الرسالة، مع تحسين التبديل بين حالات المايك ومعاينة الرد الحي.",
          en: "Handle recognition segments resent by the browser so dictated text is not duplicated, and improve microphone toggling and live reply previews.",
        },
        commits: ["20c2467", "be6e711"],
      },
      {
        category: "performance",
        title: {
          ar: "تحديثات محادثة أخف وأكثر استقرارًا",
          en: "Lighter, more stable conversation updates",
        },
        description: {
          ar: "تقليل إعادة معالجة الطلبات وإعادة رسم أجزاء المحادثة التي لم تتغير لتصبح التحديثات المتكررة أكثر سلاسة.",
          en: "Reduce repeated request processing and avoid re-rendering unchanged conversation sections for smoother updates.",
        },
        commits: ["839058e", "4f4e0c1"],
      },
      {
        category: "fixes",
        title: {
          ar: "إنهاء حالة الانشغال عند انتهاء التشغيل",
          en: "Clear the busy state when a run finishes",
        },
        description: {
          ar: "تعود المحادثة إلى حالتها الطبيعية عند انتهاء التشغيل حتى إن لم يرسل المحرك حدث الخمول المتوقع.",
          en: "The conversation returns to its idle state when a run finishes, even if the engine omits the expected idle event.",
        },
        commits: ["08a34fa"],
      },
    ],
  },
  {
    version: "v1.7.0",
    date: "2026-10-06",
    title: {
      ar: "قفل المايك ولصق الحافظة ومثبّتات النماذج على السيرفر",
      en: "Mic lock, clipboard paste, and server-side pinned models",
    },
    summary: {
      ar: "تثبيت الاستماع الصوتي حتى يفضل يسجّل مع كل وقفة، ولصق صورة أو نص من الحافظة مباشرة في الكومبوزر، ومثبّتات النماذج صارت على السيرفر فتنحفظ لكل الأجهزة، مع جداول Markdown تُعرض كجداول حقيقية.",
      en: "Lock voice dictation so it keeps recording through every pause, paste an image or text straight from the clipboard into the composer, move pinned models to the server so they are shared across devices, and render Markdown tables as real tables.",
    },
    commits: [
      "7decc6d",
      "b303a6a",
      "626ad3f",
      "bffa52a",
      "e82b53a",
      "96497f6",
      "607439e",
      "848404b",
      "29247d6",
      "a570296",
      "f32a242",
      "c6cc239",
      "4757294",
    ],
    changes: [
      {
        category: "features",
        title: {
          ar: "قفل الاستماع الصوتي ومبدّل لغة التعرّف بجوار المايك",
          en: "Lock voice dictation and switch its language beside the mic",
        },
        description: {
          ar: "زر قفل بجوار المايك يُبقي الاستماع شغّالًا مهما طال الصمت حتى يُفتح يدويًا، وزر اللغة يبدّل بين التلقائي والعربية والإنجليزية من غير فتح الإعدادات.",
          en: "A lock button beside the microphone keeps recognition running however long the silence lasts until you release it yourself, and a language button cycles between auto, Arabic, and English without opening settings.",
        },
        commits: ["626ad3f"],
      },
      {
        category: "features",
        title: {
          ar: "لصق صورة أو نص من الحافظة داخل الكومبوزر",
          en: "Paste a clipboard image or text into the composer",
        },
        description: {
          ar: "حقل الكتابة صار محرّرًا قابلًا للتحرير فتلتصق فيه صور الحافظة على الموبايل، وزر الصاق يقرؤ الحافظة مباشرة فيرسل الصورة مرفقًا ويضع النص في الحقل.",
          en: "The composer is now a rich editable field so clipboard images paste on mobile, and a paste button reads the clipboard directly, sending the image as an attachment and placing the text in the field.",
        },
        commits: ["29247d6", "a570296"],
      },
      {
        category: "features",
        title: {
          ar: "مثبّتات النماذج على السيرفر ومزامنة بين الأجهزة",
          en: "Pinned models on the server, synced across devices",
        },
        description: {
          ar: "حتى خمسة نماذج مثبتة بقت ملفًا على السيرفر تُبثّ لكل الأجهزة، فالتثبيت من الموبايل يوصل للويب والعكس، مع مزامنة أول مرة للقائمة المخزّنة محليًا.",
          en: "Up to five pinned models now live in a server file streamed to every device, so pinning on the phone reaches the web and vice versa, with a one-time merge of locally stored pins.",
        },
        commits: ["f32a242"],
      },
      {
        category: "features",
        title: {
          ar: "جداول Markdown تظهر كجداول حقيقية",
          en: "Markdown tables render as real tables",
        },
        description: {
          ar: "نتائج المهام وسجل المحادثات يفصلان جداول Markdown ويرسمونها بأعمدة ومحاذاة، بدل الأسطر المتكسّرة زي ما كانت تظهر.",
          en: "Task results and conversation history parse Markdown tables and render them with columns and alignment, instead of the broken pipe-separated lines they used to show.",
        },
        commits: ["4757294"],
      },
      {
        category: "features",
        title: {
          ar: "تنزيل شهادة الأمان من الإعدادات",
          en: "Download the security certificate from settings",
        },
        description: {
          ar: "زر في الإعدادات ينزّل شهادة الـ CA مباشرة على الهاتف، فثبتّها خطوة واحدة بدل البحث عنها في ملفات السيرفر قبل تشغيل المايك والإشعارات.",
          en: "A settings button downloads the CA certificate straight to the phone, so installing it is one step instead of hunting for it in the server files before enabling the mic and notifications.",
        },
        commits: ["b303a6a"],
      },
      {
        category: "improvements",
        title: {
          ar: "لغة التعرّف الفعّالة ظاهرة على زر المايك",
          en: "The mic button shows the effective recognition language",
        },
        description: {
          ar: "شارة صغيرة على الزر بتقول اللغة اللي الكلام هيتحوّل بيها فعلًا (ع للإنجليزية مثلًا) بدل كلمة «تلقائي» المبهمة، مع توحيد ألوان الشارات في الواجهة.",
          en: "A small badge on the button names the language speech is actually transcribed with (AR, EN, and so on) instead of the vague auto label, with badge colors unified across the UI.",
        },
        commits: ["7decc6d"],
      },
      {
        category: "improvements",
        title: {
          ar: "مستوى التفكير يتبع آخر موديل ضغطت عليه",
          en: "The thinking level follows the last model you tapped",
        },
        description: {
          ar: "اختيار موديل جديد في القائمة ينقل مستوى التفكير فورًا من غير انتظار رد السيرفر، فمستويات الموديل القديم ما تفضلش معروضة بعد الاختيار.",
          en: "Picking a new model in the list switches the thinking level immediately without waiting for the server, so the old model's levels no longer linger after the selection.",
        },
        commits: ["f32a242"],
      },
      {
        category: "improvements",
        title: {
          ar: "نغمة أوضح عند انتهاء المهمة",
          en: "A clearer tone when a task finishes",
        },
        description: {
          ar: "صوت اكتمال المهمة بقى ثلاث نغمات صاعدة مع طرقعة خشبية في أول كل نغمة بدل النغمتين المسطّحتين السابقتين.",
          en: "The task-completion sound is now three rising notes with a wooden knock on each instead of the two flat tones before.",
        },
        commits: ["b303a6a"],
      },
      {
        category: "fixes",
        title: {
          ar: "المايك ما بيقفلش عند أول وقفة قصيرة",
          en: "The mic no longer closes at the first short pause",
        },
        description: {
          ar: "بعد آخر كلمة في وضع الاستماع الحر بننتظر مهلة صمت قبل الإغلاق بدل ما المتصفح يقفل عند أول سكون في وسط الكلام، والوضع المقفول بيتجاهل المهلة خالص.",
          en: "After the last word, unlocked listening waits out a grace period before closing instead of the browser stopping at the first silence mid-sentence, and the locked mode ignores the timer entirely.",
        },
        commits: ["96497f6"],
      },
      {
        category: "fixes",
        title: {
          ar: "التفريغ الصوتي يفضل في سطر واحد",
          en: "Voice dictation stays on one line",
        },
        description: {
          ar: "محركات التعرّف كانت ترجع فواصل أسطر بين النتائج فتنكسر الجملة في نص الحقل، وبقت كل المسافات المتكررة والأسطر بتتطوى في مسافة واحدة.",
          en: "Recognition engines returned line breaks between results, which broke sentences mid-field; repeated spaces and newlines now collapse into a single space.",
        },
        commits: ["c6cc239"],
      },
      {
        category: "fixes",
        title: {
          ar: "جلسات المشروع تظهر في تطبيق الديسكتوب",
          en: "Project sessions show up in the desktop app",
        },
        description: {
          ar: "المسار كان يُمرَّر للمحرك كما هو، فاختلاف الشرطات أو حالة الأحرف على ويندوز كان يخزّن الجلسات بمفتاح مسار مختلف فتظهر موجودة في القاعدة ومخفية عن باقي العملاء؛ دلوقتي بيتوحّد على الصيغة المسجّلة عند المحرك.",
          en: "The path was passed to the engine as given, so a slash or drive-case difference on Windows stored sessions under a different key and left them in the database but hidden from other clients; it is now canonicalized to the engine's registered form.",
        },
        commits: ["607439e"],
      },
      {
        category: "performance",
        title: {
          ar: "بحث أسرع في منتقي النماذج",
          en: "Faster search in the model picker",
        },
        description: {
          ar: "النص المصغّر والترتيب وخريطة المفاتيح بتتحسب مرة واحدة لكل كتالوج بدل كل حرف، والنتايج بتتحدّث بقيمة مؤجّلة فالكتابة ما بتعلقش على الموبايل.",
          en: "Lowercased text, ordering, and the key map are computed once per catalog instead of per keystroke, and results update on a deferred value so typing never stalls on the phone.",
        },
        commits: ["f32a242"],
      },
      {
        category: "uiux",
        title: {
          ar: "أدوات الكومبوزر في شريط واحد فوق الحقل",
          en: "Composer tools in one toolbar above the field",
        },
        description: {
          ar: "أزرار الإرفاق واللصق والمايك صارت صفًا واحدًا فوق حقل الكتابة بدل ما تتناثر، والقفل معلّم كتجريبي بشارة تحت أيقونته.",
          en: "The attach, paste, and mic buttons now sit in a single row above the input instead of scattering, and the lock is marked experimental with a badge under its icon.",
        },
        commits: ["bffa52a", "e82b53a"],
      },
      {
        category: "technical",
        title: {
          ar: "بناء العميل تلقائيًا في وضع التطوير",
          en: "The client is built automatically in dev mode",
        },
        description: {
          ar: "تشغيل وضع التطوير بقى يبني الواجهة قبل ما يقف، فالهاتف اللي بيفتح أصل HTTPS بيشوف النسخة الحالية بدل حزمة قديمة من آخر بناء.",
          en: "Launching dev mode now builds the client before starting, so the phone opening the HTTPS origin sees the current bundle instead of a stale one from an earlier build.",
        },
        commits: ["848404b"],
      },
    ],
  },
  {
    version: "v1.6.0",
    date: "2026-10-05",
    title: {
      ar: "الإدخال الصوتي ومرفقات الرسائل مع HTTPS موثوق للهاتف",
      en: "Voice input, message attachments, and trusted phone HTTPS",
    },
    summary: {
      ar: "مايك يفرّغ كلامك داخل الكومبوزر بلغة تعرّف تختارها، وإرفاق صور وPDF وملفات نصية مربوط بقدرات النموذج، مع شهادة HTTPS موثوقة على الهاتف تفتح المايك والإشعارات وتتيح تثبيت التطبيق كـ PWA.",
      en: "A microphone transcribes your speech into the composer in a recognition language you choose, image/PDF/text attachments gated by model capabilities, and a locally trusted phone HTTPS certificate that unlocks the mic and push and lets the app be installed as a PWA.",
    },
    commits: ["18e82c4", "7500fc9"],
    changes: [
      {
        category: "features",
        title: {
          ar: "إدخال صوتي في الكومبوزر بلغة تعرّف قابلة للاختيار",
          en: "Voice input in the composer with a configurable recognition language",
        },
        description: {
          ar: "زر مايك بجانب حقل الكتابة يفرّغ الكلام لحظيًا داخل الحقل ويلصقه بعد المكتوب، مع اختيار لغة التعرّف من الإعدادات: تلقائي (لغة الجهاز) أو العربية أو English.",
          en: "A microphone button beside the composer transcribes speech live into the field and appends it after what is typed, with the recognition language chosen in settings: auto (device language), Arabic, or English.",
        },
        commits: ["18e82c4"],
      },
      {
        category: "features",
        title: {
          ar: "إرفاق صور وPDF وملفات نصية بالرسائل",
          en: "Attach images, PDFs, and text files to messages",
        },
        description: {
          ar: "زرّا إرفاق يضيفان حتى خمسة ملفات (4MB للواحد و5MB للإجمالي) مع شرائح للمعاينة والإزالة، ويمكن إرسال مرفق بلا نص. الأزرار تُقفل حسب قدرات إدخال النموذج المختار.",
          en: "Two attach buttons add up to five files (4MB each and 5MB in total) with preview chips and removal, and an attachment can be sent with no text. The buttons disable according to the selected model's input capabilities.",
        },
        commits: ["7500fc9"],
      },
      {
        category: "features",
        title: {
          ar: "تثبيت التطبيق كـ PWA على الهاتف",
          en: "Install the app as a PWA on the phone",
        },
        description: {
          ar: "مع أصل HTTPS موثوق يعمل التطبيق في سياق آمن، فيظهر زر التثبيت في الإعدادات وتُضاف RemoteCode إلى الشاشة الرئيسية وتُفتح بلا شريط المتصفح.",
          en: "On a trusted HTTPS origin the app runs in a secure context, so the install button appears in settings and RemoteCode can be added to the home screen and opened without the browser chrome.",
        },
        commits: ["7500fc9"],
      },
      {
        category: "improvements",
        title: {
          ar: "HTTPS موثوق للهاتف يفعّل المايك والإشعارات",
          en: "Trusted phone HTTPS unlocks the microphone and push",
        },
        description: {
          ar: "المشغّل يولّد شهادة موثوقة محليًا عبر mkcert ويثبت مساريها في .env ويطبع ملف CA للمتصفح، ووكيل Vite يتبع بروتوكول TLS تلقائيًا.",
          en: "The launcher generates a locally trusted certificate via mkcert, wires its paths into .env, and prints the CA file for the phone, while the Vite proxy follows TLS automatically.",
        },
        commits: ["7500fc9"],
      },
      {
        category: "technical",
        title: {
          ar: "تحقق مرفقات على السيرفر وسقف حمولة أوسع",
          en: "Server-side attachment validation and a larger payload limit",
        },
        description: {
          ar: "فحص نوع المرفق وحجمه وقدرات النموذج قبل تمريره للمحرك، ورفع سقف JSON إلى 8MB، والسماح بالمايك لنفس الأصل في Permissions-Policy.",
          en: "Attachment type, size, and model capability are checked before reaching the engine, the JSON limit is raised to 8MB, and Permissions-Policy allows the microphone for the same origin.",
        },
        commits: ["18e82c4", "7500fc9"],
      },
    ],
  },
  {
    version: "v1.5.0",
    date: "2026-10-03",
    title: {
      ar: "تبديل فروع Git وملاحظات الإصدار وبطاقات مهام أوضح",
      en: "Git branch switching, release notes, and clearer task cards",
    },
    summary: {
      ar: "تبديل الفرع مباشرة من درج Git ببحث فوري، وملاحظات إصدار مزدوجة اللغة من تاريخ المستودع، وبطاقات مهام مصنّفة حسب مرحلة التشغيل مع رد حي منتظم.",
      en: "Switch branches straight from the Git drawer with live search, bilingual release notes derived from repo history, and task cards phased by stage with a consistently spaced live reply.",
    },
    commits: ["1b3de3a", "eeecdf5", "da77e6d", "3f437a1", "f426267", "29b79df", "3fd1901", "5e3836c"],
    changes: [
      {
        category: "features",
        title: {
          ar: "تبديل فروع Git من درج التغييرات",
          en: "Switch git branches from the changes drawer",
        },
        description: {
          ar: "منتقي فروع قابل للبحث ينقل مجلد العمل مباشرة على السيرفر من غير طلب في المحادثة، ويرفض النقل بأمان عندما تتعارض التغييرات المحلية.",
          en: "A searchable branch picker switches the working tree straight on the server without a conversation request, safely refusing when local changes would be overwritten.",
        },
        commits: ["5e3836c"],
      },
      {
        category: "features",
        title: {
          ar: "ملاحظات إصدار مزدوجة اللغة من تاريخ Git",
          en: "Bilingual release notes from git history",
        },
        description: {
          ar: "لوحة ملاحظات إصدار تُعرض في التطبيق وتعتمد على تاريخ المستودع، مع سكربت يطبع دفعات الـ commits الجديدة لإضافة الإصدارات التالية.",
          en: "An in-app release notes panel built from repository history, with a script that prints new commit batches for adding future releases.",
        },
        commits: ["1b3de3a"],
      },
      {
        category: "improvements",
        title: {
          ar: "بطاقات مهام مصنّفة حسب مرحلة التشغيل",
          en: "Task cards themed by running phase",
        },
        description: {
          ar: "خلفية الكارت والرموز تعكسان مرحلة المهمة (تعمل/تنتظر/عالقة/خطأ/اكتملت)، والحالة الجارية تنتقل عبر الطابور بوضوح.",
          en: "The card background and icons reflect the task stage (running/waiting/stuck/error/completed), and the running state flows clearly through the queue.",
        },
        commits: ["eeecdf5", "3f437a1"],
      },
      {
        category: "improvements",
        title: {
          ar: "لوحة حالة موحدة في صفوف الطلبات",
          en: "Shared status panel across request rows",
        },
        description: {
          ar: "إعادة استخدام لوحة الحالة في صفوف الطلبات وصياغة رسالة الاكتمال بأوضح شكل مع شدّ المسافات الرأسية.",
          en: "Reuse the status panel in request rows, reword the completion message for clarity, and tighten vertical spacing.",
        },
        commits: ["f426267", "29b79df"],
      },
      {
        category: "fixes",
        title: {
          ar: "جمع ملفات النتائج من أداة الكتابة بدون لقطة git",
          en: "Collect result files from write tool calls without a git snapshot",
        },
        description: {
          ar: "ملفات المهمة النهائية تُلتقط من أدوات الكتابة حتى لو لم تكن هناك لقطة git تحقق ذلك تلقائيًا.",
          en: "Final task files are captured from write tool calls even when no git snapshot would capture them automatically.",
        },
        commits: ["da77e6d"],
      },
      {
        category: "fixes",
        title: {
          ar: "لصق الرد الحي بسطر واحد بدل سطر فارغ بعد كل سطر",
          en: "Join the live reply with single newlines instead of a blank line after each line",
        },
        description: {
          ar: "أجزاء رد المساعد المتدفقة كانت تُلصق بسطرين فيظهر سطر فارغ بعد كل سطر طول ما الرد يُكتب — أصبح اللصق بسطر واحد مع الحفاظ على الفقرات الداخلية.",
          en: "Streamed assistant parts were joined with double newlines, leaving a blank line after every line while typing — now joined with a single newline while preserving inner paragraphs.",
        },
        commits: ["3fd1901"],
      },
    ],
  },
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
