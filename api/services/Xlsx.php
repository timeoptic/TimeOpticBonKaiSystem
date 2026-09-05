<?php
/**
 * ตัวเขียนไฟล์ .xlsx ขนาดเล็ก — พอสำหรับรายงาน ไม่ใช่ไลบรารีอเนกประสงค์
 *
 * **ทำไมเขียนเอง** — .xlsx คือไฟล์ zip ที่ข้างในเป็น XML ไม่กี่ส่วน และ PHP
 * เครื่องนี้เปิด ext-zip ไว้แล้ว · ทางเลือกอื่นคือ PhpSpreadsheet (ต้องมี composer
 * ทั้งชุดที่โปรเจกต์นี้ยังไม่มี) หรือสร้างฝั่งเบราว์เซอร์ด้วย SheetJS (เพิ่ม
 * dependency ก้อนใหญ่ให้ frontend ที่ตอนนี้มีแค่ next กับ react) · สิ่งที่รายงาน
 * ต้องใช้จริงมีแค่ หลายชีท · ตัวหนา · รูปแบบเงินกับวันที่ · สูตร SUM ซึ่งพอดีกับ
 * ที่เขียนเองได้ในไฟล์เดียว
 *
 * **สิ่งที่จงใจไม่รองรับ**: รูปภาพ กราฟ การผสานเซลล์ เงื่อนไขสี และ sharedStrings
 * (ใช้ inlineStr แทน — ไฟล์ใหญ่ขึ้นเล็กน้อยแต่ไม่ต้องมีตารางคำที่สองที่ต้อง
 * ซิงก์กับข้อมูล) · วันไหนต้องการกราฟจริงใน Excel วันนั้นค่อยคุยกันว่าจะลง
 * PhpSpreadsheet ไหม อย่าเติมทีละครึ่งใบที่นี่
 *
 * ลำดับแท็กใน worksheet ห้ามสลับ (cols ต้องมาก่อน sheetData · autoFilter ต้องมา
 * หลัง) — Excel ตรวจตาม schema แล้วปฏิเสธทั้งไฟล์ด้วยข้อความ "ไฟล์เสียหาย"
 * ที่ไม่บอกว่าเสียตรงไหน
 */
declare(strict_types=1);

final class Xlsx
{
    /* ดัชนีสไตล์ — ต้องเรียงตรงกับ <cellXfs> ใน styles() */
    public const PLAIN      = 0;
    public const BOLD       = 1;
    public const TITLE      = 2;
    public const HEAD       = 3;
    public const MONEY      = 4;
    public const MONEY_BOLD = 5;
    public const DATE       = 6;
    public const PCT        = 7;
    public const MUTED      = 8;
    public const INT        = 9;
    public const INT_BOLD   = 10;

    public const DECL   = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    public const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    /** @var XlsxSheet[] */
    private array $sheets = [];

    /** ส่วนของกราฟที่เขียนลงไฟล์แล้ว — [Content_Types].xml ต้องประกาศให้ครบ */
    private array $chartParts   = [];
    private array $drawingParts = [];

    public function sheet(string $name): XlsxSheet
    {
        $sheet          = new XlsxSheet($this->uniqueName($name));
        $this->sheets[] = $sheet;
        return $sheet;
    }

    /* ---- ตัวสร้างเซลล์ ------------------------------------------------ */

    /** ข้อความ */
    public static function t(?string $v, int $style = self::PLAIN): array
    {
        return ['k' => 's', 'v' => (string) $v, 's' => $style];
    }

    /** ตัวเลข — เก็บเป็นตัวเลขจริง ไม่ใช่ข้อความที่จัดรูปแล้ว จึงบวกลบต่อได้ */
    public static function n(mixed $v, int $style = self::MONEY): array
    {
        return ['k' => 'n', 'v' => (float) $v, 's' => $style];
    }

    /** วันที่จาก 'YYYY-MM-DD' หรือ 'YYYY-MM-DD HH:MM:SS' — ว่างได้ */
    public static function d(?string $v, int $style = self::DATE): array
    {
        $serial = self::serial($v);
        return $serial === null
            ? ['k' => 'blank', 'v' => null, 's' => $style]
            : ['k' => 'n', 'v' => $serial, 's' => $style];
    }

    /**
     * สูตร พร้อมค่าที่คำนวณไว้ล่วงหน้า
     *
     * ต้องใส่ค่าที่คำนวณแล้วไปด้วยเสมอ — โปรแกรมที่เปิดไฟล์แบบไม่คิดสูตรให้
     * (พรีวิวของ Google Drive · ตัวอ่านบนมือถือ) จะโชว์ค่านี้แทนช่องว่าง
     */
    public static function f(string $formula, mixed $cached, int $style = self::MONEY_BOLD): array
    {
        return ['k' => 'f', 'v' => (float) $cached, 'f' => $formula, 's' => $style];
    }

    /** เซลล์ว่างที่ยังกินตำแหน่งคอลัมน์ */
    public static function blank(): array
    {
        return ['k' => 'blank', 'v' => null, 's' => self::PLAIN];
    }

    /* ---- การประกอบไฟล์ ------------------------------------------------ */

    /** คืนเนื้อไฟล์ทั้งก้อนเป็นสตริงไบต์ */
    public function toBytes(): string
    {
        if (!$this->sheets) {
            throw new RuntimeException('สมุดงานต้องมีอย่างน้อยหนึ่งชีท');
        }
        /* ZipArchive เขียนลงไฟล์อย่างเดียว เขียนลงสตริงไม่ได้ — ใช้ไฟล์ชั่วคราว
           แล้วอ่านกลับ · finally ลบทิ้งทุกทางออกรวมทั้งตอนโยน exception */
        $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
        if ($tmp === false) {
            throw new RuntimeException('สร้างไฟล์ชั่วคราวไม่ได้');
        }
        try {
            $zip = new ZipArchive();
            if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) {
                throw new RuntimeException('เปิดไฟล์ zip เพื่อเขียนไม่ได้');
            }
            $zip->addFromString('_rels/.rels', $this->rootRels());
            $zip->addFromString('xl/workbook.xml', $this->workbook());
            $zip->addFromString('xl/_rels/workbook.xml.rels', $this->workbookRels());
            $zip->addFromString('xl/styles.xml', $this->styles());
            $chartNo = 0;
            foreach ($this->sheets as $i => $sheet) {
                $n = $i + 1;
                $zip->addFromString("xl/worksheets/sheet$n.xml", $sheet->xml());

                $charts = $sheet->charts();
                if (!$charts) {
                    continue;
                }
                /* หนึ่งชีทมีภาพวาดได้ใบเดียว กราฟทุกอันของชีทนั้นไปวางอยู่ในนั้น
                   — ชีทชี้ไปที่ภาพวาด ภาพวาดชี้ไปที่กราฟทีละอัน สามชั้นตามสเปก */
                $zip->addFromString(
                    "xl/worksheets/_rels/sheet$n.xml.rels",
                    self::DECL
                    . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    . '<Relationship Id="rId1" Type="' . self::REL_NS . '/drawing"'
                    . " Target=\"../drawings/drawing$n.xml\"/></Relationships>"
                );

                $ids  = [];
                $rels = '';
                foreach ($charts as $k => $spec) {
                    $chartNo++;
                    $ids[]  = 'rId' . ($k + 1);
                    $rels  .= '<Relationship Id="rId' . ($k + 1) . '" Type="' . self::REL_NS . '/chart"'
                        . " Target=\"../charts/chart$chartNo.xml\"/>";
                    $zip->addFromString("xl/charts/chart$chartNo.xml", self::chartXml($spec, $chartNo));
                    $this->chartParts[] = "/xl/charts/chart$chartNo.xml";
                }
                $zip->addFromString(
                    "xl/drawings/_rels/drawing$n.xml.rels",
                    self::DECL
                    . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    . $rels . '</Relationships>'
                );
                $zip->addFromString("xl/drawings/drawing$n.xml", self::drawingXml($charts, $ids));
                $this->drawingParts[] = "/xl/drawings/drawing$n.xml";
            }
            /* เขียน [Content_Types].xml ทีหลังสุด เพราะต้องรู้ก่อนว่ามีกราฟกี่อัน */
            $zip->addFromString('[Content_Types].xml', $this->contentTypes());
            $zip->close();
            $bytes = file_get_contents($tmp);
            if ($bytes === false) {
                throw new RuntimeException('อ่านไฟล์ที่เพิ่งเขียนไม่ได้');
            }
            return $bytes;
        } finally {
            @unlink($tmp);
        }
    }

    /* ---- ส่วนประกอบ XML ----------------------------------------------- */

    private function contentTypes(): string
    {
        $parts = '';
        foreach ($this->sheets as $i => $_) {
            $parts .= '<Override PartName="/xl/worksheets/sheet' . ($i + 1) . '.xml"'
                . ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }
        foreach ($this->drawingParts as $p) {
            $parts .= '<Override PartName="' . $p . '"'
                . ' ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
        }
        foreach ($this->chartParts as $p) {
            $parts .= '<Override PartName="' . $p . '"'
                . ' ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
        }
        return self::DECL
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml"'
            . ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/styles.xml"'
            . ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . $parts
            . '</Types>';
    }

    private function rootRels(): string
    {
        return self::DECL
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="' . self::REL_NS . '/officeDocument"'
            . ' Target="xl/workbook.xml"/></Relationships>';
    }

    private function workbook(): string
    {
        $sheets = '';
        foreach ($this->sheets as $i => $sheet) {
            $sheets .= sprintf(
                '<sheet name="%s" sheetId="%d" r:id="rId%d"/>',
                self::esc($sheet->name),
                $i + 1,
                $i + 1
            );
        }
        /* fullCalcOnLoad ให้ Excel คิดสูตรใหม่ตอนเปิด — ค่าที่เราคำนวณไว้เป็นแค่
           ตัวสำรองสำหรับโปรแกรมที่ไม่คิดสูตรให้ */
        return self::DECL
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            . ' xmlns:r="' . self::REL_NS . '">'
            . '<sheets>' . $sheets . '</sheets>'
            . '<calcPr calcId="0" fullCalcOnLoad="1"/>'
            . '</workbook>';
    }

    private function workbookRels(): string
    {
        $rels = '';
        foreach ($this->sheets as $i => $_) {
            $rels .= sprintf(
                '<Relationship Id="rId%d" Type="%s/worksheet" Target="worksheets/sheet%d.xml"/>',
                $i + 1,
                self::REL_NS,
                $i + 1
            );
        }
        $rels .= sprintf(
            '<Relationship Id="rId%d" Type="%s/styles" Target="styles.xml"/>',
            count($this->sheets) + 1,
            self::REL_NS
        );
        return self::DECL
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . $rels . '</Relationships>';
    }

    /**
     * ฟอนต์เป็น Tahoma ทุกสไตล์ — Calibri ที่ Excel ใช้เป็นค่าตั้งต้นวางสระไทย
     * ไม่ตรงตำแหน่ง สระบนกับวรรณยุกต์จะซ้อนกันจนอ่านยากในเซลล์แคบ ๆ
     */
    private function styles(): string
    {
        $numFmts = '<numFmts count="4">'
            . '<numFmt numFmtId="164" formatCode="#,##0.00"/>'
            . '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>'
            . '<numFmt numFmtId="166" formatCode="0.0&quot;%&quot;"/>'
            . '<numFmt numFmtId="167" formatCode="#,##0"/>'
            . '</numFmts>';
        $fonts = '<fonts count="4">'
            . '<font><sz val="11"/><name val="Tahoma"/></font>'
            . '<font><b/><sz val="11"/><name val="Tahoma"/></font>'
            . '<font><b/><sz val="14"/><name val="Tahoma"/></font>'
            . '<font><sz val="10"/><color rgb="FF7A8A80"/><name val="Tahoma"/></font>'
            . '</fonts>';
        /* สองช่องแรกของ fills จองไว้ให้ none กับ gray125 ตามสเปก ห้ามใช้ทำอย่างอื่น */
        $fills = '<fills count="3">'
            . '<fill><patternFill patternType="none"/></fill>'
            . '<fill><patternFill patternType="gray125"/></fill>'
            . '<fill><patternFill patternType="solid">'
            . '<fgColor rgb="FFE8F3EC"/><bgColor indexed="64"/></patternFill></fill>'
            . '</fills>';
        $borders = '<borders count="2">'
            . '<border><left/><right/><top/><bottom/><diagonal/></border>'
            . '<border><left/><right/><top/>'
            . '<bottom style="thin"><color rgb="FFB9C7BD"/></bottom><diagonal/></border>'
            . '</borders>';
        $xf = [
            /* PLAIN      */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
            /* BOLD       */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
            /* TITLE      */ '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
            /* HEAD       */ '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"'
                . ' applyFont="1" applyFill="1" applyBorder="1"/>',
            /* MONEY      */ '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
            /* MONEY_BOLD */ '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0"'
                . ' applyNumberFormat="1" applyFont="1"/>',
            /* DATE       */ '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
            /* PCT        */ '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
            /* MUTED      */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
            /* INT        */ '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
            /* INT_BOLD   */ '<xf numFmtId="167" fontId="1" fillId="0" borderId="0" xfId="0"'
                . ' applyNumberFormat="1" applyFont="1"/>',
        ];
        return self::DECL
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . $numFmts . $fonts . $fills . $borders
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="' . count($xf) . '">' . implode('', $xf) . '</cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            . '</styleSheet>';
    }

    /* ---- กราฟ ---------------------------------------------------------- */

    /**
     * อ้างช่วงเซลล์ให้กราฟ เช่น `Dashboard!$C$15:$C$26`
     *
     * กราฟอ้างเซลล์จริง ไม่ใช่ตัวเลขที่ฝังไว้ — แก้ตัวเลขในตารางแล้วกราฟขยับตาม
     * (เราฝังค่าที่คำนวณไว้ไปด้วยใน cache ให้โปรแกรมที่เปิดแบบไม่คิดสูตร)
     */
    public static function ref(string $sheet, string $col, int $firstRow, int $lastRow): string
    {
        /* ชื่อชีทที่มีช่องว่างหรือขีดต้องครอบด้วยอัญประกาศเดี่ยว ไม่งั้น Excel
           อ่านสูตรไม่ออกแล้วทิ้งกราฟทั้งอัน */
        $name = preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $sheet) === 1
            ? $sheet
            : "'" . str_replace("'", "''", $sheet) . "'";
        return "$name!\$$col\$$firstRow:\$$col\$$lastRow";
    }

    /**
     * ภาพวาดหนึ่งใบต่อชีท — กล่องที่บอกว่ากราฟแต่ละอันวางคร่อมเซลล์ไหนถึงไหน
     *
     * ยึดกับเซลล์สองมุม (twoCellAnchor) ไม่ใช่พิกัดคงที่ กราฟจึงยืดหดตามความ
     * กว้างคอลัมน์ที่ผู้ใช้ปรับเอง แทนที่จะทับตารางเวลาเปิดบนจอคนละขนาด
     */
    private static function drawingXml(array $charts, array $relIds): string
    {
        $body = '';
        foreach ($charts as $i => $spec) {
            [$c1, $r1, $c2, $r2] = $spec['anchor'];
            $body .= '<xdr:twoCellAnchor>'
                . "<xdr:from><xdr:col>$c1</xdr:col><xdr:colOff>0</xdr:colOff>"
                . "<xdr:row>$r1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>"
                . "<xdr:to><xdr:col>$c2</xdr:col><xdr:colOff>0</xdr:colOff>"
                . "<xdr:row>$r2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>"
                . '<xdr:graphicFrame macro="">'
                . '<xdr:nvGraphicFramePr>'
                . '<xdr:cNvPr id="' . ($i + 2) . '" name="Chart ' . ($i + 1) . '"/>'
                . '<xdr:cNvGraphicFramePr/>'
                . '</xdr:nvGraphicFramePr>'
                . '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
                . '<a:graphic><a:graphicData'
                . ' uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
                . '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
                . ' xmlns:r="' . self::REL_NS . '" r:id="' . $relIds[$i] . '"/>'
                . '</a:graphicData></a:graphic>'
                . '</xdr:graphicFrame>'
                . '<xdr:clientData/></xdr:twoCellAnchor>';
        }
        return self::DECL
            . '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
            . ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            . $body . '</xdr:wsDr>';
    }

    /**
     * กราฟหนึ่งอัน — แท่งตั้ง ('col') หรือโดนัท ('doughnut')
     *
     * **ลำดับแท็กในไฟล์กราฟห้ามสลับ** ตามสเปก DrawingML: ใน `<c:chart>` คือ
     * title → plotArea → legend → plotVisOnly → dispBlanksAs · ใน `<c:ser>` คือ
     * idx → order → tx → spPr → dPt → dLbls → cat → val · สลับเมื่อไหร่ Excel
     * ไม่ได้บอกว่ากราฟผิด แต่ขึ้นว่า "ไฟล์เสียหาย" แล้วซ่อมโดยทิ้งกราฟทั้งอัน
     *
     * ตั้งฟอนต์กับสีทุกจุดเป็นค่าตรง ไม่อ้างธีม — ไฟล์นี้ไม่มี theme1.xml (ตัวเขียน
     * ตั้งใจไม่ใส่) กราฟที่อ้าง `+mn-lt` หรือ `accent1` จึงไม่มีอะไรให้อ้างถึง
     */
    private static function chartXml(array $spec, int $no): string
    {
        $kind   = $spec['kind'] ?? 'col';
        $cats   = $spec['cats'];
        $series = $spec['series'];
        $fmt    = $spec['numFmt'] ?? '#,##0';

        $body = '';
        foreach ($series as $i => $s) {
            $points = '';
            foreach (($s['colors'] ?? []) as $k => $color) {
                $points .= "<c:dPt><c:idx val=\"$k\"/><c:bubble3D val=\"0\"/>"
                    . '<c:spPr><a:solidFill><a:srgbClr val="' . $color . '"/></a:solidFill>'
                    . '<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>'
                    . '</c:spPr></c:dPt>';
            }
            $labels = $kind === 'doughnut'
                ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/>'
                    . '<c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>'
                : '';
            $body .= '<c:ser>'
                . "<c:idx val=\"$i\"/><c:order val=\"$i\"/>"
                . '<c:tx><c:v>' . self::esc($s['name'] ?? '') . '</c:v></c:tx>'
                . (isset($s['color'])
                    ? '<c:spPr><a:solidFill><a:srgbClr val="' . $s['color'] . '"/></a:solidFill></c:spPr>'
                    : '')
                . ($kind === 'col' ? '<c:invertIfNegative val="0"/>' : '')
                . $points
                . $labels
                . '<c:cat><c:strRef><c:f>' . self::esc($cats['ref']) . '</c:f>'
                . self::strCache($cats['labels']) . '</c:strRef></c:cat>'
                . '<c:val><c:numRef><c:f>' . self::esc($s['ref']) . '</c:f>'
                . self::numCache($s['values'], $fmt) . '</c:numRef></c:val>'
                . '</c:ser>';
        }

        $axX = 100000 + $no * 2;
        $axY = 100001 + $no * 2;
        if ($kind === 'doughnut') {
            $plot = '<c:doughnutChart><c:varyColors val="1"/>' . $body
                . '<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>';
            $legend = '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>';
        } else {
            $plot = '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>'
                . '<c:varyColors val="0"/>' . $body
                . '<c:gapWidth val="40"/>'
                . "<c:axId val=\"$axX\"/><c:axId val=\"$axY\"/></c:barChart>"
                . "<c:catAx><c:axId val=\"$axX\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling>"
                . '<c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/>'
                . "<c:crossAx val=\"$axY\"/></c:catAx>"
                . "<c:valAx><c:axId val=\"$axY\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling>"
                . '<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>'
                . '<c:numFmt formatCode="' . self::esc($fmt) . '" sourceLinked="0"/>'
                . '<c:tickLblPos val="nextTo"/>'
                . "<c:crossAx val=\"$axX\"/></c:valAx>";
            /* ชุดข้อมูลเดียวไม่ต้องมีคำอธิบายสี — มันบอกสิ่งที่หัวกราฟบอกไปแล้ว */
            $legend = count($series) > 1
                ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'
                : '';
        }

        return self::DECL
            . '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
            . ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
            . ' xmlns:r="' . self::REL_NS . '">'
            . '<c:chart>'
            . '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>'
            . '<a:pPr><a:defRPr sz="1100" b="1"><a:latin typeface="Tahoma"/>'
            . '<a:cs typeface="Tahoma"/></a:defRPr></a:pPr>'
            . '<a:r><a:rPr lang="th-TH"/><a:t>' . self::esc($spec['title'] ?? '') . '</a:t></a:r>'
            . '</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>'
            . '<c:autoTitleDeleted val="0"/>'
            . '<c:plotArea><c:layout/>' . $plot . '</c:plotArea>'
            . $legend
            . '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>'
            . '</c:chart>'
            . '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'
            . '<a:ln><a:solidFill><a:srgbClr val="E3E9E5"/></a:solidFill></a:ln></c:spPr>'
            . '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900">'
            . '<a:latin typeface="Tahoma"/><a:cs typeface="Tahoma"/></a:defRPr></a:pPr>'
            . '<a:endParaRPr lang="th-TH"/></a:p></c:txPr>'
            . '</c:chartSpace>';
    }

    /** ค่าที่อ่านได้ล่าสุดของช่วงเซลล์ที่เป็นข้อความ */
    private static function strCache(array $labels): string
    {
        $pts = '';
        foreach (array_values($labels) as $i => $v) {
            $pts .= "<c:pt idx=\"$i\"><c:v>" . self::esc((string) $v) . '</c:v></c:pt>';
        }
        return '<c:strCache><c:ptCount val="' . count($labels) . '"/>' . $pts . '</c:strCache>';
    }

    /** ค่าที่อ่านได้ล่าสุดของช่วงเซลล์ที่เป็นตัวเลข */
    private static function numCache(array $values, string $fmt): string
    {
        $pts = '';
        foreach (array_values($values) as $i => $v) {
            $pts .= "<c:pt idx=\"$i\"><c:v>" . (0 + $v) . '</c:v></c:pt>';
        }
        return '<c:numCache><c:formatCode>' . self::esc($fmt) . '</c:formatCode>'
            . '<c:ptCount val="' . count($values) . '"/>' . $pts . '</c:numCache>';
    }

    /* ---- เครื่องมือที่ชีทเรียกใช้ด้วย --------------------------------- */

    /**
     * หนีอักขระพิเศษของ XML แล้วทิ้งอักขระควบคุมที่ XML 1.0 ไม่ยอมรับ
     *
     * ข้อมูลจริงมีตัวควบคุมหลุดมาได้ (คัดลอกจากโปรแกรมเก่า · ไฟล์ที่นำเข้ามา)
     * ตัวเดียวก็ทำให้ Excel ปฏิเสธทั้งไฟล์ ทิ้งไปเงียบ ๆ ดีกว่าส่งไฟล์เสียให้ผู้ใช้
     */
    public static function esc(?string $v): string
    {
        $raw = (string) $v;
        /* ธง u ทำให้ preg_replace คืน null เมื่อเจอไบต์ที่ไม่ใช่ UTF-8 ที่ถูกต้อง
           — ตกไปกรองแบบไบต์แทน ดีกว่ากลืนข้อความทั้งช่องเป็นค่าว่าง */
        $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $raw)
            ?? preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $raw)
            ?? '';
        return htmlspecialchars($clean, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    /** ชื่อคอลัมน์ตามเลขลำดับ เริ่มที่ 1 = A */
    public static function colName(int $n): string
    {
        $name = '';
        while ($n > 0) {
            $n--;
            $name = chr(65 + $n % 26) . $name;
            $n    = intdiv($n, 26);
        }
        return $name;
    }

    /**
     * 'YYYY-MM-DD' -> เลขวันแบบ Excel (นับจาก 1899-12-30)
     *
     * ที่เป็น 1899-12-30 ไม่ใช่ 31 เพราะ Excel เชื่อว่าปี 1900 เป็นปีอธิกสุรทิน
     * ซึ่งไม่จริง · เลื่อนจุดเริ่มไปหนึ่งวันคือวิธีที่ทุกตัวเขียนไฟล์ใช้ชดเชย
     */
    public static function serial(?string $v): ?float
    {
        $s = trim((string) $v);
        if ($s === '' || str_starts_with($s, '0000-00-00')) {
            return null;
        }
        try {
            $d = new DateTimeImmutable(substr($s, 0, 10));
        } catch (Throwable) {
            return null;
        }
        $epoch = new DateTimeImmutable('1899-12-30');
        $days  = (int) $epoch->diff($d)->days;
        return (float) ($d < $epoch ? -$days : $days);
    }

    /**
     * ชื่อชีทที่ Excel ยอมรับ — ยาวไม่เกิน 31 ตัว ห้ามมี : \ / ? * [ ] และห้ามซ้ำ
     *
     * ชื่อซ้ำทำให้ Excel ปฏิเสธทั้งไฟล์ ไม่ใช่แค่เปลี่ยนชื่อให้ — เติมเลขต่อท้าย
     * ดีกว่าปล่อยให้ไฟล์เปิดไม่ได้เพราะร้านบังเอิญมีสองชีทชื่อเหมือนกัน
     */
    private function uniqueName(string $raw): string
    {
        $name = trim(preg_replace('#[:\\\\/?*\[\]]#u', '-', $raw) ?? '');
        if (mb_strlen($name) > 31) {
            $name = mb_substr($name, 0, 31);
        }
        if ($name === '') {
            $name = 'Sheet';
        }
        $taken = array_map(fn(XlsxSheet $s) => mb_strtolower($s->name), $this->sheets);
        $try   = $name;
        $i     = 2;
        while (in_array(mb_strtolower($try), $taken, true)) {
            $suffix = ' (' . $i++ . ')';
            $try    = mb_substr($name, 0, 31 - mb_strlen($suffix)) . $suffix;
        }
        return $try;
    }
}

/** หนึ่งชีท — เก็บแถวไว้ในหน่วยความจำแล้วแปลงเป็น XML ทีเดียวตอนบันทึก */
final class XlsxSheet
{
    public string $name;

    /** @var array<int, array<int, mixed>> */
    private array $rows     = [];
    private array $widths   = [];
    private array $charts   = [];
    private int $freeze     = 0;
    private ?string $filter = null;

    public function __construct(string $name)
    {
        $this->name = $name;
    }

    /** ความกว้างคอลัมน์ หน่วยเป็นจำนวนตัวอักษรโดยประมาณ */
    public function widths(array $chars): self
    {
        $this->widths = $chars;
        return $this;
    }

    /** ตรึงแถวหัวตารางไว้ตอนเลื่อนลง */
    public function freeze(int $rows): self
    {
        $this->freeze = $rows;
        return $this;
    }

    /** เปิดปุ่มกรองบนหัวตาราง — แถวที่ระบุต้องเป็นหัวตารางจริง */
    public function filterFrom(int $headerRow, int $cols, int $lastRow): self
    {
        $this->filter = 'A' . $headerRow . ':' . Xlsx::colName($cols) . max($headerRow, $lastRow);
        return $this;
    }

    /**
     * เติมหนึ่งแถว · ค่าที่ไม่ได้ห่อด้วย Xlsx::t/n/d จะเดาชนิดให้:
     * สตริงเป็นข้อความ ตัวเลขเป็นตัวเลข null เป็นช่องว่าง
     */
    public function row(array $cells): self
    {
        $this->rows[] = $cells;
        return $this;
    }

    /** แถวว่างคั่น */
    public function gap(int $n = 1): self
    {
        for ($i = 0; $i < $n; $i++) {
            $this->rows[] = [];
        }
        return $this;
    }

    /** เลขแถวถัดไปที่จะถูกเขียน — ใช้ประกอบสูตรที่ต้องอ้างช่วงแถว */
    public function nextRow(): int
    {
        return count($this->rows) + 1;
    }

    /**
     * วางกราฟหนึ่งอันบนชีท — ดูรูปแบบ $spec ที่ Xlsx::chartXml()
     *
     * `anchor` เป็น [คอลัมน์เริ่ม, แถวเริ่ม, คอลัมน์จบ, แถวจบ] นับจาก 0 (A = 0)
     */
    public function chart(array $spec): self
    {
        $this->charts[] = $spec;
        return $this;
    }

    /** @return array[] สเปกกราฟทั้งหมดของชีทนี้ */
    public function charts(): array
    {
        return $this->charts;
    }

    public function xml(): string
    {
        $cols = '';
        if ($this->widths) {
            $cols = '<cols>';
            foreach ($this->widths as $i => $w) {
                $cols .= sprintf(
                    '<col min="%d" max="%d" width="%s" customWidth="1"/>',
                    $i + 1,
                    $i + 1,
                    number_format((float) $w, 2, '.', '')
                );
            }
            $cols .= '</cols>';
        }

        $pane = '';
        if ($this->freeze > 0) {
            $pane = sprintf(
                '<pane ySplit="%d" topLeftCell="A%d" activePane="bottomLeft" state="frozen"/>'
                . '<selection pane="bottomLeft" activeCell="A%d" sqref="A%d"/>',
                $this->freeze,
                $this->freeze + 1,
                $this->freeze + 1,
                $this->freeze + 1
            );
        }

        $body = '';
        foreach ($this->rows as $i => $cells) {
            $body .= $this->rowXml($i + 1, $cells);
        }

        /* xmlns:r ประกาศเฉพาะตอนมีกราฟ — แท็ก <drawing> เป็นที่เดียวในชีทที่ใช้มัน
           · <drawing> ต้องอยู่ท้ายสุดตามลำดับที่สเปกกำหนด (หลัง autoFilter) */
        return Xlsx::DECL
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            . ($this->charts ? ' xmlns:r="' . Xlsx::REL_NS . '"' : '') . '>'
            . '<sheetViews><sheetView workbookViewId="0">' . $pane . '</sheetView></sheetViews>'
            . '<sheetFormatPr defaultRowHeight="15"/>'
            . $cols
            . '<sheetData>' . $body . '</sheetData>'
            . ($this->filter !== null ? '<autoFilter ref="' . $this->filter . '"/>' : '')
            . ($this->charts ? '<drawing r:id="rId1"/>' : '')
            . '</worksheet>';
    }

    private function rowXml(int $r, array $cells): string
    {
        if (!$cells) {
            return '<row r="' . $r . '"/>';
        }
        $out = '<row r="' . $r . '">';
        $col = 0;
        foreach ($cells as $cell) {
            $col++;
            $c = self::normalise($cell);
            if ($c === null) {
                continue;
            }
            $ref   = Xlsx::colName($col) . $r;
            $style = $c['s'] ? ' s="' . (int) $c['s'] . '"' : '';
            if ($c['k'] === 'f') {
                $out .= '<c r="' . $ref . '"' . $style . '><f>' . Xlsx::esc($c['f']) . '</f>'
                    . '<v>' . self::numText((float) $c['v']) . '</v></c>';
                continue;
            }
            if ($c['k'] === 'n') {
                $out .= '<c r="' . $ref . '"' . $style . '><v>' . self::numText((float) $c['v']) . '</v></c>';
                continue;
            }
            $text = $c['k'] === 'blank' ? '' : (string) $c['v'];
            if ($text === '') {
                /* เซลล์ว่างที่มีสไตล์ยังต้องเขียน ไม่งั้นเส้นใต้หัวตารางขาดช่วง
                   ส่วนช่องว่างที่ไม่มีสไตล์ข้ามไปเลย ประหยัดขนาดไฟล์ */
                $out .= $style === '' ? '' : '<c r="' . $ref . '"' . $style . '/>';
                continue;
            }
            /* xml:space="preserve" กันช่องว่างหัวท้ายหาย — ชื่อลูกค้าที่นำเข้ามา
               จากระบบเก่ามีเว้นวรรคติดมาบ่อย และการตัดทิ้งเงียบ ๆ ทำให้ค่าที่
               ส่งออกไม่ตรงกับที่เก็บไว้ */
            $out .= '<c r="' . $ref . '"' . $style . ' t="inlineStr"><is>'
                . '<t xml:space="preserve">' . Xlsx::esc($text) . '</t></is></c>';
        }
        return $out . '</row>';
    }

    /** ค่าดิบ -> รูปเซลล์มาตรฐาน · null = ข้ามไปเลย (ประหยัดขนาดไฟล์) */
    private static function normalise(mixed $cell): ?array
    {
        if ($cell === null) {
            return null;
        }
        if (is_array($cell)) {
            return $cell;
        }
        if (is_int($cell) || is_float($cell)) {
            return ['k' => 'n', 'v' => (float) $cell, 's' => Xlsx::PLAIN];
        }
        if (is_bool($cell)) {
            return ['k' => 's', 'v' => $cell ? 'ใช่' : 'ไม่', 's' => Xlsx::PLAIN];
        }
        return ['k' => 's', 'v' => (string) $cell, 's' => Xlsx::PLAIN];
    }

    /** ตัวเลขในไฟล์ต้องเป็นรูปแบบกลาง ไม่ใช่รูปแบบตาม locale ของเครื่อง */
    private static function numText(float $v): string
    {
        if ($v == (int) $v && abs($v) < 1e15) {
            return (string) (int) $v;
        }
        return rtrim(rtrim(number_format($v, 6, '.', ''), '0'), '.');
    }
}
