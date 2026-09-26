# ขึ้นระบบบน Hostinger

> **Bewell** — ขั้นตอนทั้งหมดข้างล่างใช้ได้ตามเดิม ต่างกันแค่ค่าเหล่านี้:
>
> - เว็บอยู่ที่ **subdomain ของตัวเอง** (`bewell.controlsystem-timeoptic.com`) สร้างด้วย
>   hPanel → Websites → **Add website** ให้ได้โฟลเดอร์ `domains/bewell.controlsystem-timeoptic.com/`
>   **ห้ามใช้ subdomain ที่ซ้อนอยู่ใน `public_html` ของ TimeOptic** — `.env` จะถูกหาที่
>   "เหนือ document root หนึ่งชั้น" ซึ่งกลายเป็น `public_html` ของ TimeOptic (เปิดจากเว็บได้)
>   และ `.htaccess` ของ TimeOptic จะครอบ Bewell ไปด้วย
> - ฐานของตัวเอง `u721081539_bewell` · ทุกที่ในหน้านี้ที่เขียน `controlsystem-timeoptic.com`
>   หรือ `u721081539_timeoptic` ให้อ่านเป็นของ Bewell (`env.production.example` แก้ให้แล้ว)
> - ประกอบก้อนจาก `C:\TimeOptic Bewell` ได้ `bewell-YYYYMMDD-HHmm.zip` · schema 58 ตาราง 7 view
> - บอท Telegram ใช้ของ Be Well สามตัว ห้ามใส่โทเคนของ TimeOptic

สำหรับแพ็กเกจ **Cloud Startup** (hPanel + LiteSpeed + MySQL + SSH) เว็บอยู่ที่โดเมนหลัก

ทั้งระบบเป็นไฟล์นิ่ง (static export) กับ PHP ล้วน ไม่มี Node รันค้างบนเซิร์ฟเวอร์

---

## หน้าตาบนเซิร์ฟเวอร์เมื่อเสร็จแล้ว

```
/home/u721081539/domains/controlsystem-timeoptic.com/
├── .env                 <- รหัสฐานข้อมูล อยู่ตรงนี้ ไม่ใช่ในนั้น
├── db/                  <- ไฟล์ .sql สองใบ ใช้ครั้งเดียวตอนตั้งฐาน
├── sessions/            <- สร้างเองด้วย mkdir ตั้งแต่ตอนตั้งค่า (ดูขั้น 4)
├── build-info.txt       <- ก้อนนี้ประกอบจาก commit ไหน
└── public_html/         <- เฉพาะในนี้ที่เว็บเสิร์ฟออกไป
    ├── .htaccess
    ├── index.html ...   หน้าเว็บ
    ├── api/             หน้าร้าน
    └── stock/api/       ระบบคลัง
```

`.env` กับ `db/` อยู่**นอก** `public_html` โดยตั้งใจ — ในนั้นเปิดจากอินเทอร์เน็ตได้
เหลือ `.htaccess` เป็นด่านเดียว วันไหนแก้ `.htaccess` พลาดบรรทัดเดียว รหัสฐานข้อมูล
กับดัมป์ฐานก็ดาวน์โหลดได้ทันที · โค้ดมองหา `.env` ทั้งสองที่อยู่แล้ว
(`api/config.php` และ `stock/api/src/Env.php`)

---

## ครั้งแรก

### 1 · ตั้งค่าใน hPanel

**PHP ต้อง 8.1 ขึ้นไป** — hPanel → Websites → Dashboard → Advanced → PHP Configuration

ข้อนี้ไม่ใช่คำแนะนำ: `stock/api/src/Errors.php` ใช้ `public readonly` ซึ่ง PHP 8.0
พาร์สไม่ผ่าน และ `api/index.php` require ฝั่งคลังแบบไม่มีเงื่อนไข ผลคือ **API ตาย
500 ทั้งตัว ทุกเส้นทาง** ส่วนหน้าเว็บยังโหลดสวยเหมือนไม่มีอะไรผิด
(README ที่รากโปรเจกต์เขียนว่า "PHP 8.0+" — ข้อนั้นผิด)

ในแท็บ PHP extensions ต้องติ๊ก: `pdo_mysql` `mbstring` `curl` `gd` `fileinfo` `exif` `openssl`

ในแท็บ PHP options ตั้ง **`date.timezone` = `Asia/Bangkok`** ด้วย · ค่าปริยายของ Hostinger
คือ `UTC` และหน้าเว็บไม่กระทบ (`api/index.php` เรียก `date_default_timezone_set()` เอง
ส่วน `Db.php` pin คอนเนกชัน MySQL ไว้ที่ `+07:00`) แต่ **สคริปต์ CLI ฝั่งคลังไม่มีใครตั้งให้** —
`stock/api/src/bootstrap.php` ไม่ได้ตั้ง ตัวแจ้งเตือนของต่ำ/ของค้างจึงคิดวันที่ด้วยเวลา UTC
ขณะที่ SQL ในคำขอเดียวกันเป็น `+07:00` · `php stock/api/bin/doctor.php` ฟ้องข้อนี้ให้

**สร้างฐานข้อมูล** — hPanel → Databases → MySQL Databases
จดสามอย่างไว้: ชื่อฐาน ชื่อผู้ใช้ รหัสผ่าน (สองอย่างแรกจะมี `u721081539_` นำหน้าเสมอ)

### 2 · ประกอบก้อนบนเครื่องที่ร้าน

```powershell
cd C:\TimeOpticDigitalSystem
.\deploy\build.ps1
```

ได้ `deploy\dist\timeoptic-YYYYMMDD-HHmm.zip` ประมาณ 2 MB
สคริปต์จะหยุดเองถ้าดัมป์ฐานไม่ครบ หรือถ้าเลข IP วง LAN หลุดเข้าไปในหน้าเว็บ

### 3 · อัปขึ้นแล้วคลี่

hPanel → Files → File Manager → เข้าไปที่ `domains/controlsystem-timeoptic.com/`
— **ชั้นที่มองเห็น `public_html` เป็นโฟลเดอร์ลูก ไม่ใช่ชั้นที่อยู่ข้างใน `public_html`**

1. เข้าไปใน `public_html` ลบไฟล์ตัวอย่างของ Hostinger ทิ้งก่อน (`index.html`, `default.php`)
2. ถอยกลับมาชั้น `domains/controlsystem-timeoptic.com/` แล้วอัปโหลดไฟล์ zip
3. คลิกขวา → Extract → คลี่ลงที่ชั้นนี้

### 4 · กรอก `.env`

เปลี่ยนชื่อ `.env.example` → `.env` แล้วแก้ค่า (File Manager แก้ไฟล์ในหน้าเว็บได้เลย)

ในไฟล์ตัวอย่างกรอกค่าของบัญชีนี้ไว้ให้หมดแล้ว **เหลือที่ต้องพิมพ์เองแค่รหัสผ่านฐานข้อมูล
สองที่** — `DB_PASS` กับตัวเดียวกันที่อยู่ใน `DATABASE_URL` (มี `# <<<` กำกับไว้ทั้งคู่)

**ห้ามเขียนหมายเหตุท้ายบรรทัด** — ตัวอ่าน `.env` ทั้งสองตัว (`api/config.php` และ
`stock/api/src/Env.php`) ตัดคอมเมนต์ท้ายบรรทัดไม่เป็น เช็กแค่ว่าบรรทัดขึ้นต้นด้วย `#`
ไหมเท่านั้น · เขียน `DB_PASS=abc # รหัสใหม่` แล้วรหัสผ่านจะกลายเป็น `abc # รหัสใหม่`
ทั้งดุ้น (ที่เป็นแบบนี้เพราะรหัสผ่านที่มี `#` อยู่ข้างในต้องใช้ได้)

สองบรรทัดที่ลืมแก้แล้ว **ไม่มีอะไรฟ้อง** — ทั้งคู่เคยหลุดขึ้นเครื่องจริงมาแล้ว:

**`DATABASE_URL`** คือฐานเดียวกับ `DB_*` แค่คนละรูปแบบ · ลืมแก้แล้วเว็บยังใช้งานได้
ครบทุกหน้า เพราะมันเดินทาง `DB_*` (`api/config.php` ตั้ง PDO แล้วให้ฝั่งคลังใช้ตัวเดียวกัน
ตอน `StockModule::boot()`) ที่ตายคือ **สคริปต์ CLI ฝั่งคลังทั้งชุด** ซึ่ง bootstrap ตัวเอง
ไม่ผ่าน `config.php` เลย จึงเห็นแต่ `DATABASE_URL` — และตายแบบ **exit 255 พิมพ์ออกมา
0 ไบต์** เพราะ `display_errors` ปิดบนโฮสต์ ตั้ง Cron Job ไปก็เงียบสนิท

ไม่ต้อง percent-encode เอง (`@` → `%40`, `#` → `%23`, `/` → `%2F`) — กรอก `DB_PASS`
ให้เสร็จก่อน แล้วรันคำสั่งที่เขียนไว้ในคอมเมนต์ของ `.env.example` ให้ประกอบ URL ให้

**`SESSION_PATH`** ต้องเป็น path เต็มที่ **มีอยู่จริง** · โค้ดพยายาม `mkdir` ให้ก่อน
ถ้าไม่สำเร็จมันจะไม่เรียก `session_save_path()` แล้วเงียบ ๆ ตกไปใช้ temp กลางของเครื่อง
ซึ่ง PHP ตัวอื่นบนเครื่องเดียวกันที่ใช้ `gc_maxlifetime` 24 นาทีจะกวาด session ของเรา
ทิ้งแทนเรา · อาการคือคนใช้งานหลุดล็อกอินเป็นพัก ๆ หาสาเหตุไม่เจอ

```bash
mkdir -p ~/domains/controlsystem-timeoptic.com/sessions
chmod 700 ~/domains/controlsystem-timeoptic.com/sessions
```

**`STOCK_API_MODE`** ต้องเป็น `live` · `off` กับ `dry` ไม่ทำให้การขายพัง — บิลออกได้
ตามปกติ แค่ของในคลังไม่ลด และไม่มีข้อความเตือนที่หน้าจอ (`CaseStock` เจอโหมดไม่ใช่
`live` แล้ว return พร้อมธง `dry => true`) ตั้งผิดไว้จะรู้ตัวตอนนับสต๊อกสิ้นเดือน

### 5 · ตั้งฐานข้อมูล

hPanel → Databases → phpMyAdmin → เลือกฐานที่สร้างไว้ → แท็บ Import
นำเข้า **ตามลำดับนี้**:

1. `db/schema.sql` — 53 ตาราง 6 view ยังไม่มีข้อมูลสักแถว
2. `db/reference-data.sql` — สถานะเคส หมวดสินค้า สาขา รายการ dropdown

ถ้าไฟล์ใหญ่เกินที่ phpMyAdmin รับ ใช้ SSH แทน:

```bash
cd ~/domains/controlsystem-timeoptic.com
mysql -u u721081539_timeoptic -p --default-character-set=utf8mb4 u721081539_timeoptic < db/schema.sql
mysql -u u721081539_timeoptic -p --default-character-set=utf8mb4 u721081539_timeoptic < db/reference-data.sql
```

> `reference-data.sql` มีตาราง `schema_migrations` ติดมาด้วยโดยตั้งใจ
> `schema.sql` ดัมป์มาจากฐานที่ migration รันครบแล้ว ถ้าไม่มีแถวพวกนี้
> `migrate.php` จะนึกว่ายังไม่เคยรันสักตัวแล้วรันซ้ำทั้ง 31 ไฟล์จนพังกลางทาง

### 6 · สร้างบัญชีแรก (ผ่าน SSH)

hPanel → Advanced → SSH Access เอา host/port/user มาต่อ แล้ว:

```bash
cd ~/domains/controlsystem-timeoptic.com/public_html

# ต้องได้ "ไม่มี migration ค้าง — ทั้งหมด 31 ไฟล์รันไปแล้ว"
# บรรทัดนี้พิสูจน์สามอย่างพร้อมกัน: .env อยู่ถูกที่ · ต่อฐานได้ · ฐานครบ
#
# ได้ exit 255 แล้วไม่พิมพ์อะไรเลย = DATABASE_URL ผิด (ดูขั้น 4)
# อยากเห็นข้อความจริง: php -d display_errors=1 stock/api/bin/migrate.php --dry
php stock/api/bin/migrate.php --dry

# ตรวจรวบ: ส่วนขยาย เขตเวลา ปลายทางฐาน ตารางที่ต้องมี ยอดคงเหลือตรงกับสมุด
# "FK ข้ามระบบที่ไม่ได้ตกลงกันไว้" เป็น false positive — doctor เขียนไว้สมัยคลัง
# ยังแยกฐาน ตอนนี้ admins->employees กับ admin_roles->admins เป็นของที่ต้องมี
php stock/api/bin/doctor.php

# cron ทั้งสามตัวต้อง exit 0 ก่อนเอาไปตั้งใน hPanel
php api/cli/reminder.php               ; echo "exit=$?"
php stock/api/bin/low-stock-alert.php  ; echo "exit=$?"
php stock/api/bin/stale-stock-alert.php; echo "exit=$?"

# ถามรหัสผ่านสองครั้ง อย่างน้อย 10 ตัว · สร้างแถวพนักงานให้อัตโนมัติ
# (บัญชีทุกใบต้องมีพนักงานรองรับตั้งแต่ migration 027)
php stock/api/bin/make-superuser.php owner "ชื่อที่จะให้ขึ้นบนจอ"
```

### 7 · ตั้ง Cron

hPanel → Advanced → Cron Jobs · `/usr/bin/php` อาจเป็น path อื่นตามเวอร์ชันที่เลือก
เช็คด้วย `which php` ใน SSH

| ทำงานเมื่อ | คำสั่ง | ทำอะไร |
|---|---|---|
| ทุก 1 นาที | `php ~/domains/controlsystem-timeoptic.com/public_html/api/cli/reminder.php` | เตือนคิวลูกค้าเข้า Telegram |
| วันละครั้ง | `php ~/domains/controlsystem-timeoptic.com/public_html/stock/api/bin/low-stock-alert.php` | ของต่ำกว่าขั้นต่ำ |
| เดือนละครั้ง | `php ~/domains/controlsystem-timeoptic.com/public_html/stock/api/bin/stale-stock-alert.php` | ของค้างสต๊อกนาน |

ตัวเตือนคิวคืองานเดียวที่ขับการแจ้งเตือนตามเวลาทั้งหมด ไม่ตั้ง = ไม่มีอะไรเด้งเลย
แต่หน้าเว็บยังใช้ได้ปกติ จึงไม่มีอะไรฟ้องให้รู้

### 8 · ตรวจก่อนส่งมอบ

| ทำ | ต้องได้ |
|---|---|
| เปิด `http://controlsystem-timeoptic.com/` | เด้งเป็น `https://` แล้วไปหน้า login |
| ล็อกอินด้วยบัญชีที่เพิ่งสร้าง | เข้าหน้า hub ได้ **ไม่เด้งกลับหน้า login** |
| เข้าเมนูคลัง | ไม่ต้องล็อกอินซ้ำ (คุกกี้ใบเดียวกัน) |
| เปิด `https://controlsystem-timeoptic.com/.env` | 403 หรือ 404 — **ถ้าเห็นรหัสผ่าน หยุดทันที** |
| เปิด `https://controlsystem-timeoptic.com/api/uploads/1/x.jpg` | 404 |
| เปิด `https://controlsystem-timeoptic.com/stock/api/src/Db.php` | 404 |
| สร้างเคสแล้วแนบรูป | อัปได้ และกดดูรูปได้ |
| เปิดหน้า "ตั้งค่า" กดปุ่มรันตัวเตือน | ไม่ error |
| `ls ~/domains/controlsystem-timeoptic.com/sessions` หลังล็อกอิน | มีไฟล์ `sess_*` โผล่ · ยังว่าง = `SESSION_PATH` ไม่มีผล ตกไปใช้ temp กลาง |
| ขายหนึ่งบิลที่มีสินค้าในคลัง | ยอดในคลังลดจริง · ไม่ลด = `STOCK_API_MODE` ไม่ใช่ `live` |

"ล็อกอินผ่านแล้วเด้งกลับ" คืออาการของคุกกี้ ไม่ใช่ของรหัสผ่าน — ดูตารางกับดักข้างล่าง

---

## deploy รอบต่อไป

```powershell
.\deploy\build.ps1
```

แล้วอัป zip ใหม่ทับ `public_html` เหมือนเดิม **ไม่ต้อง**แตะ `.env` และ**ไม่ต้อง** import
`db/*.sql` ซ้ำ (`schema.sql` ดัมป์มาแบบไม่มี `DROP TABLE` ถ้าเผลอ import ทับฐานที่มี
ข้อมูลอยู่ มันจะฟ้อง "table already exists" แล้วหยุด ไม่ลบอะไรทิ้ง)

ถ้ารอบนั้นมี migration ใหม่ของฝั่งคลัง (`stock/api/migrations/*.sql` เพิ่มไฟล์):

```bash
cd ~/domains/controlsystem-timeoptic.com/public_html
php stock/api/bin/migrate.php --dry    # ดูว่าจะรันอะไรบ้าง
php stock/api/bin/migrate.php
```

ตารางและคอลัมน์ที่หน้าร้านเพิ่มเอง (`bookings` `receipts` `activity_log` ฯลฯ) อยู่ใน
`api/services/Migrate.php` — **บน Hostinger ไม่มีอะไรเรียกมันอัตโนมัติ** มีแค่
`api/cli/serve.php` ของเครื่องในร้านที่เรียกตอนเปิด API (`index.php` แค่ require ไฟล์
ไม่ได้เรียก `run()`) · รอบไหนที่ Migrate.php เพิ่มคอลัมน์ ต้องสั่งเพิ่มบนเซิร์ฟเวอร์เอง
ไม่งั้นหน้าที่บันทึกคอลัมน์นั้นจะตอบ 500 "Unknown column"

**ห้ามสั่ง `Migrate::run()` ทั้งตัวบนเครื่องจริงเพื่อความสะดวก** — มันแก้ข้อมูลเคสด้วย
(`reshapeCaseStatuses()` เปลี่ยนสถานะที่ไม่อยู่ในรายการ · `splitCustomerCategoryOutOfCaseType()`
ตั้ง `customer_category` ให้ทุกเคสที่ยังว่าง) ให้เพิ่มเฉพาะคอลัมน์ที่รอบนั้นเพิ่มทีละตัว

คอลัมน์ที่เพิ่มหลังขึ้นระบบครั้งแรก — สคริปต์ข้างล่างรันซ้ำได้ ตัวที่มีแล้วข้ามไป:

- `centerings.corridor` — ช่อง Cor. ในค่าการวัด Center (2026-09-10)
- `custom_orders.frame_type` — ช่องประเภทกรอบในการ์ดกรอบแว่น (2026-09-10)
  **ต้องเพิ่มก่อนอัป `api/routes/orders.php`** — POST/PUT ออเดอร์เขียนทุกคอลัมน์ใน `ORDER_COLS`
  ถ้าโค้ดขึ้นก่อนคอลัมน์ บันทึกออเดอร์จะพังทุกใบ ไม่ใช่แค่ช่องนี้
- `custom_orders.lens_r_rx_id` `lens_r_rx_doc` `lens_l_rx_id` `lens_l_rx_doc` — ใบสั่งตัด RX
  ที่เปิดจากหน้าเคส ผูกกับเลนส์แต่ละข้าง (2026-09-11) · อยู่ใน `ORDER_COLS` เหมือนกัน
  **ต้องเพิ่มก่อนอัป `api/routes/orders.php`**

```bash
cd ~/domains/controlsystem-timeoptic.com/public_html
php -r '$c=require "api/config.php"; $d=$c["db"];
  $p=new PDO("mysql:host={$d["host"]};dbname={$d["database"]};charset=utf8mb4",$d["user"],$d["password"]);
  foreach ([["centerings","corridor","varchar(20) DEFAULT NULL"],["custom_orders","frame_type","varchar(40) DEFAULT NULL"],
    ["custom_orders","lens_r_rx_id","int(10) unsigned DEFAULT NULL"],["custom_orders","lens_r_rx_doc","varchar(100) DEFAULT NULL"],
    ["custom_orders","lens_l_rx_id","int(10) unsigned DEFAULT NULL"],["custom_orders","lens_l_rx_doc","varchar(100) DEFAULT NULL"]] as [$t,$col,$ddl]) {
  $has=$p->query("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=\"$t\" AND column_name=\"$col\"")->fetchColumn();
  if($has){echo "$t.$col มีอยู่แล้ว\n";}else{$p->exec("ALTER TABLE `$t` ADD COLUMN `$col` $ddl"); echo "เพิ่ม $t.$col แล้ว\n";}
  }'
```

---

## กับดักที่รู้แล้ว

| อาการ | สาเหตุจริง |
|---|---|
| API ตอบ 500 ทุกเส้น หน้าเว็บโหลดสวย | PHP ยังเป็น 8.0 — ฝั่งคลังใช้ `public readonly` ต้อง 8.1+ |
| ล็อกอินผ่าน แล้วเด้งกลับหน้า login ทันที | `SESSION_SECURE=1` แต่เข้ามาทาง `http` เบราว์เซอร์เลยไม่ส่งคุกกี้กลับ · ต้องมีกฎบังคับ https ใน `.htaccess` ครบ (มีให้แล้ว) |
| ใช้งานอยู่ดี ๆ หลุดล็อกอินเป็นพัก ๆ ไม่มี error | `SESSION_PATH` ชี้ไปที่ที่ `mkdir` ไม่ได้ · โค้ดไม่เรียก `session_save_path()` แล้วตกไปใช้ temp กลางเงียบ ๆ ซึ่งโดน GC ของโปรเซสอื่นกวาดทิ้ง (ไม่ใช่ 401 ทุกคำขอ — มันยังล็อกอินได้ แค่อยู่ไม่ทน) |
| cron ฝั่งคลังไม่ทำงาน แต่เว็บปกติทุกอย่าง | `DATABASE_URL` ยังเป็นค่าตัวอย่าง · เว็บเดินทาง `DB_*` จึงไม่กระทบ ส่วน CLI ฝั่งคลังเห็นแต่ตัวนี้ แล้วตายแบบ exit 255 พิมพ์ 0 ไบต์ · จับด้วย `php stock/api/bin/migrate.php --dry` |
| ค่าใน `.env` เพี้ยนทั้งที่พิมพ์ถูก | เขียนหมายเหตุไว้ท้ายบรรทัด · ตัวอ่านตัดคอมเมนต์ท้ายบรรทัดไม่เป็น หมายเหตุกลายเป็นส่วนหนึ่งของค่า |
| ขายแล้วของในคลังไม่ลด แต่บิลออกปกติ | `STOCK_API_MODE` ไม่ใช่ `live` · โหมด `off`/`dry` ไม่ทำให้อะไรพัง ไม่มีข้อความเตือน |
| ตัวแจ้งเตือนคลังคิดวันที่เพี้ยนไป 7 ชั่วโมง | `date.timezone` ยังเป็น `UTC` · CLI ฝั่งคลังไม่มีใครตั้งเขตเวลาให้ (เว็บไม่กระทบ) |
| หน้าเว็บเปิดได้แต่ทุกปุ่มไม่ทำงาน จาก **นอกร้าน** เท่านั้น | บันเดิลถูก build ตอนที่ `NEXT_PUBLIC_API_ORIGIN` ไม่ว่าง เลยฝังเลข IP วง LAN ไว้ · `build.ps1` มีด่านจับให้แล้ว ห้ามข้ามด้วย `-SkipBuild` เวลาจะขึ้นจริง |
| import `schema.sql` แล้ว ERROR 1227 access denied | ในไฟล์มี `DEFINER=` ค้างอยู่ · `build.ps1` ถอดให้แล้วทุกครั้ง ถ้ายังเจอแปลว่าใช้ไฟล์เก่า |
| dropdown ว่างหมด เปิดเคสไม่ได้ | ยังไม่ได้ import `reference-data.sql` |
| ไม่มีการแจ้งเตือนเด้งเลย แต่ระบบใช้งานได้ปกติ | ยังไม่ได้ตั้ง Cron ของ `reminder.php` |

---

## แก้ตัวก้อนเอง

| ไฟล์ | คุมอะไร |
|---|---|
| `deploy/build.ps1` | ขั้นตอนประกอบทั้งหมด · รายชื่อไฟล์ที่ตัดออก · ด่านตรวจ |
| `deploy/htaccess-root` | เส้นทาง `/stock-api` · บังคับ https · ไฟล์ที่ห้ามเสิร์ฟ · แคช |
| `deploy/env.production.example` | รายการค่าที่ต้องกรอกบนเซิร์ฟเวอร์ |

แก้ที่ `deploy/dist/` ไม่มีประโยชน์ — `build.ps1` ล้างทิ้งแล้วสร้างใหม่ทุกครั้ง
