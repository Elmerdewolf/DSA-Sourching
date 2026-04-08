Add-Type -Assembly System.IO.Compression.FileSystem

$xlsxPath = "C:\Users\Adeline\WorkBuddy\20260320154140\quote-system\data\source.xlsx"
$outputDir = "C:\Users\Adeline\WorkBuddy\20260320154140\quote-system\data"

$zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)

$ssEntry = $zip.GetEntry("xl/sharedStrings.xml")
$ssReader = New-Object System.IO.StreamReader($ssEntry.Open(), [System.Text.Encoding]::UTF8)
$ssContent = $ssReader.ReadToEnd()
$ssReader.Close()
$ssXml = [xml]$ssContent
$strings = @()
foreach ($si in $ssXml.sst.si) {
    if ($si.t -ne $null) { 
        $val = $si.t
        if ($val -is [System.Xml.XmlElement]) { $strings += $val.InnerText }
        else { $strings += [string]$val }
    } elseif ($si.r -ne $null) {
        $combined = ""
        foreach ($r in $si.r) { $combined += $r.t.InnerText }
        $strings += $combined
    } else { $strings += "" }
}

function Get-CellValue($cell, $ss) {
    if ($cell -eq $null) { return "" }
    $t = $cell.GetAttribute("t")
    $v = $cell.v
    if ($t -eq "s") { return $ss[[int]$v] }
    elseif ($v -ne $null) { return $v }
    return ""
}

function Get-SheetRows($zipObj, $sheetFile, $ss) {
    $entry = $zipObj.GetEntry($sheetFile)
    if ($entry -eq $null) { return @() }
    $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    $content = $reader.ReadToEnd()
    $reader.Close()
    $xml = [xml]$content
    $result = @()
    foreach ($row in $xml.worksheet.sheetData.row) {
        $r = $row.GetAttribute("r")
        $rowData = @{ row=$r; cells=[ordered]@{} }
        foreach ($cell in $row.c) {
            $ref = $cell.GetAttribute("r")
            $col = $ref -replace "[0-9]+",""
            $rowData.cells[$col] = Get-CellValue $cell $ss
        }
        $result += $rowData
    }
    return $result
}

function TryDouble($s) {
    $d = 0.0
    if ([double]::TryParse($s, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { return $d }
    return $null
}

function EJ($s) {
    return $s -replace "\\","\\" -replace '"','\"' -replace "`r`n","\n" -replace "`n","\n" -replace "`t","\t"
}

function D2S($v) { return $v.ToString("G", [System.Globalization.CultureInfo]::InvariantCulture) }

function ExtractCarrier($zipObj, $sheetFile, $ss, $colCountry, $colCode, $colMinW, $colMaxW, $colUnitPrice, $colHandling) {
    $rows = Get-SheetRows $zipObj $sheetFile $ss
    $records = @()
    foreach ($row in $rows) {
        $cells = $row.cells
        $country = [string]$cells[$colCountry]
        $code = [string]$cells[$colCode]
        if (-not $country -or -not $code) { continue }
        if ($code.Length -gt 12) { continue }
        $minW = TryDouble $cells[$colMinW]
        $maxW = TryDouble $cells[$colMaxW]
        $unitPrice = TryDouble $cells[$colUnitPrice]
        $handling = TryDouble $cells[$colHandling]
        if ($minW -eq $null -or $unitPrice -eq $null) { continue }
        if ($maxW -eq $null) { $maxW = 99.0 }
        if ($handling -eq $null) { $handling = 0.0 }
        $records += @{ country=$country; code=($code -replace "\s","").ToUpper(); minWeight=$minW; maxWeight=$maxW; unitPrice=$unitPrice; handlingFee=$handling }
    }
    return ,$records
}

$sheetDefs = @(
    @{ id="huahan_tm"; name="HuaHanSensitive"; dispName="华翰特敏"; cat="sensitive"; file="sheet3"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="yanwen_ph"; name="YanwenGeneral"; dispName="燕文普货"; cat="general"; file="sheet4"; cc="B"; cd="C"; cm="G"; cx="H"; cu="D"; ch="E" },
    @{ id="shun_gj"; name="ShunYouBaoReg"; dispName="顺邮宝挂号"; cat="general"; file="sheet5"; cc="B"; cd="D"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="cne_clothes"; name="CNEClothes"; dispName="CNE服饰"; cat="general"; file="sheet6"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="cne_general"; name="CNEGeneral"; dispName="CNE普货"; cat="general"; file="sheet7"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="4px_cosmetic"; name="4PXCosmetic"; dispName="4PX化妆品"; cat="sensitive"; file="sheet8"; cc="C"; cd="D"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="4px_electric"; name="4PXElectric"; dispName="4PX带电"; cat="sensitive"; file="sheet9"; cc="C"; cd="D"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="4px_general"; name="4PXGeneral"; dispName="4PX普货"; cat="general"; file="sheet10"; cc="C"; cd="D"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="4px_clothes"; name="4PXClothes"; dispName="4PX服饰"; cat="general"; file="sheet11"; cc="C"; cd="D"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="ywen_electric"; name="YanwenElectric"; dispName="燕文带电"; cat="sensitive"; file="sheet12"; cc="B"; cd="C"; cm="G"; cx="H"; cu="D"; ch="E" },
    @{ id="cne_edz"; name="CNEElecCosmetic"; dispName="CNE带电化妆品"; cat="sensitive"; file="sheet13"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="cne_priority"; name="CNEPriority"; dispName="CNE全球优先"; cat="general"; file="sheet14"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="huahan_pure_elec"; name="HuaHanPureElec"; dispName="华翰纯电"; cat="sensitive"; file="sheet15"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="huahan_food"; name="HuaHanFood"; dispName="华翰食品"; cat="sensitive"; file="sheet16"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="huahan_th"; name="HuaHanSpecialCargo"; dispName="华翰特货"; cat="sensitive"; file="sheet17"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="cne_special"; name="CNESpecialOffer"; dispName="CNE全球特惠"; cat="general"; file="sheet18"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="huahan_zhxth"; name="HuaHanSmartSelect"; dispName="华翰智慧选特惠"; cat="general"; file="sheet19"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="shun_plus"; name="ShunSuBaoPlus"; dispName="顺速宝Plus"; cat="general"; file="sheet20"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="fengn_ph"; name="FengNiaoGeneral"; dispName="蜂鸟普货"; cat="general"; file="sheet21"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="huahan_zx"; name="HuaHanSelected"; dispName="华翰甄选"; cat="general"; file="sheet22"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="huahan_ecigar"; name="HuaHanECig"; dispName="华翰电子烟"; cat="sensitive"; file="sheet23"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" },
    @{ id="fengn_sensitive"; name="FengNiaoSensitive"; dispName="蜂鸟敏感"; cat="sensitive"; file="sheet24"; cc="B"; cd="C"; cm="G"; cx="H"; cu="K"; ch="L" }
)

$carriers = @()
foreach ($def in $sheetDefs) {
    $data = ExtractCarrier $zip ("xl/worksheets/" + $def.file + ".xml") $strings $def.cc $def.cd $def.cm $def.cx $def.cu $def.ch
    $carriers += @{ id=$def.id; name=$def.dispName; category=$def.cat; rates=$data }
    Write-Output "$($def.dispName): $($data.Count) records"
}
$zip.Dispose()

$sb = New-Object System.Text.StringBuilder
$sb.Append("[") | Out-Null
for ($ci = 0; $ci -lt $carriers.Count; $ci++) {
    $c = $carriers[$ci]
    if ($ci -gt 0) { $sb.Append(",") | Out-Null }
    $sb.Append('{"id":"' + $c.id + '","name":"' + (EJ $c.name) + '","category":"' + $c.category + '","rates":[') | Out-Null
    $rates = $c.rates
    for ($ri = 0; $ri -lt $rates.Count; $ri++) {
        $r = $rates[$ri]
        if ($ri -gt 0) { $sb.Append(",") | Out-Null }
        $sb.Append('{"country":"' + (EJ $r.country) + '","code":"' + (EJ $r.code) + '","minWeight":' + (D2S $r.minWeight) + ',"maxWeight":' + (D2S $r.maxWeight) + ',"unitPrice":' + (D2S $r.unitPrice) + ',"handlingFee":' + (D2S $r.handlingFee) + '}') | Out-Null
    }
    $sb.Append("]}") | Out-Null
}
$sb.Append("]") | Out-Null

[System.IO.File]::WriteAllText((Join-Path $outputDir "carriers.json"), $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "carriers.json saved"

# Extract products
$zip3 = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)
$rows2 = Get-SheetRows $zip3 "xl/worksheets/sheet2.xml" $strings
$zip3.Dispose()

$products = @()
$currentName = ""
foreach ($row in $rows2) {
    $cells = $row.cells
    $name = [string]$cells["A"]
    $code = [string]$cells["B"]
    $spec = [string]$cells["C"]
    if ($name -and $name.Length -gt 2 -and $name -notmatch "^(Product|A)" ) { $currentName = $name }
    if (-not $code -or $code.Length -lt 2 -or $code -match "^(Product|B|=|#)" ) { continue }
    $uPrice = TryDouble $cells["I"]
    if ($uPrice -eq $null -or $uPrice -le 0) { continue }
    $calcW = TryDouble $cells["D"]
    if ($calcW -eq $null) { $calcW = 0.0 }
    $products += @{
        name = $currentName; code = $code; spec = if ($spec) { $spec } else { "" }
        calcWeight = $calcW
        unitWeight = $(if ((TryDouble $cells["E"]) -ne $null) { TryDouble $cells["E"] } else { 0.0 })
        volWeight = $(if ((TryDouble $cells["F"]) -ne $null) { TryDouble $cells["F"] } else { 0.0 })
        size = if ($cells["G"]) { [string]$cells["G"] } else { "" }
        unitPrice = $uPrice
        shippingFee = $(if ((TryDouble $cells["J"]) -ne $null) { TryDouble $cells["J"] } else { 0.0 })
    }
}
Write-Output "Products: $($products.Count)"

$sbP = New-Object System.Text.StringBuilder
$sbP.Append("[") | Out-Null
for ($pi = 0; $pi -lt $products.Count; $pi++) {
    $p = $products[$pi]
    if ($pi -gt 0) { $sbP.Append(",") | Out-Null }
    $sbP.Append('{"name":"' + (EJ $p.name) + '","code":"' + (EJ $p.code) + '","spec":"' + (EJ $p.spec) + '","calcWeight":' + (D2S $p.calcWeight) + ',"unitWeight":' + (D2S $p.unitWeight) + ',"volWeight":' + (D2S $p.volWeight) + ',"size":"' + (EJ $p.size) + '","unitPrice":' + (D2S $p.unitPrice) + ',"shippingFee":' + (D2S $p.shippingFee) + '}') | Out-Null
}
$sbP.Append("]") | Out-Null

[System.IO.File]::WriteAllText((Join-Path $outputDir "products.json"), $sbP.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "products.json saved"
Write-Output "ALL DONE"
