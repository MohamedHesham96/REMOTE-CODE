import type { Language } from "../i18n"
import type { GitChangeFile } from "../types"

// سقف سطور القائمة في الطلب: البوت بيقرأ طلب طويل وبيرد بالساعات، والقائمة
// الطويلة ما بتضيفش حاجة لقرار الـ commit أو الـ revert.
const MAX_LISTED_FILES = 50

function listFiles(files: GitChangeFile[]): string {
  return files.slice(0, MAX_LISTED_FILES).map((file) => `- ${file.path} (${file.status})`).join("\n")
}

// طلب commit للتغييرات كلها — نفس منطق زرار الـ commit في قائمة git.
export function commitPrompt(files: GitChangeFile[], branch: string, lang: Language): string {
  const fileLines = listFiles(files)
  return lang === "ar"
    ? `اعمل commit لكل التغييرات الحالية في git${branch ? ` على الفرع '${branch}'` : ""}.\nخطواتك:\n1) راجع git status و git diff.\n2) اعمل git add للملفات المتغيرة.\n3) اعمل commit برسالة واضحة ومختصرة.\nالملفات المتغيرة:\n${fileLines}\nممنوع تعمل push.`
    : `Commit all current git changes${branch ? ` on branch '${branch}'` : ""}.\nSteps:\n1) Review git status and git diff.\n2) git add the changed files.\n3) Commit with a clear, concise message.\nChanged files:\n${fileLines}\nDo not push.`
}

// طلب push للفرع الحالي.
export function pushPrompt(branch: string, lang: Language): string {
  return lang === "ar"
    ? `اعمل push${branch ? ` للفرع '${branch}'` : ""}.\nمفيش ملفات متغيرة تتضاف — الـ push بيبعت الـ commits الموجودة بس.`
    : `Push${branch ? ` branch '${branch}'` : ""}.\nThere are no new files to add — the push only sends existing commits.`
}

// طلب pull للفرع الحالي.
export function pullPrompt(branch: string, lang: Language): string {
  return lang === "ar"
    ? `اعمل pull${branch ? ` للفرع '${branch}'` : ""}.\nجيب آخر التغييرات من الفرع البعيد ودمجها مع المحلي.`
    : `Pull${branch ? ` branch '${branch}'` : ""}.\nFetch the latest changes from the remote branch and merge them with the local one.`
}

// commit لوحده بدون push: الحفظ محلي وقابل للتراجع بـ reset في أي وقت، فمفيش
// سبب ياخد خطوة تأكيد زي زرار الـ commit & push.
export function commitPrompt(files: GitChangeFile[], branch: string, lang: Language): string {
  const fileLines = listFiles(files)
  return lang === "ar"
    ? `اعمل commit للتغييرات الحالية في git بدون push${branch ? ` على الفرع '${branch}'` : ""}.\nخطواتك:\n1) راجع git status و git diff.\n2) اعمل git add للملفات المتغيّرة.\n3) اعمل commit برسالة واضحة ومختصرة.\nالملفات المتغيّرة:\n${fileLines}\nممنوع تعمل push. لو مفيش حاجة تتعملها commit، قولها بوضوح ومتعملش حاجة بالنيابة عني.`
    : `Commit the current git changes without pushing${branch ? ` on branch '${branch}'` : ""}.\nSteps:\n1) Review git status and git diff.\n2) git add the changed files.\n3) Commit with a clear, concise message.\nChanged files:\n${fileLines}\nDo not push. If there is nothing to commit, say so clearly and do nothing on my behalf.`
}

// pull من الفرع البعيد — عكس الـ push. الطلب بيقف عند أول تعارض ويعرضه بدل ما
// يختار نسخة ويمسح التانية، لأن القرار ده راجع للمستخدم مش للوكيل.
export function pullPrompt(branch: string, lang: Language): string {
  return lang === "ar"
    ? `اسحب آخر التحديثات من الفرع البعيد${branch ? ` '${branch}'` : ""} في مجلد العمل.\nخطواتك:\n1) راجع git status وقل إيه التغييرات المحلية الحالية قبل السحب.\n2) اسحب التحديثات بـ git pull.\n3) لو ظهر تعارض، وقّف واشرحه قبل أي حل — ممنوع تختار نسخة وترمي التانية.\nممنوع تعمل commit أو push.`
    : `Pull the latest updates from the remote${branch ? ` for branch '${branch}'` : ""} into the working tree.\nSteps:\n1) Review git status and tell me what local changes exist before pulling.\n2) Pull the updates with git pull.\n3) If a conflict appears, stop and explain it before resolving anything — do not pick a side and discard the other.\nDo not commit or push.`
}

// التراجع عن ملف واحد. صيغة الأمر بتختلف على حسب حالة الملف: الملف الجديد
// (added) مش متتبَّع في git أصلًا فمفيش له نسخة يرجع لها، فالتراجع عنه = حذفه.
// أما المعدَّل والمحوذ فـ "restore" بيرجّعهم من الـ index أو من آخر commit.
export function revertFilePrompt(file: GitChangeFile, lang: Language): string {
  const untracked = file.status === "added"
  return lang === "ar"
    ? `تراجع عن التغييرات في ملف واحد بس: '${file.path}'.\n${untracked
        ? "الملف جديد ومش متتبَّع في git، فامسح الملف من القرص."
        : "ارجع الملف لحالته قبل التغيير بـ git restore، ولو التعديل متعمله add فاستخدم git restore --staged."}\nممنوع تلمس أي ملف تاني، وممنوع تعمل commit.\nبعد ما تخلص، اعمل git status وقولي إيه اللي اتغيّر فعلًا.`
    : `Discard the changes in exactly one file: '${file.path}'.\n${untracked
        ? "The file is new and untracked in git, so delete it from disk."
        : "Bring the file back to its pre-change state with git restore, or git restore --staged if the change was already added."}\nDo not touch any other file, and do not commit.\nAfterwards run git status and tell me what actually changed.`
}

// التراجع عن كل التغييرات غير المُودَعة — عملية مدمّرة لأن الشغل غير
// المحفوظ بيضيع نهائيًا، فالطلب نفسه بيحذّر والبنية بتفرض تأكيد قبل الإرسال.
export function revertAllPrompt(files: GitChangeFile[], lang: Language): string {
  const fileLines = listFiles(files)
  return lang === "ar"
    ? `تراجع عن كل التغييرات غير المُودَعة في مجلد العمل (التراجع النهائي).\nخطواتك:\n1) راجع git status.\n2) ارجع الملفات المتتبَّعة لحالتها الأصلية بـ git restore.\n3) احذف الملفات الجديدة غير المتتبَّعة (المُضافة) من القرص.\n4) امسح أي تعديلات على الـ staging area بدون ما تعمل commit.\nالملفات المتاحة للتراجع عنها:\n${fileLines}\nممنوع تعمل commit أو push. لو التراجع الكامل مالوش معنى لحالة معينة وضّحها قبل ما تنفذ.`
    : `Discard every uncommitted change in the working tree (final rollback).\nSteps:\n1) Review git status.\n2) Restore all tracked files to their original state with git restore.\n3) Delete the new untracked (added) files from disk.\n4) Clear any staging-area changes without committing.\nFiles available to revert:\n${fileLines}\nDo not commit or push. If a full revert makes no sense for some file, say so before you run anything.`
}
