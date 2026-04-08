Add-Type -Assembly System.IO.Compression.FileSystem

$xlsxPath = "C:\Users\Adeline\WorkBuddy\20260320154140\quote-system\data\source.xlsx"
$outputDir = "C:\Users\Adeline\WorkBuddy\20260320154140\quote-system\data"

$zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)

# Build shared strings
$ssEntry = $zip.GetEntry('xl/sharedStrings.xml')
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
        $combined = ''
        foreach ($r in $si.r) { $combined += $r.t.InnerText }
        $strings += $combined
    } else { $strings += '' }
}

function Get-CellValue($cell, $ss) {
    if ($cell -eq $null) { return '' }
    $t = $cell.GetAttribute('t')
    $v = $cell.v
    if ($t -eq 's') { return $ss[[int]$v] }
    elseif ($v -ne $null) { return $v }
    return ''
}

function Get-SheetRows($zip, $sheetFile, $ss) {
    $entry = $zip.GetEntry($sheetFile)
    if ($entry -eq $null) { return @() }
    $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    $content = $reader.ReadToEnd()
    $reader.Close()
    $xml = [xml]$content
    $result = @()
    foreach ($row in $xml.worksheet.sheetData.row) {
        $r = $row.GetAttribute('r')
        $rowData = @{ row=$r; cells=[ordered]@{} }
        foreach ($cell in $row.c) {
            $ref = $cell.GetAttribute('r')
            $col = $ref -replace '[0-9]+',''
            $rowData.cells[$col] = Get-CellValue $cell $ss
        }
        $result += $rowData
    }
    return $result
}

function TryDouble($s) {
    $d = 0.0
    if ([double]::TryParse($s, [ref]$d)) { return $d }
    return $null
}

function EscapeJson($s) {
    return $s -replace '\\','\\' -replace '"','\"' -replace "`r`n",'\n' -replace "`n",'\n' -replace "`t",'\t'
}

# ============ CARRIER DEFINITIONS ============
# Each carrier: id, name, sheet, columns layout
# Layout: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
# Different sheets may have different column layouts

function ExtractCarrier_Standard($zip, $sheetFile, $ss, $colCountry, $colCode, $colMinW, $colMaxW, $colUnitPrice, $colHandling) {
    $rows = Get-SheetRows $zip $sheetFile $ss
    $records = @()
    foreach ($row in $rows) {
        $cells = $row.cells
        $country = $cells[$colCountry]
        $code = $cells[$colCode]
        $minWStr = $cells[$colMinW]
        $maxWStr = $cells[$colMaxW]
        $unitPriceStr = $cells[$colUnitPrice]
        $handlingStr = $cells[$colHandling]
        if (-not $country -or -not $code) { continue }
        if ($country -eq '国家' -or $country -eq '路向国' -or $country -eq '大洲/地区' -or $country -eq '国家/地区') { continue }
        $minW = TryDouble $minWStr
        $maxW = TryDouble $maxWStr
        $unitPrice = TryDouble $unitPriceStr
        $handling = TryDouble $handlingStr
        if ($minW -eq $null -or $unitPrice -eq $null) { continue }
        if ($maxW -eq $null) { $maxW = 99 }
        if ($handling -eq $null) { $handling = 0 }
        $records += @{
            country = $country
            code = ($code -replace '\s','').ToUpper()
            minWeight = $minW
            maxWeight = $maxW
            unitPrice = $unitPrice
            handlingFee = $handling
        }
    }
    return $records
}

# Extract all carriers
$carriers = @()

# 华翰特敏 - sheet3: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet3.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='huahan_tm'; name='华翰特敏'; category='敏感货'; rates=$data }
Write-Output "华翰特敏: $($data.Count) records"

# 燕文普货 - sheet4: B=country, C=code, G=minW, H=maxW, D=unitPrice, E=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet4.xml' $strings 'B' 'C' 'G' 'H' 'D' 'E'
$carriers += @{ id='yanwen_ph'; name='燕文普货'; category='普货'; rates=$data }
Write-Output "燕文普货: $($data.Count) records"

# 顺邮宝挂号 - sheet5: B=country, C=code (D), G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet5.xml' $strings 'B' 'D' 'G' 'H' 'K' 'L'
$carriers += @{ id='shun_gj'; name='顺邮宝挂号'; category='普货'; rates=$data }
Write-Output "顺邮宝挂号: $($data.Count) records"

# CneForClothes - sheet6: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet6.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='cne_clothes'; name='CNE服饰'; category='普货'; rates=$data }
Write-Output "CNE服饰: $($data.Count) records"

# CneForGeneral - sheet7: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet7.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='cne_general'; name='CNE普货'; category='普货'; rates=$data }
Write-Output "CNE普货: $($data.Count) records"

# 4PXForCosmetic - sheet8: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet8.xml' $strings 'C' 'D' 'G' 'H' 'K' 'L'
$carriers += @{ id='4px_cosmetic'; name='4PX化妆品'; category='敏感货'; rates=$data }
Write-Output "4PX化妆品: $($data.Count) records"

# 4PXForElectric - sheet9: same layout as sheet8
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet9.xml' $strings 'C' 'D' 'G' 'H' 'K' 'L'
$carriers += @{ id='4px_electric'; name='4PX带电'; category='敏感货'; rates=$data }
Write-Output "4PX带电: $($data.Count) records"

# 4PXForGeneral - sheet10
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet10.xml' $strings 'C' 'D' 'G' 'H' 'K' 'L'
$carriers += @{ id='4px_general'; name='4PX普货'; category='普货'; rates=$data }
Write-Output "4PX普货: $($data.Count) records"

# 4PXForClothes - sheet11
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet11.xml' $strings 'C' 'D' 'G' 'H' 'K' 'L'
$carriers += @{ id='4px_clothes'; name='4PX服饰'; category='普货'; rates=$data }
Write-Output "4PX服饰: $($data.Count) records"

# YwenForElectric - sheet12: B=country, C=code, G=minW, H=maxW, D=unitPrice, E=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet12.xml' $strings 'B' 'C' 'G' 'H' 'D' 'E'
$carriers += @{ id='ywen_electric'; name='燕文带电'; category='敏感货'; rates=$data }
Write-Output "燕文带电: $($data.Count) records"

# CNE带电化妆品 - sheet13: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet13.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='cne_edz'; name='CNE带电化妆品'; category='敏感货'; rates=$data }
Write-Output "CNE带电化妆品: $($data.Count) records"

# CNE全球优先 - sheet14
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet14.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='cne_priority'; name='CNE全球优先'; category='普货'; rates=$data }
Write-Output "CNE全球优先: $($data.Count) records"

# 华翰纯电 - sheet15: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet15.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='huahan_pure_elec'; name='华翰纯电'; category='敏感货'; rates=$data }
Write-Output "华翰纯电: $($data.Count) records"

# 华翰食品 - sheet16
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet16.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='huahan_food'; name='华翰食品'; category='敏感货'; rates=$data }
Write-Output "华翰食品: $($data.Count) records"

# 华翰特货 - sheet17
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet17.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='huahan_th'; name='华翰特货'; category='敏感货'; rates=$data }
Write-Output "华翰特货: $($data.Count) records"

# CNE全球特惠 - sheet18
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet18.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='cne_special'; name='CNE全球特惠'; category='普货'; rates=$data }
Write-Output "CNE全球特惠: $($data.Count) records"

# 华翰智慧选特惠 - sheet19
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet19.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='huahan_zhxth'; name='华翰智慧选特惠'; category='普货'; rates=$data }
Write-Output "华翰智慧选特惠: $($data.Count) records"

# 顺速宝Plus - sheet20
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet20.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='shun_plus'; name='顺速宝Plus'; category='普货'; rates=$data }
Write-Output "顺速宝Plus: $($data.Count) records"

# 蜂鸟普货 - sheet21: B=country, C=code, G=minW, H=maxW, K=unitPrice, L=handling
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet21.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='fengn_ph'; name='蜂鸟普货'; category='普货'; rates=$data }
Write-Output "蜂鸟普货: $($data.Count) records"

# 华翰甄选 - sheet22
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet22.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='huahan_zx'; name='华翰甄选'; category='普货'; rates=$data }
Write-Output "华翰甄选: $($data.Count) records"

# 华翰电子烟 - sheet23
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet23.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='huahan_ecigar'; name='华翰电子烟'; category='敏感货'; rates=$data }
Write-Output "华翰电子烟: $($data.Count) records"

# 蜂鸟敏感 - sheet24
$data = ExtractCarrier_Standard $zip 'xl/worksheets/sheet24.xml' $strings 'B' 'C' 'G' 'H' 'K' 'L'
$carriers += @{ id='fengn_sensitive'; name='蜂鸟敏感'; category='敏感货'; rates=$data }
Write-Output "蜂鸟敏感: $($data.Count) records"

$zip.Dispose()

# Build JSON manually
function ToJsonValue($v) {
    if ($v -is [double] -or $v -is [int]) { return "$v" }
    if ($v -is [string]) { return '"' + (EscapeJson $v) + '"' }
    return 'null'
}

$sb = New-Object System.Text.StringBuilder
$sb.AppendLine("[") | Out-Null
for ($ci = 0; $ci -lt $carriers.Count; $ci++) {
    $c = $carriers[$ci]
    $sb.AppendLine("  {") | Out-Null
    $sb.AppendLine("    `"id`": `"$($c.id)`",") | Out-Null
    $sb.AppendLine("    `"name`": `"$($c.name)`",") | Out-Null
    $sb.AppendLine("    `"category`": `"$($c.category)`",") | Out-Null
    $sb.AppendLine("    `"rates`": [") | Out-Null
    $rates = $c.rates
    for ($ri = 0; $ri -lt $rates.Count; $ri++) {
        $r = $rates[$ri]
        $comma = if ($ri -lt $rates.Count-1) { "," } else { "" }
        $country = EscapeJson $r.country
        $code = EscapeJson $r.code
        $sb.AppendLine("      {`"country`":`"$country`",`"code`":`"$code`",`"minWeight`":$($r.minWeight),`"maxWeight`":$($r.maxWeight),`"unitPrice`":$($r.unitPrice),`"handlingFee`":$($r.handlingFee)}$comma") | Out-Null
    }
    $sb.AppendLine("    ]") | Out-Null
    $carriersComma = if ($ci -lt $carriers.Count-1) { "  }," } else { "  }" }
    $sb.AppendLine($carriersComma) | Out-Null
}
$sb.AppendLine("]") | Out-Null

$jsonPath = Join-Path $outputDir "carriers.json"
[System.IO.File]::WriteAllText($jsonPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Output "carriers.json written to $jsonPath"

# ============ PRODUCT TABLE extraction ============
$zip2 = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)
$ssEntry2 = $zip2.GetEntry('xl/sharedStrings.xml')
$ssReader2 = New-Object System.IO.StreamReader($ssEntry2.Open(), [System.Text.Encoding]::UTF8)
$ssContent2 = $ssReader2.ReadToEnd()
$ssReader2.Close()
$ssXml2 = [xml]$ssContent2
$strings2 = @()
foreach ($si in $ssXml2.sst.si) {
    if ($si.t -ne $null) { 
        $val = $si.t
        if ($val -is [System.Xml.XmlElement]) { $strings2 += $val.InnerText }
        else { $strings2 += [string]$val }
    } elseif ($si.r -ne $null) {
        $combined = ''
        foreach ($r in $si.r) { $combined += $r.t.InnerText }
        $strings2 += $combined
    } else { $strings2 += '' }
}

# Product sheet2: A=name, B=code, C=spec, D=calcWeight, E=unitWeight, F=volWeight, G=size, I=unitPrice, J=shippingFee
$rows = Get-SheetRows $zip2 'xl/worksheets/sheet2.xml' $strings2
$products = @()
$currentName = ''
foreach ($row in $rows) {
    $cells = $row.cells
    $name = $cells['A']
    $code = $cells['B']
    $spec = $cells['C']
    $calcWeight = $cells['D']
    $unitWeight = $cells['E']
    $volWeight = $cells['F']
    $size = $cells['G']
    $unitPrice = $cells['I']
    $shippingFee = $cells['J']
    
    if ($name -and $name -ne '产品名字（Product name）') { $currentName = $name }
    if (-not $code -or $code -eq '产品编码Product type') { continue }
    if ($code -match '^(=|#)') { continue }
    
    $calcW = TryDouble $calcWeight
    $uPrice = TryDouble $unitPrice
    if ($calcW -eq $null -and $uPrice -eq $null) { continue }
    if ($uPrice -eq $null -or $uPrice -eq 0) { continue }
    
    $products += @{
        name = if ($currentName) { $currentName } else { '' }
        code = $code
        spec = if ($spec) { $spec } else { '' }
        calcWeight = if ($calcW -ne $null) { $calcW } else { 0 }
        unitWeight = $(if ((TryDouble $unitWeight) -ne $null) { TryDouble $unitWeight } else { 0 })
        volWeight = $(if ((TryDouble $volWeight) -ne $null) { TryDouble $volWeight } else { 0 })
        size = if ($size) { $size } else { '' }
        unitPrice = $uPrice
        shippingFee = $(if ((TryDouble $shippingFee) -ne $null) { TryDouble $shippingFee } else { 0 })
    }
}
$zip2.Dispose()
Write-Output "Products extracted: $($products.Count)"

$sbP = New-Object System.Text.StringBuilder
$sbP.AppendLine("[") | Out-Null
for ($pi = 0; $pi -lt $products.Count; $pi++) {
    $p = $products[$pi]
    $comma = if ($pi -lt $products.Count-1) { "," } else { "" }
    $name = EscapeJson $p.name
    $code = EscapeJson $p.code
    $spec = EscapeJson $p.spec
    $size = EscapeJson $p.size
    $sbP.AppendLine("  {`"name`":`"$name`",`"code`":`"$code`",`"spec`":`"$spec`",`"calcWeight`":$($p.calcWeight),`"unitWeight`":$($p.unitWeight),`"volWeight`":$($p.volWeight),`"size`":`"$size`",`"unitPrice`":$($p.unitPrice),`"shippingFee`":$($p.shippingFee)}$comma") | Out-Null
}
$sbP.AppendLine("]") | Out-Null

$productsPath = Join-Path $outputDir "products.json"
[System.IO.File]::WriteAllText($productsPath, $sbP.ToString(), [System.Text.Encoding]::UTF8)
Write-Output "products.json written to $productsPath"
Write-Output "DONE"
