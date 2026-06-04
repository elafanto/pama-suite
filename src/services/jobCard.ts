/**
 * Hindi Job Card Generator — printable A4 pages (2 stage cards per sheet, 50% height each)
 */
import type { BoxCalcForm, BoxCalcJobCard, CureStatus } from '@/services/boxcalcUi'

// `results` stays loosely typed (Record) because the cards read deep,
// presentation-only paths off the calculator output. `form` is the real
// BoxCalcForm with jobCard required (the generator is only ever called once a
// job card exists), so a wrong key like data.f is still caught at build time.
export interface JobCardData {
  form: BoxCalcForm & { jobCard: BoxCalcJobCard }
  results: Record<string, any>
  cureStatus: CureStatus
  totalBundles: number
  twoPlyCount: number
}

const JobCardGenerator = (function () {

  // ============ HELPER FORMATTERS ============
  type Num = number | string | null | undefined
  const fmt = (n: Num, d = 2) => (n === null || n === undefined || isNaN(Number(n))) ? '-' : Number(n).toFixed(d);
  const fmtInt = (n: Num) => (n === null || n === undefined || isNaN(Number(n))) ? '-' : Math.round(Number(n)).toString();
  const fmtMoney = (n: Num) => {
    if (n === null || n === undefined || isNaN(Number(n))) return '₹0.00';
    return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '_______________';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return String(d.getDate()).padStart(2, '0') + '/' +
           String(d.getMonth() + 1).padStart(2, '0') + '/' +
           d.getFullYear();
  };
  const safe = (v: unknown, fallback = '_______________') => (v && String(v).trim()) ? String(v) : fallback;

  /**
   * Format dimension based on user's chosen unit (mm/inch)
   */
  function dimFmt(mmValue: number | null | undefined, unit: string) {
    if (mmValue === null || mmValue === undefined || isNaN(mmValue)) return '-';
    if (unit === 'inch') return (mmValue / 25.4).toFixed(2);
    return Math.round(mmValue).toString();
  }

  /**
   * Build dimension rows for master card — shows in user's unit + mm
   */
  function dimensionRowsHTML(f: any, r: any) {
    const unit = f.dimensionUnit || 'mm';
    const unitLabel = unit === 'inch' ? 'in' : 'mm';
    const showBoth = unit === 'inch'; // Show mm alongside inch for reference

    const inner = r.dimensions.inner;
    const outer = r.dimensions.outer;

    const innerStr = `${dimFmt(inner.L, unit)} × ${dimFmt(inner.W, unit)} × ${dimFmt(inner.H, unit)} ${unitLabel}`;
    const outerStr = `${dimFmt(outer.L, unit)} × ${dimFmt(outer.W, unit)} × ${dimFmt(outer.H, unit)} ${unitLabel}`;

    const innerMM = showBoth ? ` <span class="smaller" style="color:#64748b">(${Math.round(inner.L)}×${Math.round(inner.W)}×${Math.round(inner.H)} mm)</span>` : '';
    const outerMM = showBoth ? ` <span class="smaller" style="color:#64748b">(${Math.round(outer.L)}×${Math.round(outer.W)}×${Math.round(outer.H)} mm)</span>` : '';

    return `<div class="row">
      <div class="col"><span class="label">अंदर (Inner):</span> <span class="value mono">${innerStr}</span>${innerMM}</div>
      <div class="col"><span class="label">बाहर (Outer):</span> <span class="value mono">${outerStr}</span>${outerMM}</div>
    </div>`;
  }

  // ============ CSS STYLES ============
  // Cards flow at full, readable size; pages are grouped by content density
  // (3 + 2 + 3 + 2) instead of squeezing two half-height cards onto each sheet.
  const styles = `
    @page {
      size: A4;
      margin: 8mm 6mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans Devanagari', 'Inter', system-ui, sans-serif;
      font-size: 9pt;
      line-height: 1.3;
      color: #1e293b;
      background: white;
    }
    .page {
      width: 198mm;
      page-break-after: always;
      page-break-inside: avoid;
    }
    .page:last-child { page-break-after: auto; }

    .card {
      border: 1.5px solid #000;
      padding: 6mm;
      margin-bottom: 4mm;
      page-break-inside: avoid;
    }
    .card.compact { padding: 4mm; font-size: 8.5pt; }

    /* Cut line */
    .cut-line {
      border-top: 1px dashed #9ca3af;
      text-align: center;
      margin: 3mm 0;
      position: relative;
      height: 4mm;
    }
    .cut-line::before {
      content: "✂ — — — — — — — — — — — — — — — — — — — — — — — — — —";
      position: absolute;
      top: -7px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      padding: 0 6px;
      color: #94a3b8;
      font-size: 8pt;
      letter-spacing: 2px;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #1e40af;
      padding-bottom: 2mm;
      margin-bottom: 3mm;
    }
    .card-title {
      font-size: 12pt;
      font-weight: 700;
      color: #1e40af;
    }
    .card-job {
      font-size: 9pt;
      color: #475569;
      font-weight: 600;
    }

    .row { display: flex; gap: 4mm; margin-bottom: 1.5mm; }
    .col { flex: 1; }
    .label { color: #64748b; font-size: 8pt; }
    .value { font-weight: 600; }

    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 2mm 0; }
    table th, table td { border: 1px solid #cbd5e1; padding: 2mm 1mm; text-align: left; }
    table th { background: #f1f5f9; font-weight: 600; }
    table td.num, table th.num { text-align: right; font-family: 'JetBrains Mono', monospace; }
    table td.center, table th.center { text-align: center; }

    .info-box {
      background: #f1f5f9;
      border-left: 3px solid #2563eb;
      padding: 2mm 3mm;
      margin: 2mm 0;
      font-size: 8.5pt;
    }
    .warn-box {
      background: #fef3c7;
      border-left: 3px solid #d97706;
      padding: 2mm 3mm;
      margin: 2mm 0;
      font-size: 8.5pt;
    }
    .success-box {
      background: #dcfce7;
      border-left: 3px solid #16a34a;
      padding: 2mm 3mm;
      margin: 2mm 0;
      font-size: 8.5pt;
    }

    .checklist { margin: 2mm 0; }
    .checklist label { display: block; margin: 0.8mm 0; font-size: 8.5pt; }
    .checklist input[type="checkbox"] {
      display: inline-block;
      width: 3mm; height: 3mm;
      border: 1.5px solid #475569;
      vertical-align: middle;
      margin-right: 2mm;
    }
    .check-inline { display: inline-block; margin-right: 4mm; }

    .stages-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1mm 4mm;
      margin: 2mm 0;
    }

    .signature-row {
      display: flex;
      gap: 6mm;
      margin-top: 3mm;
      padding-top: 2mm;
      border-top: 1px dotted #94a3b8;
      font-size: 8.5pt;
    }
    .signature-row > div { flex: 1; }

    .mono { font-family: 'JetBrains Mono', monospace; }
    .small { font-size: 8pt; }
    .smaller { font-size: 7.5pt; }
    .bold { font-weight: 700; }
    .center-text { text-align: center; }
    .red { color: #dc2626; }
    .green { color: #16a34a; }
    .blue { color: #1d4ed8; }
    .amber { color: #d97706; }

    .input-line {
      display: inline-block;
      border-bottom: 1px dotted #94a3b8;
      min-width: 30mm;
      padding: 0 2mm;
    }
    .input-line.lg { min-width: 60mm; }

    .empty-box {
      border: 1px solid #94a3b8;
      padding: 1mm 2mm;
      min-height: 5mm;
      display: inline-block;
      min-width: 18mm;
      font-family: 'JetBrains Mono', monospace;
    }

    h3.section-title {
      font-size: 9.5pt;
      color: #1e40af;
      margin: 2mm 0 1mm 0;
      padding: 1mm 0;
      border-bottom: 1px dotted #cbd5e1;
    }

    .badge {
      display: inline-block;
      padding: 0.5mm 2mm;
      border-radius: 2mm;
      font-size: 7.5pt;
      font-weight: 600;
    }
    .badge-blue { background: #dbeafe; color: #1d4ed8; }
    .badge-amber { background: #fef3c7; color: #b45309; }
    .badge-green { background: #dcfce7; color: #15803d; }

    @media screen {
      body { background: #f1f5f9; padding: 10mm; }
      .page {
        background: white;
        padding: 8mm 6mm;
        margin: 0 auto 8mm auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        width: 210mm;
        min-height: 297mm;
      }
      .print-btn {
        position: fixed;
        top: 10px;
        right: 10px;
        padding: 10px 20px;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 100;
      }
      .print-btn:hover { background: #1d4ed8; }
    }
    @media print {
      .print-btn { display: none; }
      body { background: white; padding: 0; }
      .page { box-shadow: none; margin: 0; padding: 0; width: auto; min-height: auto; }
    }
  `;

  /** Assemble a page from a list of card HTML strings, with cut lines between. */
  function pageOf(...cards: string[]) {
    return `<div class="page">${cards.join('\n      <div class="cut-line"></div>\n      ')}</div>`;
  }

  // ============ CARD 1: MASTER (COVER) ============
  function masterCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;

    const layersHTML = f.layers.map(l =>
      `<div>• ${l.name}: ${l.gsm} GSM, ${l.bf} BF</div>`
    ).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 मास्टर कार्ड (कवर पेज)</div>
          <div class="card-job">कार्य संख्या: <span class="mono bold">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="row">
          <div class="col"><span class="label">कंपनी:</span> <span class="value">${safe(jc.companyName)}</span></div>
          <div class="col"><span class="label">प्राथमिकता:</span> <span class="value">${safe(jc.priority, 'सामान्य')}</span></div>
        </div>
        <div class="row">
          <div class="col"><span class="label">ग्राहक (Party):</span> <span class="value bold">${safe(f.customerName)}</span></div>
          <div class="col"><span class="label">बॉक्स नाम:</span> <span class="value bold">${safe(f.boxName, '-')}</span></div>
        </div>
        <div class="row">
          <div class="col"><span class="label">संपर्क:</span> <span class="value">${safe(jc.customerContact)} ${jc.customerPhone ? '| ' + jc.customerPhone : ''}</span></div>
          <div class="col"><span class="label">प्रकार:</span> <span class="badge ${f.printType === 'non-printed' ? 'badge-amber' : 'badge-blue'}">${f.printType === 'non-printed' ? '📄 बिना प्रिंट' : '🎨 प्रिंटेड'}</span></div>
        </div>
        <div class="row">
          <div class="col"><span class="label">आर्डर दिनांक:</span> <span class="value mono">${fmtDate(jc.orderDate)}</span></div>
          <div class="col"><span class="label">डिलीवरी:</span> <span class="value mono">${fmtDate(jc.deliveryDate)}</span></div>
        </div>

        <h3 class="section-title">📦 बॉक्स विवरण</h3>
        <div class="row">
          <div class="col"><span class="label">कंस्ट्रक्शन:</span> <span class="value">${f.ply.toUpperCase()} RSC, ${f.flute}-Flute</span></div>
          <div class="col"><span class="label">कैलिपर:</span> <span class="value mono">${r.caliper} mm</span></div>
        </div>
        ${dimensionRowsHTML(f, r)}
        <div class="row">
          <div class="col"><span class="label">शीट साइज:</span> <span class="value mono">${fmtInt(r.sheet.length)} × ${fmtInt(r.sheet.width)} mm</span></div>
          <div class="col"><span class="label">बॉक्स वजन:</span> <span class="value mono">${fmt(r.weight.boxTotal, 1)} gm</span></div>
        </div>

        <h3 class="section-title">📄 कागज विवरण</h3>
        <div class="smaller" style="line-height: 1.5">${layersHTML}</div>

        <h3 class="section-title">📊 मात्रा एवं मूल्य</h3>
        <div class="row">
          <div class="col"><span class="label">आर्डर मात्रा:</span> <span class="value bold">${f.quantity} बॉक्स</span></div>
          <div class="col"><span class="label">बनाने हैं (+${f.productionWastePercent}% wastage):</span> <span class="value bold">${Math.ceil(f.quantity * (1 + f.productionWastePercent/100))} बॉक्स</span></div>
        </div>
        <div class="row">
          <div class="col"><span class="label">रेट:</span> <span class="value">${fmtMoney(r.cost.sellingPrice)}/बॉक्स</span></div>
          <div class="col"><span class="label">कुल मूल्य:</span> <span class="value bold green">${fmtMoney(r.order.totalValue)}</span></div>
        </div>

        <h3 class="section-title">✅ प्रोडक्शन स्टेज (पूरा होने पर ✓ करें)</h3>
        <div class="stages-grid checklist">
          <label><input type="checkbox"> 1. कागज जारी</label>
          <label><input type="checkbox"> 2. कोरुगेशन</label>
          <label><input type="checkbox"> 3. शीट कटिंग</label>
          <label><input type="checkbox"> 4. शीट पेस्टिंग</label>
          <label><input type="checkbox"> 5. स्लिटर स्कोरर</label>
          <label><input type="checkbox"> 6. प्रिंटर स्लॉटर</label>
          <label><input type="checkbox"> 7. स्टिचिंग</label>
          <label><input type="checkbox"> 8. बंडलिंग</label>
          <label><input type="checkbox"> 9. डिस्पैच</label>
        </div>

        <div class="signature-row">
          <div>सुपरवाइज़र: <span class="input-line lg"></span></div>
          <div>दिनांक: <span class="input-line"></span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 2: PAPER ISSUE ============
  function paperIssueCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;

    // 2-ply requirement
    const twoPlyCount = data.twoPlyCount; // 1 for 3-ply, 2 for 5-ply, 3 for 7-ply
    const isMultiPly = twoPlyCount > 1;

    // Build reels list
    const reelsHTML = r.reelOrders.map((order: any) => `
      <tr>
        <td>${order.name}</td>
        <td class="num">${order.gsm} / ${order.bf}</td>
        <td class="num">${r.reel.reelWidthMM} mm</td>
        <td class="num">${order.reelLengthM} m</td>
        <td class="num bold">${order.reelsToOrder} रील</td>
        <td class="num">${fmt(order.totalOrderKg, 0)} kg</td>
      </tr>
    `).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📦 कागज जारी पर्ची (Paper Issue)</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="info-box">
          स्टोर से ये रील निकालें। अनुशंसित रील चौड़ाई: <span class="bold mono">${r.reel.reelWidthMM} mm</span>
          (${r.reel.sheetsPerWidth} शीट प्रति चौड़ाई)
        </div>

        <table>
          <thead>
            <tr>
              <th>लेयर (Layer)</th>
              <th class="num">GSM / BF</th>
              <th class="num">रील चौड़ाई</th>
              <th class="num">रील लंबाई</th>
              <th class="num">मात्रा</th>
              <th class="num">कुल वजन</th>
            </tr>
          </thead>
          <tbody>${reelsHTML}</tbody>
        </table>

        ${isMultiPly ? `
        <div class="warn-box">
          ⚠️ <span class="bold">${f.ply.toUpperCase()}</span> बॉक्स के लिए <span class="bold">${twoPlyCount} × 2-ply</span>
          शीट चाहिए (corrugator से) + <span class="bold">1 × टॉप लाइनर</span> (पेस्टिंग के लिए)
        </div>
        ` : ''}

        <div class="row" style="margin-top: 3mm">
          <div class="col">
            <span class="label">कुल कागज वजन:</span> <span class="value bold mono">${fmt(r.order.paperWeightKg, 1)} kg</span>
          </div>
          <div class="col">
            <span class="label">कुल रील जारी:</span> <span class="value bold">${r.reelOrders.reduce((s: number, o: any)=>s+o.reelsToOrder, 0)} रील</span>
          </div>
        </div>

        <div class="signature-row">
          <div>स्टोरकीपर: <span class="input-line"></span></div>
          <div>प्राप्तकर्ता: <span class="input-line"></span></div>
          <div>समय: <span class="input-line" style="min-width:20mm"></span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 3: CORRUGATOR (2-PLY) ============
  function corrugatorCard(data: JobCardData) {
    const f = data.form;
    const jc = f.jobCard;

    // Find liner and flute paper specs
    const topLiner = f.layers[0];
    const flute1 = f.layers[1];

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">⚙️ कोरुगेटर — 2-PLY आउटपुट</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="info-box">
          आउटपुट: <span class="bold">2-ply वेब</span> (1 लाइनर + 1 फ्लूट) — बाद में पेस्टिंग में जुड़ेगा
        </div>

        <h3 class="section-title">रील लगाएं (Mount these reels)</h3>
        <div class="row">
          <div class="col">• <span class="label">लाइनर स्टैंड:</span> <span class="value">${topLiner.gsm} GSM, ${topLiner.bf} BF</span></div>
          <div class="col">• <span class="label">फ्लूट स्टैंड:</span> <span class="value">${flute1.gsm} GSM, ${flute1.bf} BF</span></div>
        </div>

        <h3 class="section-title">मशीन सेटिंग</h3>
        <table>
          <tr><td><span class="label">फ्लूट रोल:</span></td><td class="bold">${f.flute}-Flute</td>
              <td><span class="label">स्टीम टेम्प:</span></td><td class="bold">170-180°C</td></tr>
          <tr><td><span class="label">गोंद GSM:</span></td><td class="bold">${f.starchGSM} gm/m²</td>
              <td><span class="label">स्पीड:</span></td><td class="bold">80-100 m/min</td></tr>
        </table>

        <h3 class="section-title">गुणवत्ता जांच</h3>
        <div class="checklist">
          <span class="check-inline"><input type="checkbox" style="display:inline-block;width:3mm;height:3mm;border:1.5px solid #475569;vertical-align:middle;margin-right:1mm"> कैलिपर ~ ${fmt(data.results.caliper - 0.4, 1)} mm</span>
          <span class="check-inline"><input type="checkbox"> Flute peaks साफ</span>
          <span class="check-inline"><input type="checkbox"> Bond strength OK</span>
        </div>

        <h3 class="section-title">⚠️ बर्बादी (Material Loss)</h3>
        <div class="row">
          <div class="col"><span class="label">Setup waste:</span> <span class="empty-box">${jc.materialLoss.corrugatorSetupKg || ''}</span> kg</div>
          <div class="col"><span class="label">Edge trim:</span> <span class="empty-box">${jc.materialLoss.corrugatorTrimKg || ''}</span> kg</div>
          <div class="col"><span class="label">Reject:</span> <span class="empty-box">${jc.materialLoss.corrugatorRejectKg || ''}</span> kg</div>
        </div>

        <div class="signature-row">
          <div>ऑपरेटर: <span class="input-line">${safe(jc.operators.corrugator, '_______________')}</span></div>
          <div>OK: ☐हां ☐ना</div>
          <div>शुरू: <span class="input-line" style="min-width:15mm"></span> अंत: <span class="input-line" style="min-width:15mm"></span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 4: SHEET CUTTER ============
  function sheetCutterCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;
    const sheetsNeeded = Math.ceil(f.quantity * (1 + f.productionWastePercent/100));
    const twoPlyCount = data.twoPlyCount;

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">✂️ शीट कटर (Cut-off Knife)</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="info-box">
          इनपुट: कोरुगेटर से <span class="bold">2-ply वेब</span> | आउटपुट: 2-ply शीट (लंबाई कट)
        </div>

        <div class="row">
          <div class="col"><span class="label">कट लंबाई:</span> <span class="value bold mono">${fmtInt(r.sheet.length)} mm</span></div>
          <div class="col"><span class="label">शीट चौड़ाई (वेब):</span> <span class="value mono">${r.reel.reelWidthMM} mm</span></div>
        </div>

        <h3 class="section-title">उत्पादन लक्ष्य</h3>
        <table>
          <tr><td>2-ply शीट चाहिए (${f.ply}):</td>
              <td class="num bold">${sheetsNeeded * twoPlyCount} शीट</td></tr>
          <tr><td>(${twoPlyCount} × ${sheetsNeeded} = ${twoPlyCount} 2-ply per ${f.ply} box)</td>
              <td class="num smaller">${sheetsNeeded} बॉक्स × ${twoPlyCount}</td></tr>
          <tr><td>प्रति cycle:</td><td class="num">1 शीट</td></tr>
          <tr><td>अनुमानित समय:</td><td class="num">~${Math.ceil(sheetsNeeded * twoPlyCount / 20)} मिनट</td></tr>
        </table>

        <h3 class="section-title">गुणवत्ता जांच</h3>
        <div class="checklist">
          <span class="check-inline"><input type="checkbox"> लंबाई ${fmtInt(r.sheet.length)} ± 2mm</span>
          <span class="check-inline"><input type="checkbox"> Square corners</span>
          <span class="check-inline"><input type="checkbox"> कोई tear नहीं</span>
          <span class="check-inline"><input type="checkbox"> Stack neatly</span>
        </div>

        <div class="row">
          <div class="col"><span class="label">⚠️ Reject:</span> <span class="empty-box">${jc.materialLoss.sheetCutterRejectNos || ''}</span> शीट</div>
          <div class="col"><span class="label">कारण:</span> <span class="input-line lg">${safe(jc.materialLoss.sheetCutterReason, '')}</span></div>
        </div>

        <div class="signature-row">
          <div>ऑपरेटर: <span class="input-line">${safe(jc.operators.sheetCutter, '_______________')}</span></div>
          <div>OK: ☐हां ☐ना</div>
        </div>
      </div>
    `;
  }

  // ============ CARD 5: SHEET PASTING (with cure timer) ============
  function pastingCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;
    const cure = data.cureStatus;
    const twoPlyCount = data.twoPlyCount;
    const sheetsNeeded = Math.ceil(f.quantity * (1 + f.productionWastePercent/100));

    const layerSequence = twoPlyCount === 1
      ? '<div>1. 2-ply शीट रखें (flute up)<br>2. गोंद लगाएं<br>3. टॉप लाइनर पेस्ट करें<br>= <span class="bold">3-ply तैयार</span></div>'
      : twoPlyCount === 2
      ? '<div>1. 2-ply शीट (flute down)<br>2. गोंद + 2-ply शीट (flute up)<br>3. गोंद + टॉप लाइनर<br>= <span class="bold">5-ply तैयार</span></div>'
      : '<div>1-3. तीन 2-ply शीट stack करें<br>4. हर लेयर पर गोंद<br>5. टॉप लाइनर पेस्ट<br>= <span class="bold">7-ply तैयार</span></div>';

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🔗 शीट पेस्टिंग</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="info-box">
          बनाना है: <span class="bold">${f.ply.toUpperCase()}</span> बोर्ड
          (${twoPlyCount} × 2-ply + 1 टॉप लाइनर)
        </div>

        <h3 class="section-title">इनपुट सामग्री</h3>
        <div class="row">
          <div class="col">• 2-ply शीट: <span class="bold mono">${sheetsNeeded * twoPlyCount}</span></div>
          <div class="col">• टॉप लाइनर: <span class="bold mono">${sheetsNeeded}</span> शीट</div>
        </div>

        <h3 class="section-title">परत क्रम (Layer Sequence)</h3>
        <div class="smaller" style="background:#fef9c3;padding:2mm;border-radius:2mm">
          ${layerSequence}
        </div>

        <h3 class="section-title">गोंद सेटिंग</h3>
        <div class="row smaller">
          <div class="col">गोंद: <span class="bold">स्टार्च ~${f.starchGSM} gm/m²</span></div>
          <div class="col">कुल गोंद: <span class="bold mono">${fmt(r.weight.starch * sheetsNeeded / 1000, 2)} kg</span></div>
        </div>

        <h3 class="section-title">⏰ Cure Timer (बहुत जरूरी)</h3>
        <div style="background:${cure.color === 'green' ? '#dcfce7' : cure.color === 'yellow' ? '#fef3c7' : '#f1f5f9'};padding:3mm;border-radius:2mm;border:1.5px solid ${cure.color === 'green' ? '#16a34a' : cure.color === 'yellow' ? '#ca8a04' : '#94a3b8'}">
          <div class="row">
            <div class="col"><span class="label">पेस्ट किया गया:</span> <span class="mono">${jc.pastingTime ? new Date(jc.pastingTime).toLocaleString('en-IN') : '_____________'}</span></div>
            <div class="col"><span class="label">Cure समय:</span> <span class="bold mono">${jc.cureDurationHours} घंटे</span></div>
          </div>
          <div class="row">
            <div class="col"><span class="label">तैयार होगा:</span> <span class="mono">${cure.readyAt || '_____________'}</span></div>
            <div class="col bold ${cure.color === 'green' ? 'green' : 'amber'}">${cure.message}</div>
          </div>
        </div>

        <div class="warn-box smaller">
          ⚠️ Cure पूरा होने से पहले स्लिटर स्कोरर पर ना भेजें!
        </div>

        <h3 class="section-title">गुणवत्ता जांच</h3>
        <div class="checklist">
          <span class="check-inline"><input type="checkbox"> कोई bubble नहीं</span>
          <span class="check-inline"><input type="checkbox"> Edges aligned</span>
          <span class="check-inline"><input type="checkbox"> Uniform glue</span>
          <span class="check-inline"><input type="checkbox"> ${jc.cureDurationHours}hr cure complete</span>
        </div>

        <div class="row">
          <div class="col"><span class="label">⚠️ Reject:</span> <span class="empty-box">${jc.materialLoss.pastingRejectNos || ''}</span> शीट</div>
          <div class="col"><span class="label">कारण:</span> <span class="input-line lg">${safe(jc.materialLoss.pastingRejectReason, '')}</span></div>
        </div>

        <div class="signature-row">
          <div>ऑपरेटर: <span class="input-line">${safe(jc.operators.pasting, '_______________')}</span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 6: SLITTER SCORER (detail-heavy) ============
  function slitterScorerCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;
    const clearance = r.sheet?.clearanceMM ?? 6;

    // Slitter blades
    const bladesHTML = r.machineSetup.slitterBlades.map((b: any) =>
      `<td class="num center">${fmtInt(b)}</td>`
    ).join('');
    const bladeHeadersHTML = r.machineSetup.slitterBlades.map((_: any, i: number) =>
      `<th class="num center">B${i+1}</th>`
    ).join('');

    // Multi-sheet creases
    const creasesHTML = r.machineSetup.multiSheetCreases.map((c: any) => `
      <tr>
        <td class="center bold">शीट ${c.sheetNumber}</td>
        <td class="num">${fmtInt(c.sheetLeftEdge)}</td>
        <td class="num bold blue">${fmtInt(c.w1Machine)}</td>
        <td class="num bold blue">${fmtInt(c.w2Machine)}</td>
      </tr>
    `).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">✂️ स्लिटर स्कोरर — सेटअप</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="info-box">
          इनपुट: ${f.ply} पेस्ट शीट | रील चौड़ाई: <span class="bold mono">${r.reel.reelWidthMM} mm</span>
          | शीट चौड़ाई: <span class="bold mono">${fmtInt(r.sheet.width)} mm</span> × ${r.reel.sheetsPerWidth} शीट
        </div>

        <h3 class="section-title">A) स्लिट ब्लेड पोज़िशन (रील के बायें किनारे से, mm में)</h3>
        <table>
          <thead><tr>${bladeHeadersHTML}</tr></thead>
          <tbody><tr>${bladesHTML}</tr></tbody>
        </table>
        <div class="smaller" style="color:#64748b">
          B1, B${r.machineSetup.slitterBlades.length} = ट्रिम कट | बीच के ब्लेड = शीट के बीच के कट
        </div>

        <h3 class="section-title">B) स्कोरर व्हील पोज़िशन (क्रीज़) — महत्वपूर्ण!</h3>
        <div class="warn-box smaller">
          ⚠️ हर शीट के लिए स्कोरर पोज़िशन <span class="bold">स्लिट ब्लेड + क्रीज़ ऑफसेट</span> है।
          W1 = sheet_left + ${fmtInt(r.machineSetup.creases.topCrease)}, W2 = sheet_left + ${fmtInt(r.machineSetup.creases.bottomCrease)}
        </div>

        <table>
          <thead>
            <tr>
              <th class="center">शीट #</th>
              <th class="num">बायां किनारा</th>
              <th class="num">W1 (टॉप क्रीज़)</th>
              <th class="num">W2 (बॉटम क्रीज़)</th>
            </tr>
          </thead>
          <tbody>${creasesHTML}</tbody>
        </table>
        <div class="smaller" style="color:#64748b">
          कुल स्कोरर व्हील: ${r.machineSetup.multiSheetCreases.length * 2} (2 प्रति शीट × ${r.machineSetup.multiSheetCreases.length} शीट)
        </div>

        <h3 class="section-title">C) शीट लेआउट</h3>
        <table class="smaller">
          <tr>
            <td class="center bold" style="background:#fef3c7">टॉप फ्लैप<br>${fmtInt(r.machineSetup.creases.topCrease)} mm</td>
            <td class="center" style="background:#dbeafe">बॉडी<br>${fmtInt(r.machineSetup.creases.bottomCrease - r.machineSetup.creases.topCrease)} mm</td>
            <td class="center bold" style="background:#fef3c7">बॉटम फ्लैप<br>${fmtInt(r.sheet.width - r.machineSetup.creases.bottomCrease - clearance)} mm</td>
            <td class="center smaller" style="background:#f1f5f9">Clear<br>${fmtInt(clearance)} mm</td>
          </tr>
        </table>

        <h3 class="section-title">गुणवत्ता + बर्बादी</h3>
        <div class="checklist smaller">
          <span class="check-inline"><input type="checkbox"> ट्रिम साफ</span>
          <span class="check-inline"><input type="checkbox"> शीट ${fmtInt(r.sheet.width)}±1mm</span>
          <span class="check-inline"><input type="checkbox"> क्रीज़ साफ (cracked नहीं)</span>
        </div>
        <div class="row">
          <div class="col"><span class="label">Trim:</span> <span class="empty-box">${jc.materialLoss.slitterTrimKg || ''}</span> kg</div>
          <div class="col"><span class="label">Reject:</span> <span class="empty-box">${jc.materialLoss.slitterRejectNos || ''}</span> शीट</div>
          <div class="col"><span class="label">ऑपरेटर:</span> <span class="input-line">${safe(jc.operators.slitterScorer, '________')}</span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 7: PRINTER SLOTTER ============
  function printerSlotterCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;

    const slotsHTML = r.machineSetup.slots.slots.map((s: any) =>
      `<td class="num center bold blue">${fmtInt(s)}</td>`
    ).join('');

    const panelsHTML = r.machineSetup.slots.panels.map((p: any) =>
      `<td class="center" style="background:${p.name.includes('Glue') ? '#fef3c7' : '#dbeafe'}">
        <span class="bold">${p.name.split(' ')[0]}</span><br>
        <span class="smaller">${fmtInt(p.width)} mm</span>
      </td>`
    ).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🎨 प्रिंटर स्लॉटर — सेटअप</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="info-box">
          शीट साइज: <span class="bold mono">${fmtInt(r.sheet.length)} × ${fmtInt(r.sheet.width)} mm</span>
          | फीड: <span class="bold">लंबाई पहले (${fmtInt(r.sheet.length)}mm)</span>
        </div>

        ${f.printType === 'non-printed' ? `
        <h3 class="section-title">A) प्रिंटिंग</h3>
        <div class="warn-box smaller">
          ⛔ <span class="bold">कोई प्रिंटिंग नहीं</span> — Non-Printed बॉक्स है। सीधे स्लॉटिंग पर जाएं।
        </div>
        ` : `
        <h3 class="section-title">A) प्रिंटिंग 🎨</h3>
        <div class="row smaller">
          <div class="col">• रंग: <span class="input-line lg"></span></div>
          <div class="col">• प्रिंट एरिया: सिर्फ बॉडी (फ्लैप पर नहीं)</div>
        </div>
        <div class="smaller">Body vertical zone: ${fmtInt(r.machineSetup.creases.topCrease)}-${fmtInt(r.machineSetup.creases.bottomCrease)} mm</div>
        `}

        <h3 class="section-title">B) स्लॉट पोज़िशन (शीट के बायें किनारे से, mm में)</h3>
        <table>
          <thead>
            <tr>
              <th class="num center">स्लॉट 1</th>
              <th class="num center">स्लॉट 2</th>
              <th class="num center">स्लॉट 3</th>
              <th class="num center">स्लॉट 4</th>
            </tr>
          </thead>
          <tbody><tr>${slotsHTML}</tr></tbody>
        </table>
        <div class="smaller" style="color:#64748b">
          स्लॉट गहराई: ${fmtInt(r.machineSetup.creases.topCrease)} mm (टॉप) + ${fmtInt(r.machineSetup.creases.topCrease)} mm (बॉटम)
          | ब्लेड चौड़ाई: 7 mm
        </div>

        <h3 class="section-title">C) वर्टिकल क्रीज़</h3>
        <div class="smaller">
          स्लॉट के <span class="bold">same पोज़िशन</span> पर 4 वर्टिकल क्रीज़:
          <span class="bold mono blue">${r.machineSetup.slots.slots.map((s: any) => fmtInt(s)).join(', ')} mm</span>
        </div>

        <h3 class="section-title">D) पैनल लेआउट</h3>
        <table class="smaller">
          <tr>${panelsHTML}</tr>
        </table>

        <h3 class="section-title">गुणवत्ता + बर्बादी</h3>
        <div class="checklist smaller">
          <span class="check-inline"><input type="checkbox"> Print registration सही</span>
          <span class="check-inline"><input type="checkbox"> Slot clean cut</span>
          <span class="check-inline"><input type="checkbox"> Crease sharp</span>
          <span class="check-inline"><input type="checkbox"> शीट straight</span>
        </div>
        <div class="row">
          <div class="col"><span class="label">Print reject:</span> <span class="empty-box">${jc.materialLoss.printerRejectNos || ''}</span> नग</div>
          <div class="col"><span class="label">Slot reject:</span> <span class="empty-box">${jc.materialLoss.slotterRejectNos || ''}</span> नग</div>
          <div class="col"><span class="label">ऑपरेटर:</span> <span class="input-line">${safe(jc.operators.printerSlotter, '________')}</span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 8: STITCHING ============
  function stitchingCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;
    const method = f.joining.method;

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📎 स्टिचिंग / साइड सीम</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="row">
          <div class="col"><span class="label">तरीका:</span> <span class="value bold">${method === 'stitching' ? 'तार स्टिचिंग' : method === 'fevicol' ? 'Fevicol CWP' : 'दोनों (Fevicol + Stitching)'}</span></div>
          ${method !== 'fevicol' && r.pinInfo ? `<div class="col"><span class="label">पिन:</span> <span class="value bold">${r.pinInfo.pins} nos (${r.pinInfo.headType === 'double' ? 'डबल हेड' : 'सिंगल हेड'})</span></div>` : ''}
        </div>
        ${method !== 'fevicol' && r.pinInfo ? `<div class="row">
          <div class="col"><span class="label">पिन गैप:</span> <span class="value">${r.pinInfo.spacing} mm apart</span></div>
          <div class="col"><span class="label">कुल लंबाई:</span> <span class="value">${f.dimensionUnit === 'inch' ? (r.dimensions.outer.H / 25.4).toFixed(2) + '"' : Math.round(r.dimensions.outer.H) + ' mm'}</span></div>
        </div>` : ''}

        <h3 class="section-title">प्रक्रिया</h3>
        <div class="smaller">
          1. प्रिंट+स्लॉट शीट लें<br>
          2. वर्टिकल क्रीज़ पर मोड़ें (rectangle tube बनाएं)<br>
          3. ग्लू फ्लैप (${r.glueFlap}mm) L1 पैनल पर अंदर overlap करें<br>
          ${method === 'fevicol' || method === 'both' ? `4. Fevicol CWP bead (1.5-2mm) फ्लैप पर लगाएं<br>5. 20-30 min weight से दबाएं<br>` : ''}
          ${method === 'stitching' || method === 'both' ? `${method === 'both' ? '6.' : '4.'} ${r.pinInfo ? r.pinInfo.pins : '—'} पिन लगाएं (${r.pinInfo ? r.pinInfo.headType === 'double' ? 'डबल हेड' : 'सिंगल हेड' : ''}, ${r.pinInfo ? r.pinInfo.spacing : '—'}mm gap)<br>` : ''}
        </div>

        <h3 class="section-title">गुणवत्ता जांच</h3>
        <div class="checklist smaller">
          ${method !== 'fevicol' ? `<span class="check-inline"><input type="checkbox"> Wire firm clinched</span>
          <span class="check-inline"><input type="checkbox"> कोई sharp end protruding नहीं</span>` : ''}
          <span class="check-inline"><input type="checkbox"> Seam straight</span>
          <span class="check-inline"><input type="checkbox"> Box square खुले</span>
          <span class="check-inline"><input type="checkbox"> Flat-folded properly</span>
        </div>

        <div class="row">
          <div class="col"><span class="label">⚠️ Reject:</span> <span class="empty-box">${jc.materialLoss.stitchingRejectNos || ''}</span> बॉक्स</div>
          <div class="col"><span class="label">तैयार बॉक्स:</span> <span class="input-line"></span></div>
        </div>

        <div class="signature-row">
          <div>ऑपरेटर: <span class="input-line">${safe(jc.operators.stitching, '_______________')}</span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 9: BUNDLING ============
  function bundlingCard(data: JobCardData) {
    const f = data.form;
    const r = data.results;
    const jc = f.jobCard;
    const totalBundles = data.totalBundles;

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📦 बंडलिंग</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="row">
          <div class="col"><span class="label">मात्रा:</span> <span class="value bold">${f.quantity} बॉक्स</span></div>
          <div class="col"><span class="label">बंडल साइज:</span> <span class="value bold">${jc.bundleSize} बॉक्स</span></div>
          <div class="col"><span class="label">कुल बंडल:</span> <span class="value bold green">${totalBundles}</span></div>
        </div>

        <h3 class="section-title">प्रक्रिया</h3>
        <div class="smaller">
          • बॉक्स को flat-fold करें<br>
          • ${jc.bundleSize} का stack बनाएं<br>
          • 2 PP straps (cross pattern)<br>
          • हर बंडल पर label चिपकाएं
        </div>

        <h3 class="section-title">बंडल लेबल (नमूना)</h3>
        <div style="border:2px solid #1e40af;padding:3mm;background:#eff6ff;display:inline-block;min-width:60mm">
          <div class="bold">${safe(f.customerName, 'ग्राहक')}</div>
          <div class="smaller mono">कार्य #${safe(jc.jobNumber)}</div>
          <div class="smaller">बंडल <span class="empty-box smaller" style="min-width:8mm">__</span> / ${totalBundles}</div>
          <div class="smaller">मात्रा: ${jc.bundleSize} बॉक्स</div>
          <div class="smaller">${f.ply} ${fmtInt(r.dimensions.inner.L)}×${fmtInt(r.dimensions.inner.W)}×${fmtInt(r.dimensions.inner.H)} mm</div>
        </div>

        <h3 class="section-title">गुणवत्ता + बर्बादी</h3>
        <div class="checklist smaller">
          <span class="check-inline"><input type="checkbox"> Strap tight</span>
          <span class="check-inline"><input type="checkbox"> Label सही</span>
          <span class="check-inline"><input type="checkbox"> Count verified</span>
        </div>
        <div class="row">
          <div class="col"><span class="label">Final QC reject:</span> <span class="empty-box">${jc.materialLoss.bundlingRejectNos || ''}</span></div>
          <div class="col"><span class="label">तैयार बंडल:</span> <span class="input-line"></span></div>
        </div>

        <div class="signature-row">
          <div>ऑपरेटर: <span class="input-line">${safe(jc.operators.bundling, '_______________')}</span></div>
        </div>
      </div>
    `;
  }

  // ============ CARD 10: DISPATCH ============
  function dispatchCard(data: JobCardData) {
    const f = data.form;
    const jc = f.jobCard;
    const totalBundles = data.totalBundles;

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🚚 डिस्पैच</div>
          <div class="card-job">कार्य: <span class="mono">${safe(jc.jobNumber)}</span></div>
        </div>

        <div class="row">
          <div class="col"><span class="label">ग्राहक:</span> <span class="value bold">${safe(f.customerName)}</span></div>
          <div class="col"><span class="label">डिलीवरी:</span> <span class="value mono">${fmtDate(jc.deliveryDate)}</span></div>
        </div>
        <div class="row">
          <div class="col"><span class="label">संपर्क:</span> <span class="value">${safe(jc.customerContact)} | ${safe(jc.customerPhone)}</span></div>
        </div>
        <div class="row">
          <div class="col"><span class="label">पता:</span> <span class="value">${safe(jc.customerAddress)}</span></div>
        </div>

        <h3 class="section-title">डिस्पैच विवरण</h3>
        <table class="smaller">
          <tr><td>वाहन नंबर:</td><td><span class="input-line lg"></span></td></tr>
          <tr><td>ड्राइवर:</td><td><span class="input-line lg"></span></td></tr>
          <tr><td>फोन:</td><td><span class="input-line lg"></span></td></tr>
          <tr><td>निकलने का समय:</td><td><span class="input-line lg"></span></td></tr>
        </table>

        <h3 class="section-title">Final Checklist</h3>
        <div class="checklist smaller">
          <label><input type="checkbox"> ${f.quantity} बॉक्स spec के अनुसार</label>
          <label><input type="checkbox"> Quality OK (sample check)</label>
          <label><input type="checkbox"> ${totalBundles} बंडल सब labeled</label>
          <label><input type="checkbox"> Invoice attached</label>
          <label><input type="checkbox"> Customer copy of job card</label>
          <label><input type="checkbox"> Delivery challan signed</label>
        </div>

        <h3 class="section-title">ग्राहक रसीद (Customer Receipt)</h3>
        <div style="background:#f1f5f9;padding:3mm;border-radius:2mm">
          <div class="row smaller">
            <div class="col">प्राप्त किया: <span class="input-line lg"></span></div>
          </div>
          <div class="row smaller">
            <div class="col">मात्रा OK: ☐हां ☐ना</div>
            <div class="col">Quality OK: ☐हां ☐ना</div>
          </div>
          <div class="row smaller">
            <div class="col">हस्ताक्षर: <span class="input-line lg"></span></div>
            <div class="col">दिनांक/समय: <span class="input-line"></span></div>
          </div>
        </div>
      </div>
    `;
  }

  // ============ MAIN GENERATOR ============
  function generate(data: JobCardData) {
    // Pages grouped by content density so each card prints at full, readable size:
    //   1: Master + Paper Issue + Corrugator
    //   2: Slitter Scorer + Printer Slotter (detail-heavy → 2 per page)
    //   3: Sheet Cutter + Pasting + Stitching
    //   4: Bundling + Dispatch
    const pages = [
      pageOf(masterCard(data), paperIssueCard(data), corrugatorCard(data)),
      pageOf(slitterScorerCard(data), printerSlotterCard(data)),
      pageOf(sheetCutterCard(data), pastingCard(data), stitchingCard(data)),
      pageOf(bundlingCard(data), dispatchCard(data)),
    ].join('\n');

    return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <title>कार्य कार्ड - ${safe(data.form.jobCard.jobNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${styles}</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Print Job Card</button>
  ${pages}
</body>
</html>`;
  }

  // Public API
  return {
    generate: generate
  };
})()

export function generateJobCard(data: JobCardData): string {
  return JobCardGenerator.generate(data)
}

export function openJobCardPrintWindow(data: JobCardData): void {
  const html = generateJobCard(data)
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) {
    alert('Popup blocked! Allow popups to print job card.')
    return
  }
  w.document.write(html)
  w.document.close()
  setTimeout(() => {
    try { w.print() } catch { /* */ }
  }, 1500)
}
