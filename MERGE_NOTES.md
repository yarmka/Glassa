# Glassa — Replit UI + production structure merge

هذه النسخة مبنية على نسخة Replit الأخيرة كنسخة المصدر الأساسية للواجهة.

## ما تم الاحتفاظ به من Replit
- تصميم React/Tailwind الجديد بالكامل.
- جميع الصفحات والمكونات والإضافات الموجودة في نسخة Replit.
- Firebase Auth / Firestore / Cloudinary / EmailJS integrations.
- السلة والطلبات والكوبونات والإدارة والموظفون والصلاحيات وطلبات الألعاب والإعلانات والنوافذ المنبثقة.
- بنية workspace وVite وpnpm وملفات Replit.
- `firestore.rules` الموجودة مع المشروع.
- API server الموجود تحت `artifacts/api-server`.

## ما لم يتم نقله
لم يتم إدخال واجهة المشروع القديم أو ملفات JavaScript القديمة (`app.js`, `catalog.js`, `cart.js`, `admin.js`, `ui.js`) داخل التطبيق الجديد، حتى لا يرجع التصميم أو منطق الواجهة القديم ويتعارض مع React.

## طبقة السيرفر
الـ API server محفوظ تحت:

`artifacts/api-server`

وهو حاليًا مسؤول عن API health endpoint على:

`/api/healthz`

أما عمليات المتجر الأساسية فتظل مرتبطة بـ Firebase كما صُممت في نسخة Replit. لا تعتبر أي بيانات سرية في الواجهة العامة آمنة؛ أمان Firestore يجب أن يبقى مفروضًا من `firestore.rules`.

## التحقق
تم فحص ملفات TypeScript/TSX في المشروع بفحص parser الخاص بـ TypeScript بدون تنفيذ التطبيق، ولم تظهر أخطاء syntax في ملفات المشروع المصدرية.
