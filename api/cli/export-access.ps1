# ดึงตารางจาก .accdb ออกเป็น CSV UTF-8 (ไม่มี BOM) ให้ import-access.php กิน
#
#   powershell -ExecutionPolicy Bypass -File api\cli\export-access.ps1 `
#       -Source <สำเนา .accdb> -Out <โฟลเดอร์ปลายทาง>
#
# ─────────────────────────────────────────────────────────────────────────
# ทำไมต้องเป็น PowerShell ไม่ใช่ PHP
# ─────────────────────────────────────────────────────────────────────────
# PHP บน Windows อ่าน .accdb ได้เฉพาะผ่าน ODBC ที่ต้องลง driver ตรงบิตกับ PHP
# ส่วน ACE OLEDB ติดมากับ Access อยู่แล้ว · ขั้นดึงข้อมูลจึงอยู่ฝั่งนี้
# แล้วส่งต่อเป็น CSV ซึ่งตรวจสอบซ้ำได้และรันกี่รอบก็ได้ผลเหมือนเดิม
#
# เขียนด้วย StreamWriter + UTF8Encoding($false) เพราะ Export-Csv -Encoding UTF8
# ของ PowerShell 5.1 ใส่ BOM มาให้ ซึ่งทำให้คอลัมน์แรกของ PHP fgetcsv มีขยะนำหน้า
#
# ค่าทุกช่องถูกครอบด้วยอัญประกาศตาม RFC 4180 — หมายเหตุของร้านมีทั้งจุลภาค
# อัญประกาศ และการขึ้นบรรทัดปนอยู่

param(
  [Parameter(Mandatory = $true)] [string]$Source,
  [Parameter(Mandatory = $true)] [string]$Out,
  # ดูว่าไฟล์นี้มีตารางอะไรบ้าง แล้วออก ไม่เขียนไฟล์ — ใช้กับ .accdb ไฟล์ใหม่ที่ยังไม่รู้จัก
  [switch]$ListOnly
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) { throw "ไม่พบไฟล์ $Source" }
$Source = (Resolve-Path $Source).Path

# ห้ามชี้ไปที่ไฟล์จริงของร้าน — ทำสำเนาก่อนเสมอ · .laccdb แปลว่ามีคนเปิดค้างอยู่
if (Test-Path ([IO.Path]::ChangeExtension($Source, 'laccdb'))) {
  throw "มีไฟล์ .laccdb อยู่ข้าง ๆ แปลว่าฐานนี้ถูกเปิดค้างอยู่ · ปิดก่อน หรือทำสำเนาแล้วชี้มาที่สำเนา"
}

# ตารางที่ import-access.php ต้องการครบทั้ง 13 ไฟล์ ขาดตัวใดตัวหนึ่งมันจะไม่ยอมรัน
$required = @('tblCustomer', 'tblEmployee', 'tblEyeTest', 'tblCustomOrder', 'tblSale',
              'tblStock', 'tblExpense', 'tblIncome', 'tblLocationProd',
              'listSex', 'listMarketing', 'listPayType', 'listProductType')

$conn = New-Object -ComObject ADODB.Connection
try {
  $conn.Open("Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$Source;")
} catch {
  # เครื่องที่ลง Access 2010 จะมีแค่ 12.0
  $conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$Source;")
}

# ---------------------------------------------- ตารางที่ไฟล์นี้มีจริง
# adSchemaTables = 20 · กรองเอาเฉพาะ TABLE ทิ้ง system table กับ view
$schema = $conn.OpenSchema(20)
$present = @()
while (-not $schema.EOF) {
  if ($schema.Fields.Item('TABLE_TYPE').Value -eq 'TABLE') {
    $present += [string]$schema.Fields.Item('TABLE_NAME').Value
  }
  $schema.MoveNext()
}
$schema.Close()

if ($ListOnly) {
  Write-Output "ตารางในไฟล์ ($($present.Count) ตาราง):"
  foreach ($t in ($present | Sort-Object)) {
    $mark = if ($required -contains $t) { '  [ใช้]' } else { '       ' }
    Write-Output ("{0} {1}" -f $mark, $t)
  }
  $missing = $required | Where-Object { $present -notcontains $_ }
  if ($missing) {
    Write-Output ''
    Write-Output "ขาดตารางที่ importer ต้องการ: $($missing -join ', ')"
  }
  $conn.Close()
  return
}

$missing = $required | Where-Object { $present -notcontains $_ }
if ($missing) {
  $conn.Close()
  throw ("ไฟล์นี้ไม่มีตาราง: {0}`n" -f ($missing -join ', ')) +
        "รัน -ListOnly ดูว่ามีอะไรบ้างก่อน · โครงสร้างไม่ตรงแปลว่าใช้ importer เดิมตรง ๆ ไม่ได้"
}

if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Path $Out | Out-Null }

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Esc($v) {
  if ($null -eq $v -or $v -is [System.DBNull]) { return '""' }
  if ($v -is [datetime]) { return '"' + $v.ToString('yyyy-MM-dd HH:mm:ss') + '"' }
  if ($v -is [bool])     { return '"' + $(if ($v) { '1' } else { '0' }) + '"' }
  $s = [string]$v
  return '"' + $s.Replace('"', '""') + '"'
}

foreach ($t in $required) {
  $rs = New-Object -ComObject ADODB.Recordset
  $rs.CursorLocation = 3          # adUseClient — ให้ GetRows ดึงมาทีเดียว
  $rs.Open("SELECT * FROM [$t]", $conn, 3, 1)

  $cols = @()
  foreach ($f in $rs.Fields) { $cols += $f.Name }

  $path = Join-Path $Out "$t.csv"
  $w = New-Object System.IO.StreamWriter($path, $false, $utf8)
  $w.WriteLine(($cols | ForEach-Object { '"' + $_.Replace('"','""') + '"' }) -join ',')

  $n = 0
  if (-not $rs.EOF) {
    # GetRows คืนอาเรย์สองมิติ [คอลัมน์, แถว] ในครั้งเดียว เร็วกว่าวน MoveNext
    # ห้าหมื่นรอบหลายเท่า
    $data = $rs.GetRows()
    $rows = $data.GetLength(1)
    $ncol = $data.GetLength(0)
    for ($r = 0; $r -lt $rows; $r++) {
      $line = New-Object System.Text.StringBuilder
      for ($c = 0; $c -lt $ncol; $c++) {
        if ($c -gt 0) { [void]$line.Append(',') }
        [void]$line.Append((Esc $data[$c, $r]))
      }
      $w.WriteLine($line.ToString())
      $n++
    }
  }
  $w.Close()
  $rs.Close()
  Write-Output ("{0,-18} {1,7} แถว  ->  {2}" -f $t, $n, (Split-Path $path -Leaf))
}

$conn.Close()
Write-Output "เสร็จ"
