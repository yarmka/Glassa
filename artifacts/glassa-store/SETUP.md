# Glassa — setup

## العربية

1. في `src/lib/config.ts` استبدل `OWNER_EMAIL_HERE` ببريد المالك بصيغة أحرف صغيرة. أو عيّن `VITE_OWNER_EMAIL` في إعدادات البيئة. استخدم البريد نفسه في ملف `firestore.rules` بدلاً من `OWNER_EMAIL_HERE`.
2. في Firebase Console فعّل تسجيل الدخول بالبريد وكلمة المرور، وأنشئ قاعدة بيانات Firestore.
3. افتح Firestore → Rules، والصق محتوى `firestore.rules` بعد استبدال بريد المالك، ثم اضغط Publish. لا تفتح صلاحيات Firestore العامة.
4. سجّل حساب المالك من صفحة التسجيل في الموقع، ثم سجّل الدخول بالطريقة المعتادة. لا يوجد رمز مرور منفصل للمالك.
5. بعد إنشاء حساب موظف، افتح لوحة المالك ثم إدارة الموظفين. أدخل بريده واختر صلاحياته واحدةً واحدة. لا يستطيع الموظف فتح لوحة المالك أو منح صلاحيات لغيره.
6. أضف بيانات EmailJS إلى حساب EmailJS أو حدّث الإعدادات العامة في `src/lib/config.ts`. يلزم قالب تحقق يستقبل `to_email` و`passcode` و`time`، وقالب دفع يستقبل `to_email` و`customer_name` و`order_id` و`games` و`total` و`code` و`site_url`.
7. رفع الصور يتطلب Cloudinary unsigned upload preset باسم `glassa_unsigned` ومقيّداً برفع الصور فقط.
8. اختبر تسجيل عميل، البحث، إضافة الألعاب للسلة، إنشاء طلب نقدي، اعتماده أو رفضه، ثم إدخال رمز الدفع واختبار تنزيل لعبة اشتراها العميل.

## English

1. Replace `OWNER_EMAIL_HERE` in `src/lib/config.ts` with the owner's lowercase email, or set `VITE_OWNER_EMAIL`. Replace the same placeholder in `firestore.rules`.
2. In Firebase Console, enable Email/Password sign-in and create a Firestore database.
3. Open Firestore → Rules, paste `firestore.rules` with the owner's email filled in, and publish. Do not make Firestore publicly writable.
4. Register the owner through the regular sign-up page and use the regular login form. There is no separate owner password.
5. Register each staff member as a user first. From the owner panel, enter their email and select permissions individually. Staff cannot open the owner panel or grant access to other people.
6. Configure EmailJS templates with the parameters documented above. Verification emails require `to_email`, `passcode`, and `time`; payment emails require `to_email`, `customer_name`, `order_id`, `games`, `total`, `code`, and `site_url`.
7. Image uploads require a restricted Cloudinary unsigned upload preset named `glassa_unsigned`.
8. Test customer signup, browsing, cart checkout, owner approval/rejection, payment-code entry, and downloads for purchased games.

## Permission levels

- **View orders** — read order details only.
- **Process orders** — view orders, mark pending orders paid or rejected, and issue the payment code.
- **Manage games** — create, edit, hide, and remove games and their private download links.
- **Manage coupons** — create, edit, deactivate, and remove coupons.
- **Manage popups** — create, edit, activate, and remove popups.
- **Manage requests** — review game requests and broken-link reports.
- **Manage announcements** — edit the Arabic and English announcement bar.

The owner always has full access. Staff permissions are enforced by the Firestore rules as well as hidden in the interface. The staff member must already have a registered account using the email entered by the owner.

## Notes

- The six-digit signup code is generated and checked in the browser. It is a convenience check, not a hard security boundary.
- Customers' order totals originate in the browser. The owner must verify the cash total before marking an order paid.
- EmailJS quotas and spam filtering are controlled by the EmailJS account.
- Game download links are private Firestore documents and are readable only by the owner or a customer who unlocked that game.
