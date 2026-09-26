// تجمع worker محدود لمهام async — يمنع fan-out غير محدود (مثل إرسال push
// لكل الاشتراكات لحظيًا) مع الحفاظ على ترتيب النتائج
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}
