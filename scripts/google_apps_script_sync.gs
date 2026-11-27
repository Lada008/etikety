/**
 * Google Apps Script — Cloudová synchronizace šablon vín (Vinařství Salajka)
 *
 * Návod k nasazení (1 minuta, stačí udělat jednou):
 * 1. Otevřete Google Tabulku „Vinařství Salajka — Šablony etiket“.
 * 2. V horním menu klikněte na: Rozšíření → Apps Script.
 * 3. Smažte výchozí kód a vložte celý obsah tohoto souboru.
 * 4. Klikněte na ikonu diskety (Uložit).
 * 5. Vpravo nahoře klikněte na: Nasadit → Nové nasazení.
 * 6. Klikněte na ozubené kolečko u „Vyberte typ“ → Webová aplikace.
 *    - Spustit jako: Já (váš účet)
 *    - Kdo má přístup: Kdokoli (Anyone)
 * 7. Klikněte na „Nasadit“, povolte přístup a zkopírujte výslednou adresu Webové aplikace (končí na /exec).
 */

const SHEET_NAME = 'Vina';
const COLUMNS = [
  'kod', 'odrudy_nazev', 'zatrid_cukr', 'zatrid_kratke', 'rocnik',
  'vinicni_trat', 'cislo_sarze', 'energeticka_hodnota', 'alkohol', 'objem',
  'obsahuje', 'url_e_etiketa', 'slozeni', 'tuky', 'nasycene',
  'sacharidy', 'cukry', 'bilkoviny', 'sul', 'qr_rezim', 'styl_etikety'
];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) {
    return jsonOut_({ ok: true, rows: [] });
  }
  const headers = values[0].map((h) => String(h || '').trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const line = values[i];
    if (!line.some((cell) => String(cell || '').trim() !== '')) continue;
    const item = {};
    headers.forEach((h, idx) => {
      if (h) item[h] = String(line[idx] || '').trim();
    });
    rows.push(item);
  }
  return jsonOut_({ ok: true, rows: rows });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    const list = Array.isArray(payload.rows) ? payload.rows : [];
    if (!list.length) {
      return jsonOut_({ ok: false, error: 'Prázdný seznam šablon.' });
    }

    const sheet = getSheet_();
    const matrix = [COLUMNS];
    list.forEach((r) => {
      matrix.push(COLUMNS.map((c) => (r && r[c] != null ? String(r[c]) : '')));
    });

    sheet.clearContents();
    sheet.getRange(1, 1, matrix.length, COLUMNS.length).setValues(matrix);
    return jsonOut_({ ok: true, count: list.length });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
