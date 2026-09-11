<#
    deploy/build.ps1 — ประกอบก้อนที่จะอัปขึ้น Hostinger

        cd C:\TimeOpticDigitalSystem
        .\deploy\build.ps1

    ผลลัพธ์อยู่ที่ deploy\dist\  (ไม่เข้า git):

        dist\
        ├── pkg\                         <- ของที่จะถูกซิป (หน้าตาเดียวกับโฟลเดอร์โดเมน)
        │   ├── public_html\             <- ทั้งก้อนนี้ไปเป็น public_html บนโฮสต์
        │   ├── db\schema.sql            <- 53 ตาราง + 6 view โครงเปล่า ไม่มีข้อมูล
        │   ├── db\reference-data.sql    <- แถวของตารางอ้างอิง 10 ตัว
        │   ├── .env.example             <- ไป rename เป็น .env *เหนือ* public_html
        │   └── build-info.txt
        └── timeoptic-YYYYMMDD-HHmm.zip  <- อัปไฟล์นี้ไฟล์เดียว

    ตัวซิปคลี่ออกมาเป็นหน้าตาของ "โฟลเดอร์โดเมน" ไม่ใช่ของ public_html โดยตั้งใจ
    เพราะ .env กับ db\ ต้องอยู่ *นอก* doc root — ดูขั้นตอนใน deploy\README.md

    สวิตช์:
        -SkipBuild   ข้าม npm run build (ใช้ของที่ build ไว้แล้วใน out\)
        -SkipDump    ข้ามการดัมป์ฐาน (ตอนแก้แค่ .htaccess หรือหน้าเว็บ)
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipDump,
    [string]$MysqlDump = 'C:\xampp\mysql\bin\mysqldump.exe'
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $PSScriptRoot 'dist'
# ทุกอย่างที่จะเข้าซิปอยู่ใต้ pkg\ ตัวเดียว — ตัวซิปสร้างจาก "ทั้งโฟลเดอร์นี้"
# ไม่ใช่จากรายชื่อไฟล์ ดูเหตุผลที่ขั้น 6
$pkg  = Join-Path $dist 'pkg'
$pub  = Join-Path $pkg 'public_html'
$dbd  = Join-Path $pkg 'db'

function Say([string]$msg)  { Write-Host "  $msg" }
function Step([string]$msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Die([string]$msg)  { Write-Host "`n  X  $msg`n" -ForegroundColor Red; exit 1 }

<#  อ่าน .env แบบเดียวกับที่ api/config.php อ่าน — เอาไว้หยิบค่าต่อฐานมาใช้ดัมป์
    จะได้ไม่ต้องพิมพ์รหัสผ่านซ้ำ และไม่ต้องเดาว่าฐานชื่ออะไรบนเครื่องนี้ #>
function Read-DotEnv([string]$path) {
    $map = @{}
    if (-not (Test-Path $path)) { return $map }
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    }
    return $map
}

<#  robocopy คืน exit code 0-7 เวลาสำเร็จ (1 = คัดลอกไฟล์, 3 = คัดลอก+ลบ ฯลฯ)
    ตั้งแต่ 8 ขึ้นไปถึงจะแปลว่าพัง · ต้องรีเซ็ต $LASTEXITCODE ด้วย ไม่งั้นบรรทัด
    ถัดไปที่เช็ค $LASTEXITCODE จะเห็นเลขของ robocopy ค้างอยู่แล้วเข้าใจผิด #>
function Copy-Tree([string]$src, [string]$dst, [string[]]$xd, [string[]]$xf) {
    $a = @($src, $dst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
    if ($xd) { $a += '/XD'; $a += $xd }
    if ($xf) { $a += '/XF'; $a += $xf }
    & robocopy @a | Out-Null
    $code = $LASTEXITCODE
    $global:LASTEXITCODE = 0
    if ($code -ge 8) { Die "robocopy ล้มเหลว (code $code): $src -> $dst" }
}

Write-Host "`nTimeOptic — ประกอบก้อน deploy" -ForegroundColor White
Say "จาก $repo"

# ---------------------------------------------------------------- 1. build
Step '1/6  build หน้าเว็บ'

if ($SkipBuild) {
    Say 'ข้าม (-SkipBuild) — ใช้ของเดิมใน frontend-next\out'
} else {
    Push-Location (Join-Path $repo 'frontend-next')
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { Die 'npm run build ไม่ผ่าน' }
    } finally {
        Pop-Location
    }
}

$out = Join-Path $repo 'frontend-next\out'
if (-not (Test-Path (Join-Path $out 'index.html'))) {
    Die "ไม่พบ $out\index.html — build ยังไม่ออก"
}

<#  ด่านที่มีอยู่แล้วในโปรเจกต์ · static export ฝัง NEXT_PUBLIC_API_ORIGIN ลง
    JavaScript ตั้งแต่ตอน build ตั้งผิดแล้วไม่มีอะไรร้อง: หน้าโหลดครบ curl ผ่าน
    แล้วเบราว์เซอร์ที่อยู่นอกร้านยิง API ไม่ถึงสักคำขอ เคยพังมาแล้วครั้งหนึ่ง #>
Push-Location $repo
try {
    & node check-build-origin.mjs
    if ($LASTEXITCODE -ne 0) { Die 'บันเดิลฝังที่อยู่ API ไว้ — ดูข้อความข้างบน' }
} finally {
    Pop-Location
}

# ------------------------------------------------------------- 2. ประกอบ
Step '2/6  ประกอบโครง dist'

if (Test-Path $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
New-Item -ItemType Directory -Path $pub, $dbd -Force | Out-Null

# หน้าเว็บทั้งก้อนไปเป็นราก public_html
Copy-Tree $out $pub
Ok "หน้าเว็บ  $((Get-ChildItem $pub -Recurse -File).Count) ไฟล์"

<#  api/ — ตัด uploads (รูปลูกค้าจริง) กับ tests ออก
    cli/ ต้องติดไปด้วย: reminder.php คือตัวที่ Cron บนโฮสต์เรียก #>
Copy-Tree (Join-Path $repo 'api') (Join-Path $pub 'api') @('uploads', 'tests') @('*.log')

<#  ฝั่งคลัง — ตัด tests กับ var (session ของเครื่องนี้) ออก
    และตัดสคริปต์ปั้นข้อมูลปลอมทิ้งด้วย: seed.php ยัดสินค้าเดโมลงฐาน *จริง*
    ไม่ใช่ฐานทดสอบ ส่วน seed-test-accounts.php รีเซ็ตรหัสผ่านบัญชีทับของจริง
    บนเครื่องที่ร้านใช้อยู่ ไฟล์พวกนี้ไม่ควรอยู่ให้กดพลาดได้ตั้งแต่ต้น #>
Copy-Tree (Join-Path $repo 'stock\api') (Join-Path $pub 'stock\api') `
    @('tests', 'var') `
    @('seed.php', 'seed-test-accounts.php', 'mock-lenses.php', 'mock-month.php')
Ok 'api/ + stock/api/'

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'htaccess-root') `
          -Destination (Join-Path $pub '.htaccess') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'env.production.example') `
          -Destination (Join-Path $pkg '.env.example') -Force
Ok '.htaccess + .env.example'

# ---------------------------------------------------------------- 3. ฐาน
Step '3/6  ดัมป์โครงฐานข้อมูล'

# ตารางที่ต้องมี *แถว* ติดไปด้วย ไม่งั้นฐานเปล่าเปิดใช้ไม่ได้:
#   case_statuses      cases.status ผูก FK มาที่นี่ — ไม่มีแถว = เปิดเคสไม่ได้
#   list_* / categories  ทุก dropdown ในระบบอ่านจากตารางพวกนี้
#   branches           ฝั่งคลังผูกทุกการเคลื่อนไหวกับสาขา
#   app_settings       ชื่อร้าน เวลาเปิด-ปิด ความถี่ตัวเตือน
#   schema_migrations  **สำคัญ** — schema.sql ดัมป์มาจากฐานที่ migration รันครบแล้ว
#                      ถ้าไม่เอาแถวนี้ไป migrate.php จะนึกว่ายังไม่เคยรันสักตัว
#                      แล้วรันซ้ำทั้ง 31 ไฟล์ · ตัวที่เขียน CREATE TABLE เปล่า ๆ
#                      อย่าง 028_multi_role.sql จะพังกลางทาง
$refTables = @(
    'case_statuses', 'categories', 'branches',
    'list_len_type', 'list_marketing', 'list_pay_type', 'list_product_type', 'list_sex',
    'schema_migrations'
)

if ($SkipDump) {
    Say 'ข้าม (-SkipDump) — db\ จะว่าง อย่าเอาซิปรอบนี้ไปตั้งฐานใหม่'
} else {
    if (-not (Test-Path $MysqlDump)) { Die "ไม่พบ mysqldump ที่ $MysqlDump  (ใช้ -MysqlDump ชี้เอง)" }

    $env0 = Read-DotEnv (Join-Path $repo '.env')
    $dbHost = if ($env0.DB_HOST) { $env0.DB_HOST } else { '127.0.0.1' }
    $dbPort = if ($env0.DB_PORT) { $env0.DB_PORT } else { '3306' }
    $dbUser = if ($env0.DB_USER) { $env0.DB_USER } else { 'root' }
    $dbName = if ($env0.DB_NAME) { $env0.DB_NAME } else { 'timeoptic' }
    Say "$dbUser@${dbHost}:$dbPort/$dbName"

    # รหัสผ่านไปทาง environment ไม่ใช่ argument — argument โผล่ในรายการโปรเซส
    # ของทั้งเครื่องระหว่างที่คำสั่งกำลังรัน
    $env:MYSQL_PWD = $env0.DB_PASS

    <#  --result-file ไม่ใช่ ">" โดยตั้งใจ: ให้ mysqldump เขียนไฟล์เอง
        การ redirect ผ่าน PowerShell จะเอาข้อความ UTF-8 ไปผ่านตัวแปลงรหัสของ
        คอนโซลก่อน แล้วภาษาไทยกลายเป็น "?" ทั้งไฟล์โดยไม่มีอะไรเตือน

        --skip-add-drop-table: ไฟล์นี้มีไว้ตั้งฐาน *เปล่า* เท่านั้น ถ้าวันหนึ่งมีคน
        เผลอ import ทับฐานที่มีข้อมูลอยู่ ให้มันฟ้อง "table already exists" แล้วหยุด
        ดีกว่าเงียบ ๆ DROP ตารางลูกค้าสามปีทิ้ง #>
    $common = @(
        "--host=$dbHost", "--port=$dbPort", "--user=$dbUser",
        '--default-character-set=utf8mb4', '--no-tablespaces'
    )

    <#  view สองตัวนี้พังอยู่ในฐานจริง — อ้างตาราง/คอลัมน์ที่ไม่มีแล้ว SELECT ก็ได้
        ERROR 1356 แม้เป็น root และ mysqldump จะจบด้วย exit 2 ตอนไป LOCK TABLES
        ทั้งที่ดัมป์ตัวอื่นครบหมด · ทั้งคู่เป็นของค้างจาก schema ยุค Access ไม่มี
        โค้ดบรรทัดไหนในโปรเจกต์เรียกใช้ (เช็คด้วย grep ทั้ง repo แล้ว) จึงตัดทิ้ง
        ตรงนี้ไปเลย ดีกว่าใส่ --force ซึ่งจะกลืน error จริงตัวอื่นไปด้วยเงียบ ๆ

        วันไหนซ่อมสองตัวนี้แล้ว ให้เอาออกจากลิสต์ แล้วแก้เลข 6 ในด่านตรวจข้างล่าง #>
    $brokenViews = @('v_sale_history', 'v_stock_available')
    $ignore = $brokenViews | ForEach-Object { "--ignore-table=$dbName.$_" }

    $schemaFile = Join-Path $dbd 'schema.sql'
    & $MysqlDump @common @ignore --no-data --skip-add-drop-table `
        "--result-file=$schemaFile" $dbName
    if ($LASTEXITCODE -ne 0) { Die "mysqldump (โครงสร้าง) จบด้วย exit $LASTEXITCODE" }

    <#  แถวอ้างอิง — แยกสองรอบเพราะ --where ของ mysqldump ใช้กับทุกตารางในรอบเดียว
        รอบของ app_settings ต้องคัดแถวโทเค็น Telegram ออก: มันคือความลับของร้าน
        ที่ไม่ควรนอนอยู่ในไฟล์ซิปที่ส่งต่อกันได้ · ตั้งใน .env บนโฮสต์แทน ซึ่ง
        ชนะค่าในตารางนี้อยู่แล้ว (ดู api/config.php) และคีย์ที่หายไปจะถูก
        Migrate::run() ใส่ค่าเริ่มต้นให้เองด้วย INSERT IGNORE #>
    $tmpA = Join-Path $dbd '_settings.part'
    $tmpB = Join-Path $dbd '_lists.part'
    & $MysqlDump @common --no-create-info --complete-insert `
        "--where=``key`` NOT LIKE '%token%' AND ``key`` NOT LIKE '%chat_id%'" `
        "--result-file=$tmpA" $dbName app_settings
    if ($LASTEXITCODE -ne 0) { Die "mysqldump (app_settings) จบด้วย exit $LASTEXITCODE" }

    & $MysqlDump @common --no-create-info --complete-insert `
        "--result-file=$tmpB" $dbName @refTables
    if ($LASTEXITCODE -ne 0) { Die "mysqldump (ตารางอ้างอิง) จบด้วย exit $LASTEXITCODE" }

    # ต่อไฟล์ระดับไบต์ ไม่ผ่าน Get-Content/Set-Content — ด้วยเหตุผลเดียวกับ --result-file
    $refFile = Join-Path $dbd 'reference-data.sql'
    [System.IO.File]::WriteAllBytes(
        $refFile,
        ([System.IO.File]::ReadAllBytes($tmpA) + [System.IO.File]::ReadAllBytes($tmpB))
    )
    Remove-Item -LiteralPath $tmpA, $tmpB -Force

    $env:MYSQL_PWD = $null

    <#  DEFINER ในนิยาม view คือกับดักคลาสสิกของโฮสต์ร่วม: มันอ้างชื่อผู้ใช้ MySQL
        ของเครื่องนี้ ซึ่งไม่มีตัวตนบนเซิร์ฟเวอร์ปลายทาง import แล้วจะได้
        ERROR 1227 access denied กลางคัน · ถอดออกให้ view เป็นของผู้ใช้ที่ import #>
    $sql = [System.IO.File]::ReadAllText($schemaFile, [System.Text.Encoding]::UTF8)
    if ($sql -match 'DEFINER=') {
        $sql = $sql -replace 'DEFINER=[^ ]+ ', ''
        $sql = $sql -replace 'SQL SECURITY DEFINER', 'SQL SECURITY INVOKER'
        [System.IO.File]::WriteAllText($schemaFile, $sql, (New-Object System.Text.UTF8Encoding($false)))
        Ok 'ถอด DEFINER ออกจากนิยาม view แล้ว'
    }

    <#  นิยาม view ของ mysqldump ไม่ได้ขึ้นต้นบรรทัดด้วย CREATE — มันห่อไว้ใน
        คอมเมนต์เวอร์ชัน `/*!50001 CREATE VIEW ...` จึงนับด้วยคำเต็มแทนการยึดหัวบรรทัด #>
    $tables = ([regex]::Matches($sql, '(?m)^CREATE TABLE ')).Count
    $views  = ([regex]::Matches($sql, 'CREATE VIEW `')).Count
    Ok "schema.sql  $tables ตาราง · $views view"
    Ok "reference-data.sql  $([math]::Round((Get-Item $refFile).Length / 1KB)) KB"

    <#  นับเอง ไม่เชื่อ exit code — ไฟล์อาจจบครึ่งทางแล้ว mysqldump ยังคืน 0 ได้
        53 กับ 6 คือของที่ฐานนี้มีจริงวันที่เขียนสคริปต์ (8 view ลบสองตัวที่พัง) #>
    if ($tables -lt 53) { Die "schema.sql มี $tables ตาราง คาดว่าอย่างน้อย 53 — ดัมป์ไม่ครบ" }
    if ($views  -lt 6)  { Die "schema.sql มี $views view คาดว่าอย่างน้อย 6 — ดัมป์ไม่ครบ" }
}

# ---------------------------------------------------------------- 4. ตรวจ
Step '4/6  ตรวจก้อนก่อนซิป'

foreach ($must in @('index.html', '.htaccess', 'api\index.php', 'api\.htaccess',
                    'api\cli\reminder.php', 'stock\api\public\index.php',
                    'stock\api\src\bootstrap.php')) {
    if (-not (Test-Path (Join-Path $pub $must))) { Die "ขาด public_html\$must" }
}
Ok 'ไฟล์ที่ต้องมีครบ'

# .env ต้องไม่หลุดเข้า doc root — นี่คือทั้งเหตุผลที่ย้ายมันขึ้นไปข้างบน
$leak = Get-ChildItem -LiteralPath $pub -Recurse -Force -Filter '.env*' -ErrorAction SilentlyContinue
if ($leak) { Die "มี .env หลุดอยู่ใน public_html: $($leak[0].FullName)" }
Ok 'ไม่มี .env ใน public_html'

# รูปลูกค้าต้องไม่ติดไปกับก้อน
if (Test-Path (Join-Path $pub 'api\uploads')) { Die 'api\uploads ติดไปด้วย — ตัดออกก่อน' }
Ok 'ไม่มี api\uploads'

<#  เลข IP วง LAN ที่ฝังอยู่ในของที่ *เบราว์เซอร์* โหลด — check-build-origin.mjs
    ดูเฉพาะ _next/static/chunks กวาดทั้งก้อนซ้ำอีกทีเผื่อหลุดมาทางอื่น

    ดูเฉพาะไฟล์ฝั่งเบราว์เซอร์ ไม่กวาด .php: api/config.php มีเลข IP อยู่ในคอมเมนต์
    กับในลิสต์ CORS ซึ่งเป็นของฝั่งเซิร์ฟเวอร์ ไม่มีใครดาวน์โหลดไปรันต่อ

    กรองนามสกุลด้วย Where-Object ไม่ใช่ -Include เพราะ -Include เงียบ ๆ ไม่ทำงาน
    เวลาใช้คู่กับ -LiteralPath แล้วด่านนี้จะกลายเป็นการกวาดทุกไฟล์ในก้อน #>
$lan = Get-ChildItem -LiteralPath $pub -Recurse -File |
       Where-Object { $_.Extension -in '.js', '.html', '.txt', '.css', '.json' } |
       Select-String -Pattern '192\.168\.\d+\.\d+' -List
if ($lan) { Die "เลข IP วง LAN โผล่ใน $($lan[0].Path)" }
Ok 'ไม่มีเลข IP วง LAN ในไฟล์ฝั่งเบราว์เซอร์'

# ---------------------------------------------------------- 5. build-info
Step '5/6  บันทึกว่าก้อนนี้มาจากไหน'

$commit = (& git -C $repo rev-parse --short HEAD 2>$null)
$branch = (& git -C $repo rev-parse --abbrev-ref HEAD 2>$null)
$global:LASTEXITCODE = 0
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
@(
    "TimeOptic deploy"
    "ประกอบเมื่อ  $stamp"
    "branch       $branch"
    "commit       $commit"
    "เครื่อง       $env:COMPUTERNAME"
) -join "`r`n" | Set-Content -LiteralPath (Join-Path $pkg 'build-info.txt') -Encoding UTF8
Ok "$branch @ $commit"

# ----------------------------------------------------------------- 6. zip
Step '6/6  ซิป'

<#  เขียน entry เองทีละไฟล์ ไม่ใช้ Compress-Archive และไม่ใช้ ZipFile::CreateFromDirectory

    สเปก ZIP กำหนดให้ตัวคั่นในชื่อ entry เป็น "/" เสมอ แต่บน Windows PowerShell 5.1
    **ทั้งสองตัวเขียนออกมาเป็น "\"** (Compress-Archive เป็นบั๊กของมันเอง ส่วน
    CreateFromDirectory เป็นพฤติกรรมของ .NET Framework ที่เพิ่งมาแก้ใน .NET Core)

    บน Windows คลี่ออกมาดูปกติดีทั้งคู่ จึงไม่มีอะไรเตือน แต่ตัวคลี่ฝั่ง Linux —
    รวมถึง File Manager ของ hPanel — อ่าน "public_html\api\index.php" เป็น *ชื่อไฟล์
    เดียว* ผลคือได้ไฟล์ชื่อประหลาดกองแบนอยู่ 525 อัน ไม่มีโฟลเดอร์สักอัน

    CreateEntry() รับชื่อไปตรง ๆ ตามที่ส่งให้ จึงคุมได้เอง
    -Force ของ Get-ChildItem จำเป็น ไม่งั้น .htaccess กับ .env.example หายไปทั้งคู่ #>
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = Join-Path $dist ("timeoptic-" + (Get-Date -Format 'yyyyMMdd-HHmm') + '.zip')
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

$stream  = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
$count   = 0
try {
    foreach ($f in Get-ChildItem -LiteralPath $pkg -Recurse -File -Force) {
        $rel   = $f.FullName.Substring($pkg.Length + 1).Replace('\', '/')
        $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $in  = $f.OpenRead()
        $out = $entry.Open()
        try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
        $count++
    }
} finally {
    $archive.Dispose()
    $stream.Dispose()
}

# ด่านกันการเผลอเปลี่ยนกลับไปใช้ Compress-Archive วันหลัง
$check = [System.IO.Compression.ZipFile]::OpenRead($zip)
$bad   = @($check.Entries | Where-Object { $_.FullName -like '*\*' }).Count
$check.Dispose()
if ($bad -gt 0) { Die "ชื่อไฟล์ในซิป $bad รายการใช้ \ แทน / — คลี่บน Linux ไม่ออกเป็นโฟลเดอร์" }

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Ok "$zip  ($count รายการ · $mb MB)"

Write-Host "`nต่อไป: ทำตาม deploy\README.md ทีละข้อ" -ForegroundColor White
Write-Host ""
