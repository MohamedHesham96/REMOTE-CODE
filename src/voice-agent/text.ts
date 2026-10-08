// استبدال عناصر القوالب النصية "{name}" بقيمها — الحاجة موجودة في أكثر من
// وحدة (المخطّط والسجل)، والنسخة الواحدة بتمنع انحراف الصياغة بينهم.
export function fillTemplate(template: string, values: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(`{${key}}`, value)
  }
  return result
}
