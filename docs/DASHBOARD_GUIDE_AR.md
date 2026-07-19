# دليل SDR Command Center

هذا الملف يشرح بالتفصيل ما تعرضه لوحة **Talentera SDR Command Center**، وكيف تُحسب الأرقام، وما هي حقول HubSpot المستخدمة، وكيف يعمل الانتقال من اللوحة إلى السجلات الأصلية في HubSpot.

رابط اللوحة الحية:

- <https://sdr.dashboardtalentera.tech>

## 1. الهدف من اللوحة

اللوحة تجمع في مكان واحد أداء الـSDR والـContacts والشركات والأنشطة المرتبطة بهم، وتشمل:

- حجم الـSDR portfolio والـContacts الجدد.
- المكالمات ونسبة الاتصال ونتائج المكالمات.
- الاجتماعات التي تم إنشاؤها، حالتها، مصدرها، ومن تم إسنادها إليه.
- الـTasks المفتوحة والمكتملة والمتأخرة والمستحقة غدًا.
- رسائل المبيعات والـopens والـclicks والـreplies.
- Original Traffic Source وLatest Traffic Source وRecord Source.
- الـContacts التي دخلت من Integration وخصوصًا `Extensive-Lighter`.
- جودة بيانات البريد والهاتف وLinkedIn والشركة والدولة والـICP.
- الشركات والدول والصناعات والـATS المكتشف.
- الـDeals والـpipeline المرتبطة بالـContacts المملوكة للـSDR.
- روابط مباشرة إلى السجلات الأصلية في HubSpot.

## 2. نطاق البيانات الافتراضي

| الإعداد | القيمة الافتراضية |
|---|---|
| SDR Owner | Marita Chedid |
| SDR Owner ID | `31644369` |
| بداية التقرير | 1 يوليو 2026 |
| المنطقة الزمنية | Asia/Riyadh — UTC+3 |
| مصدر البيانات | HubSpot Live API |
| مدة الكاش | 15 دقيقة |

> **مهم:** رقم SDR Portfolio يمثل الحالة الحالية للـContacts التي قيمة `sdr_owner` عندها هي Marita. لا يمثل عدد الـContacts الذين تم إسنادهم إليها تاريخيًا خلال الفترة.

## 3. الفلاتر

يمكن فتح الفلاتر من زر الفلتر أعلى اللوحة.

### فلاتر التاريخ

- **From:** بداية الفترة.
- **To:** نهاية الفترة.
- **Today:** اليوم الحالي.
- **This week:** بداية أسبوع العمل الحالي حتى اليوم.
- **This month:** بداية الشهر الحالي حتى اليوم.
- **Since 1 July:** من 1 يوليو 2026 حتى اليوم.

### فلاتر الـContact cohort

- Country.
- Original Traffic Source.
- Latest Traffic Source.
- ICP Tier.
- Persona.

عند تطبيق هذه الفلاتر، يتم أولًا تحديد مجموعة الـContacts المطابقة، ثم تُفلتر المكالمات والاجتماعات والـTasks والـEmails والـDeals عن طريق HubSpot associations حيثما تكون متاحة.

القيمة التي تظهر للمستخدم هي **HubSpot display label** وليست الـinternal value. تستخدم الـinternal values في الخلفية فقط لتنفيذ الفلتر.

## 4. Overview

### بطاقات الـKPIs

| البطاقة | ما تعرضه | طريقة الحساب |
|---|---|---|
| SDR Portfolio | كل الـContacts المملوكة حاليًا للـSDR | `sdr_owner = selected owner` |
| Created in period | الـContacts الجديدة داخل الفترة | `createdate` بين From وTo داخل الـportfolio الحالي |
| Companies | عدد الشركات المختلفة المرتبطة بالـContacts | Unique populated `company_id` |
| Calls | المكالمات المملوكة للـSDR داخل الفترة | `hubspot_owner_id` مع `hs_timestamp` |
| Connection Rate | نسبة المكالمات المتصلة | Connected Calls ÷ All Calls |
| Meetings | الاجتماعات التي أنشأها الـSDR بعد إزالة التكرار | `hs_created_by_user_id` مع `hs_createdate` |
| Completed Meetings | الاجتماعات ذات النتيجة Completed | Meeting Outcome = Completed |
| Open Tasks | الـTasks غير المكتملة حاليًا | Not Started + In Progress + Waiting + Deferred |
| Due Tomorrow | الـTasks المفتوحة المستحقة غدًا | Task due date في اليوم التالي |
| Email Reply Rate | نسبة رسائل المبيعات التي حصلت على Reply | Emails with reply ÷ outgoing emails |
| Open Deals | الـDeals المفتوحة المرتبطة بالـContacts | Associated deals where `hs_is_closed != true` |
| Open Pipeline | قيمة الـDeals المفتوحة | مجموع `amount_in_home_currency` ثم `amount` كبديل |

الضغط على أي KPI يفتح قائمة الـobject المقابل داخل HubSpot.

### Daily SDR Execution

الرسم اليومي يعرض:

- Calls.
- Connected Calls.
- Completed Tasks.
- Meetings Booked.
- Emails Sent.

كل نشاط يتم وضعه في اليوم الخاص به باستخدام منطقة HubSpot الزمنية `Asia/Riyadh`.

### SDR Conversion Funnel

المراحل المعروضة:

1. Portfolio.
2. Contacted.
3. Connected.
4. Meeting.
5. Deal.
6. Open Deal.

المراحل التي تعتمد على نشاط تستخدم HubSpot associations للوصول إلى الـContact المرتبط بالنشاط.

### Operational Alerts

تظهر التنبيهات ذات العدد الأكبر من صفر فقط، ومنها:

- Tasks due tomorrow.
- Overdue Tasks.
- Tier A untouched.
- Wrong phone numbers.
- Missing meeting outcomes.
- Missing Original Traffic Source.

الضغط على التنبيه يفتح قائمة الـContacts أو الـTasks المناسبة داخل HubSpot.

### Priority Leads

يتم ترتيب الـContacts بنظام priority score يجمع بين:

- ICP Score.
- ICP Tier A أو High.
- عدم وجود Last Contacted.
- عدم وجود Next Activity Date.
- حالة البريد الإلكتروني.
- حالة رقم الهاتف.

الجدول يعرض:

- Priority Score.
- Contact Name وJob Title.
- Company.
- Country.
- ICP Tier.
- Lead Status.
- Phone Status.
- Next Activity Date.

اسم الـContact يفتح سجل الـContact، واسم الشركة يفتح سجل الـCompany في HubSpot.

## 5. Lead Sources

هذا القسم يفصل بين أنواع المصادر المختلفة حتى لا يتم خلط مصدر اكتساب الـlead بطريقة إنشاء السجل داخل HubSpot.

### الفرق بين المصادر

| ما يظهر في اللوحة | HubSpot label | Internal property | المعنى |
|---|---|---|---|
| Original Traffic Source | Original Traffic Source | `hs_analytics_source` | أول قناة معروفة اكتسبت الـContact |
| Original Source Detail | Original Traffic Source Drill-Down 1 | `hs_analytics_source_data_1` | تفاصيل الحملة أو المصدر الأول |
| Latest Traffic Source | Latest Traffic Source | `hs_latest_source` | آخر مصدر session معروف |
| Latest Source Detail | Latest Traffic Source Drill-Down 1 | `hs_latest_source_data_1` | تفاصيل آخر مصدر |
| Record Source | Record source | `hs_object_source_label` | الأداة أو الطريقة التي أنشأت السجل |
| Record Source Detail 1 | Record source detail 1 | `hs_object_source_detail_1` | اسم الـintegration أو الـform أو الـimport |
| Lead Source | Lead Source | `lead_source` | تصنيف lead source المخصص في Talentera |
| Contact Source | Contact source | `contact_source` | Inbound Marketing أو SDR Outbound أو Sales Generated |

### Extensive-Lighter API

الـContacts التي يتم إنشاؤها عن طريق Extensive-Lighter تظهر كالتالي:

| الحقل | القيمة المتوقعة |
|---|---|
| Record Source | Integration |
| Record Source Detail 1 | Extensive-Lighter |
| Original Traffic Source | قد تظهر Offline Sources حسب HubSpot attribution |
| Original Source Detail | قد تظهر Integration |

لذلك لا يجب اعتبار **Offline Sources** دليلًا على أن السجل لم يأتِ من الـAPI. المصدر الأدق لطريقة إنشاء السجل هو:

`Record Source = Integration` → `Record Source Detail 1 = Extensive-Lighter`

### Source Audit Cards

يعرض القسم:

- عدد الـContacts ذات Record Source = Integration.
- عدد الـContacts ذات Record Source Detail 1 = Extensive-Lighter.
- نسبة سجلات الـIntegration من Contacts الفترة.
- عدد السجلات التي تم إنشاؤها من Forms.

إذا وُجد Contacts تم إنشاؤها من Integration آخر، سيظهر اسم الـintegration في رسم **Integration Detail**.

### Source Drill-down Table

يعرض لكل Contact:

- Original Traffic Source.
- Original Source Detail.
- Latest Traffic Source.
- Record Source.
- Record Source Detail 1.
- Lead Source.

القيم المعروضة تستخدم HubSpot labels. الـinternal names لا تظهر في واجهة المستخدم.

## 6. Activities

### Calls

| العنصر | التعريف |
|---|---|
| Owner | `hubspot_owner_id` |
| Activity Date | `hs_timestamp` |
| Status | `hs_call_status` |
| Outcome | `hs_call_disposition` |
| Connected disposition | `f240bbac-87c9-4f6e-bf70-924b57d47db7` |

تعرض اللوحة عدد المكالمات، Connected Calls، Connection Rate، والتوزيع حسب Call Outcome مثل Connected وNo Answer وBusy وWrong Number.

### Meetings

هناك فرق بين الشخص الذي أنشأ الاجتماع والشخص الذي تم إسناد الاجتماع إليه:

| المعنى | الحقل |
|---|---|
| Created by | `hs_created_by_user_id` |
| Assigned to | `hubspot_owner_id` |
| Created date | `hs_createdate` |
| Start time | `hs_meeting_start_time` |
| Outcome | `hs_meeting_outcome` |
| Source | `hs_meeting_source` |

مصادر الحجز التي تعتبر meeting bookings تشمل:

- Bidirectional API.
- Bidirectional Sync.
- Meetings Public.
- Meetings Embed.

#### إزالة تكرار الاجتماعات

قد يحتوي HubSpot على Calendar Sync activity وسجل CRM Outcome منفصل لنفس الاجتماع. اللوحة تجمع السجلات باستخدام:

- الـContacts المرتبطة.
- التاريخ المحلي.
- ساعة الاجتماع.

ثم تختار أقوى Outcome بالترتيب التالي:

1. Completed.
2. No Show.
3. Canceled.
4. Rescheduled.
5. Scheduled.

### Tasks

| العنصر | الحقل أو الحساب |
|---|---|
| Assigned Owner | `hubspot_owner_id` |
| Due Date | `hs_timestamp` |
| Completion Date | `hs_task_completion_date` |
| Status | `hs_task_status` |
| Open Tasks | Not Started + In Progress + Waiting + Deferred |
| Overdue | Task مفتوحة وDue Date قبل الوقت الحالي |
| Due Tomorrow | Task مفتوحة وDue Date غدًا |

### Emails

| العنصر | الحقل |
|---|---|
| Direction | `hs_email_direction` |
| Status | `hs_email_status` |
| Open Count | `hs_email_open_count` |
| Click Count | `hs_email_click_count` |
| Reply Count | `hs_email_reply_count` |

### Recent Activity Records

الجدول يجمع آخر الأنشطة ويعرض:

- Activity Type: Call أو Meeting أو Task أو Email.
- Subject.
- Status أو Outcome.
- Source أو Detail.
- Assigned Owner.
- Activity Date.

الضغط على Subject أو أيقونة HubSpot يفتح سجل النشاط الأصلي مباشرة.

## 7. Data Quality

تعرض اللوحة نسبة اكتمال الحقول التالية:

| المؤشر | طريقة الاكتمال |
|---|---|
| Email Coverage | وجود Email |
| Verified Email | Email Status يحتوي Valid أو Verified أو Deliverable |
| Phone Coverage | وجود Phone أو Mobile Phone |
| Tested Phone | Phone Status يحتوي Correct أو Valid أو Verified |
| LinkedIn Coverage | وجود GTM LinkedIn URL |
| Company Association | وجود `company_id` |
| Country Coverage | وجود Country |
| Original Source Coverage | وجود Original Traffic Source |
| ICP Tier Coverage | وجود GTM ICP Tier |
| SignalHire Enrichment | وجود SignalHire Match Status |

كما يعرض توصيات تشغيلية للأتمتة، مثل:

- حماية Original Traffic Source وعدم استبداله باسم enrichment provider.
- استخدام Record Source Detail لتسجيل Extensive-Lighter.
- تشغيل SignalHire fallback عند Wrong Number.
- إزالة تكرار الاجتماعات.
- إنشاء SLA Task للـTier A غير المتواصل معه.

## 8. Companies & ATS

### الرسوم

- Companies by Country.
- Top Industries.
- Detected ATS.

### Account Intelligence Table

يعرض لكل شركة:

- Company Name وDomain.
- Country.
- Industry.
- Employee Count.
- Company Tier.
- Detected ATS أو ATS Status.
- ATS Category.
- ATS Confidence.
- عدد الـSDR Contacts المرتبطة بالشركة.

حقول الشركة الأساسية:

| البيانات | الأولوية |
|---|---|
| Country | `gtm_country` ثم `country` |
| Industry | `gtm_industry` ثم `industry` |
| Employees | `gtm_employee_count` ثم `numberofemployees` |
| ATS | `detected_ats` ثم `ats_status` |
| ATS Details | `ats_category`, `ats_confidence`, `ats_evidence_url` |

الضغط على اسم الشركة يفتح سجلها في HubSpot.

## 9. Pipeline

الـDeals يتم الوصول إليها من خلال associations بين الـContacts المحددة والـDeals.

### المقاييس

| المؤشر | التعريف |
|---|---|
| Deals Created | Associated deals التي `createdate` لها داخل الفترة |
| Open Deals | Associated deals غير المغلقة |
| Pipeline Value | مجموع قيمة الـDeals المفتوحة |
| Meeting to Deal | Deals Created ÷ Deduplicated Meetings |

### الجداول والرسوم

- Deal Stage Volume.
- Pipeline Value by Stage.
- Attributed Deals table.

يتم تحويل Deal Stage internal ID إلى الـlabel الحقيقي من HubSpot pipelines metadata.

جدول الـDeals يعرض:

- Deal Name.
- Deal Stage.
- Owner.
- Amount.
- Close Date.

الضغط على اسم الـDeal يفتح سجلها مباشرة في HubSpot.

## 10. روابط HubSpot

اللوحة تبني روابط EU1 باستخدام Portal ID `145742477`، وتشمل:

- Contacts.
- Companies.
- Calls.
- Meetings.
- Tasks.
- Emails.
- Deals.

روابط السجلات تحتوي UTM parameters باسم `sdr_project` لتوضيح أن الزيارة جاءت من الداشبورد.

## 11. تحديث البيانات

- البيانات تأتي من HubSpot Live API من داخل السيرفر.
- يوجد server cache مدته 15 دقيقة لتقليل الضغط على HubSpot API.
- زر **Refresh Data** يطلب بناء البيانات مباشرة ويتجاوز نتيجة الكاش الحالية.
- وقت Last Sync يظهر أسفل القائمة الجانبية.
- أول تحميل أو Refresh كامل قد يستغرق عدة ثوانٍ بسبب قراءة الـContacts والأنشطة والـassociations.

## 12. الأمان

- HubSpot Private App Token موجود على السيرفر فقط داخل `.env`.
- التوكن لا يتم إرساله إلى المتصفح.
- ملف `.env` غير موجود في GitHub.
- الوصول إلى الداشبورد محمي بـHTTP Basic Authentication.
- السيرفر يعمل خلف Traefik وHTTPS.

## 13. ملاحظات وحدود مهمة

1. `createdate` هو تاريخ إنشاء الـContact وليس تاريخ إسناده إلى الـSDR.
2. لا يوجد حاليًا حقل تاريخي تلقائي باسم `sdr_owner_assigned_date`.
3. إذا تغير SDR Owner اليوم، سيتغير الـcurrent portfolio وقد تتغير تقارير الفترات السابقة.
4. للحصول على تاريخ دقيق للإسناد، يجب إنشاء `sdr_owner_assigned_date` وتحديثه عند كل تغيير للـSDR Owner، أو حفظ assignment events في قاعدة بيانات reporting.
5. الأنشطة التي لا تحتوي association مع Contact لا يمكن ضمها بشكل دقيق عند استخدام فلاتر Country أو Source أو ICP.
6. بعض خصائص HubSpot قد تكون فارغة، لذلك تعرض اللوحة Unknown أو شرطة `—` بدل قيمة غير موجودة.
7. Extensive-Lighter يجب تتبعه من Record Source وRecord Source Detail، وليس Original Traffic Source وحده.

## 14. تحديث نسخة السيرفر بعد تعديل GitHub

بعد أي تعديل يتم رفعه على GitHub، تُحدّث النسخة الحية بالأوامر التالية:

```bash
cd /root/SDR-Project
git pull
docker compose up -d --build
```

ثم يتم فتح:

<https://sdr.dashboardtalentera.tech>

ولا يجب رفع أو مشاركة ملف `.env` أو HubSpot Private App Token على GitHub.
