import { execFile } from "node:child_process"

// عدد الـ commit اللي على الفرع المحلي ومش وصل للفرع البعيد.
//
// الـ SDK بتاع opencode مفيش فيها endpoint لـ ahead/behind: namespace الـ vcs
// بتدي الملفات والفرع والـ base بس. فبنشغّل git مباشرة — ونجيبها من ملف
// مستقل لأن opencode.ts كبير أصلًا.
//
// `git rev-list --count @{upstream}..HEAD` هو المصدر المعتمد للعدد ده: بيعدّ
// الـ commits اللي بعد نقطة الـ upstream بالظبط، فمش بيحسب أي حاجة على
// branches تانية ولا بيخلي الـ merge يضاعف العد.
//
// أي فشل = صفر مش استثناء، وده مقصود في كل الحالات:
//   - مفيش upstream متظبط (أول commit في repo، أو repo بلا remote): مفهوم
//     "غير مدفوع" نفسه مش موجود، فصفر هو العرض الصح مش رقم مخترع.
//   - clone ناقص (shallow) أو remote لسه متسحَبش: الـ ref مش موجود.
//   - المجلد أصلاً مش git: الطلب بيوصل لمجلد عادي.
// العرض الغلط أسوأ من الصفر: الصفر معناه "مفيش حاجة مستنية push" وده
// بيفتح للمستخدم طريق، والرقم المخترع بيخليه يدوّر على commits مش موجودة.

const GIT_TIMEOUT_MS = 10_000

// بيرجّع stdout أو null عند أي فشل (غير مستودع، مفيش git مثبّت، مهلة).
function runGit(directory: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    // `windowsHide` عشان ما تفتحش نافذة console لحظية على Windows: أمر git
    // بيخلص في أجزاء من الثانية، والنافذة اللي بتظهر وبتختفي بتبوّض.
    // `git` نفسه ملف .exe على Windows فمش محتاج cmd /c زي شغلة opencode.
    execFile("git", args, { cwd: directory, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout)
    })
  })
}

export async function unpushedCommitCount(directory: string): Promise<number> {
  const stdout = await runGit(directory, ["rev-list", "--count", "@{upstream}..HEAD"])
  if (stdout === null) {
    return 0
  }
  const count = Number.parseInt(stdout.trim(), 10)
  return Number.isFinite(count) && count > 0 ? count : 0
}
