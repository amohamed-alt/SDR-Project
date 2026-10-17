# Meeting Creator — السعودية: دليل التشغيل اليومي (100 + 100)

**الهدف التشغيلي:** 100 Lead لـ Marita (Talentera) + 100 لـ Daniel (Evalufy) في يوم العمل السعودي، وليس وعدًا مضمونًا بـ200 أرقام شغالة يوميًا. القيمة الفعلية دائمًا هي `created` من HubSpot، وليس `selected` أو عدد شركات Apollo.

## الوصول

- Dashboard: https://sdr.dashboardtalentera.tech/meeting-creator
- GitHub scheduled run: https://github.com/amohamed-alt/SDR-Project/actions/workflows/marita-phone-first-daily.yml
- Admin authentication required for contact data and CRM writes.

## لو شركة عليها Wrong Number وشخص واحد

1. من **Lead source** اختار **Wrong number recovery** بدل Cached inventory.
2. اختار **Find another person** من Status، أو ابحث باسم الشركة في صفحات المصدر.
3. الشخص القديم مع رقم Wrong Number يظهر كسجل **needs_alternate**، لكن رقم الاتصال لا يُعرض كـCall-ready.
4. اضغط **Find alternate (free)** للبحث عن HR Director / TA / Recruitment Decision Maker مختلف. النتيجة من SignalHire **search-only** بلا أرقام أو إيميلات، وبلا paid contact reveal.
5. لو مفيش بديل مؤكد، الشركة تفضل في Research backlog. لو لقينا اسمًا جديدًا، فخطوة مستقلة لاحقة لازم تجيب وتؤكد رقمًا مختلفًا مرتبطًا به وتربط الشخص بالشركة في HubSpot؛ بعدها إعادة فحص CRM ممكن ترفعه Call-ready.
6. لا تلمس الشركات التي لديها connected call، meeting، deal/retention، رد إيجابي، أو task مفتوح/مؤجل.
7. الحفاظ على الـSDR الذي بدأ المحاولات السابقة مهم: لا تنقل الشركة بين Marita وDaniel بالخطأ.

## Daily automation

- الجدولة: **الأحد–الخميس 09:15 صباحًا بتوقيت السعودية** (GitHub Actions cron `15 6 * * 0-4`). قد يتأخر وقت التنفيذ قليلًا تبعًا لمشغّل GitHub.
- تستخدم نفس ملف Workflow القديم Marita Phone First، بعد تحويله لتشغيل **SDR الاثنين**؛ **لا توجد مهمة مجدولة ثانية منافسة**.
- عند تعديل Workflow على main: أول تنفيذ `push` هو **Dry Run فقط**. التنفيذ المجدول لاحقًا يستخدم CRM Push للحالات المؤهلة.
- مصدر 1: Existing Acquisition Inventory / Postgres.
- مصدر 2: Historical HubSpot **Wrong Number** call events، مستقل عن حالة الشركة في المخزون.
- قبل إنشاء أي CALL task: يُقرأ تاريخ الشركة وكل Contacts المرتبطين، Calls/Meetings/Deals/Open Tasks، ويتم التأكد من اختلاف الشخص والرقم، السعودية، headcount 250+، Ownership، وعدم تغيير بيانات CRM في هذه اللحظة.
- `Call-ready`: سجل موجود في HubSpot لشخص مناسب ومعه رقم سعودي بتنسيق صالح؛ **ليس ضمانًا لتوصيل المكالمة**.
- `Needs alternate`: الشركة ذات محاولة خاطئة/فاشلة ولا يوجد شخص جديد صالح؛ يسمح ببحث جديد ولا يسمح بإنشاء Task.
- `Needs research`: بيانات ناقصة، هوية شركة غير مؤكدة، أو ارتباط مكالمة غير واضح.
- `Protected`: Connected Call أو Task مفتوح أو Meeting أو Deal/Customer/Retention أو ملكية RM تمنع تكرار التواصل.
- المخطط يعمل على **100 لكل SDR** كهدف، ويتوقف عن Reactivation عند 25% من الدفعة، ويُظهر `shortfall` عندما المخزون أقل.
- **Cost:** صفر Apollo/SignalHire contact reveal credits، ولا أي إرسال Cold Email/WhatsApp/LinkedIn من هذه الآلية. استخدام SignalHire Search يستهلك quota بحث مجانية فقط، وهو محدود إلى 20 شركة / يوم عند توفر API.
- **Idempotency:** Task scheduler يحجز الشركة والـContact قبل POST ويرفض محاولة إعادة الكتابة غير المؤكدة؛ أي Timeout في POST لا يُعاد إرساله آليًا.
- `created` = Tasks تم تأكيد إنشاءها؛ `selected` = مرشحون، و`shortfall` لازم يتقري مع الاتنين.
- الجدول يُسند مهام CALL داخل حدود 100 مهمة مفتوحة/محجوزة لكل SDR في اليوم المجدول، ويأخذ الـbacklog بعين الاعتبار؛ **قد يكون due date في يوم عمل لاحق وليس يوم الاكتشاف**. المهمة تُنشأ اليوم وتُحدد لها أول نافذة آمنة طبقًا لجدول السعة.

## خطوات المستخدم

ادخل Dashboard → Tools unlock → **Meeting Creator Daily Queue**. شوف Source وStatus وSDR. للسجلات `Call-ready` اختار حتى 10 صفوف واضغط **Push selected to HubSpot**، وافق على التأكيد. عند النجاح يظهر العدد الذي أنشئ بالفعل، والـContact/Company/SDR owner محفوظين. عند الفشل، راجع سبب الحظر ولا تعيد إنشاء Task مجهولة النتيجة قبل المصالحة.

## ملاحظة قدرة الإنتاج

200 phone-ready contacts/day ×22 يوم ≈ **4400 شخص مؤهل في الشهر**، ويتطلب تغذية مستمرة: شركات جديدة، أشخاص مختلفون، verified phone coverage، وCredits للكشف إذا البيانات الحالية لا تغطي الاحتياج. لا يخلق الـScoring ولا البحث المجاني أرقام هواتف من العدم. **تم تعطيل Paid Reveals تلقائيًا حتى يحدد المسؤول Budget واضح للـCredits اليومية.**
