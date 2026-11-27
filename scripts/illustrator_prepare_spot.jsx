/**
 * Adobe Illustrator ExtendScript (File -> Scripts -> Other Script...)
 * -------------------------------------------------------------------
 * Příprava otevřeného souboru (např. assets/logo_salajka_layers.svg nebo vygenerovaného PDF)
 * pro ofsetový / digitální tisk se speciální přímou barvou (Spot_UV / Embossing):
 *   1. Přepne dokument do barevného režimu CMYK.
 *   2. Vytvoří přímou (Spot) barvu "Spot_UV" (100% Magenta: C0 M100 Y0 K0).
 *   3. Najde vrstvu "03_Spot_UV_Embossing" (nebo "layer-spot-uv-emboss"), přiřadí všem
 *      jejím vektorovým cestám přímou barvu "Spot_UV" a zapne přetisk (Overprint Fill = true).
 *   4. Převede veškeré texty ve vrstvě Spot_UV do křivek (Create Outlines).
 *   5. Uloží tiskové PDF/X-4 s 3 mm spadávkou a ořezovými značkami.
 */

#target illustrator

(function () {
    if (app.documents.length === 0) {
        alert("Nejprve otevřete soubor etikety (SVG nebo AI) v Adobe Illustratoru.");
        return;
    }

    var doc = app.activeDocument;

    // 1. Vytvoření nebo nalezení přímé barvy Spot_UV (100% Magenta)
    var spotName = "Spot_UV";
    var spotColorObj;
    try {
        spotColorObj = doc.spots.getByName(spotName);
    } catch (e) {
        spotColorObj = doc.spots.add();
        spotColorObj.name = spotName;
        spotColorObj.colorType = ColorModel.SPOT;
        var cmyk = new CMYKColor();
        cmyk.cyan = 0;
        cmyk.magenta = 100;
        cmyk.yellow = 0;
        cmyk.black = 0;
        spotColorObj.color = cmyk;
    }

    var spotColor = new SpotColor();
    spotColor.spot = spotColorObj;
    spotColor.tint = 100;

    // 2. Vyhledání technické vrstvy pro Spot_UV / Embossing
    var targetLayer = null;
    for (var i = 0; i < doc.layers.length; i++) {
        var lyrName = doc.layers[i].name;
        if (lyrName.indexOf("Spot_UV") !== -1 || lyrName.indexOf("spot-uv") !== -1 || lyrName.indexOf("Embossing") !== -1) {
            targetLayer = doc.layers[i];
            break;
        }
    }

    if (!targetLayer) {
        alert("Vrstva '03_Spot_UV_Embossing' nebyla v dokumentu nalezena.");
        return;
    }

    targetLayer.visible = true;
    targetLayer.locked = false;

    // 3. Převod textů ve vrstvě Spot_UV na křivky
    for (var t = targetLayer.textFrames.length - 1; t >= 0; t--) {
        targetLayer.textFrames[t].createOutline();
    }

    // 4. Rekurzivní přiřazení Spot_UV + Overprint všem objektům ve vrstvě
    function applySpotAndOverprint(container) {
        for (var j = 0; j < container.pathItems.length; j++) {
            var p = container.pathItems[j];
            p.filled = true;
            p.fillColor = spotColor;
            p.fillOverprint = true;
            p.stroked = false;
        }
        for (var c = 0; c < container.compoundPathItems.length; c++) {
            applySpotAndOverprint(container.compoundPathItems[c]);
        }
        for (var g = 0; g < container.groupItems.length; g++) {
            applySpotAndOverprint(container.groupItems[g]);
        }
    }

    applySpotAndOverprint(targetLayer);

    // 5. Export do tiskového PDF s 3 mm spadávkou a ořezovými značkami
    var pdfFile = new File(doc.path + "/" + doc.name.replace(/\.[^\.]+$/, "") + "_PDFX4_SpotUV.pdf");
    var opts = new PDFSaveOptions();
    opts.pDFPreset = "[PDF/X-4:2008]";
    opts.trimMarks = true;
    opts.offset = 8.504; // 3 mm odstup ořezek (v bodech)
    opts.bleedOffsetRect = [8.504, 8.504, 8.504, 8.504]; // 3 mm spadávka na všechny strany
    opts.preserveEditability = false;
    opts.acrobatLayers = true;

    doc.saveAs(pdfFile, opts);
    alert("Hotovo! Tiskové PDF se separací 'Spot_UV' (Overprint) uloženo do:\n" + pdfFile.fsName);
})();
