# OpenCode Mobile PWA

واجهة محادثة محلية للتواصل مع OpenCode من الموبايل داخل نفس الشبكة.

## التشغيل

```powershell
cd pwa
npm install
npm run setup
npm run build
npm start
```

ثم افتح `http://<IP-جهاز-الكمبيوتر>:7171` من الموبايل، واستخدم رمز الوصول الموجود في `pwa/.env`.

للتطوير مع إعادة التحميل التلقائي:

```powershell
npm run dev
```

## Web Push والتثبيت

Web Push يحتاج إلى HTTPS أو `localhost`. على الشبكة المحلية، أنشئ شهادة موثوقة للجهاز أو استخدم tunnel آمن، ثم ضع مسار الشهادة والمفتاح في `pwa/.env`:

```dotenv
APP_TLS_CERT_PATH=./certs/localhost.pem
APP_TLS_KEY_PATH=./certs/localhost-key.pem
```

بعد ذلك شغّل `npm run build` و`npm start`، ثم فعّل Web Push من الإعدادات داخل التطبيق.

## الأمان

- لا تفتح `opencode serve` على الشبكة؛ التطبيق يبدأ خادم OpenCode محليًا على `127.0.0.1` فقط.
- رمز الوصول وVAPID private key موجودان في `pwa/.env`، وهو مستبعد من Git.
- لا ترسل ملفات `.env` أو الشهادات الخاصة إلى أي شخص.
- عند تغيير `APP_ACCESS_TOKEN`، سيتغير رمز الدخول لجميع الأجهزة.

## أوامر التحقق

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```
