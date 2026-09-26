import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // build السيرفر بيصرّف server/**/*.ts (منهم ملفات الاختبار) في dist-server،
    // و vitest بيلقط *.test.js هناك — فبدون الاستبعاد كل اختبار بيشتغل مرتين
    // والنتايب بتتضاعف. ملفات المصدر نفسها بتفضل متشمولة زي ما هي.
    exclude: [...configDefaults.exclude, "dist-server/**"],
  },
})
