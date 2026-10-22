/**
 * CleanXhedule Manager — Rotas: Documentos
 * Base: /api/v1/documents
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const {
  generateQuote,
  generateInvoice,
  getDocumentById,
  markDocumentSentWhatsApp,
} = require('../services/documents.service');

// Todos os endpoints de documentos requerem autenticação
router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /documents/quote/:booking_id — Gerar Orçamento
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/quote/:booking_id',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const doc = generateQuote(db, req.params.booking_id);
      return res.status(201).json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   POST & GET /documents/invoice/:booking_id — Gerar / Obter Fatura ou Recibo
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
function buildDocumentHtml(doc, company) {
  const isReceipt = doc.type === 'Recibo' || doc.payment_status === 'Pago';
  let docTitle = 'FATURA PROFORMA';
  let badgeBg = '#2563eb';
  if (doc.type === 'Orcamento') {
    docTitle = 'ORÇAMENTO';
    badgeBg = '#7c3aed';
  } else if (isReceipt) {
    docTitle = 'FATURA / RECIBO';
    badgeBg = '#00a650';
  }

  // Separa nome em parte principal (azul) e última palavra (dourado)
  const nameParts = (company.name || 'CleanXchedule Manager').trim().split(' ');
  const brandMain = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : (company.name || 'CleanXchedule');
  const brandAccent = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  // Linha localização + NIF
  const locationParts = [];
  if (company.location) locationParts.push(company.location);
  if (company.nif) locationParts.push('NIF: ' + company.nif);
  const locationLine = locationParts.length > 0 ? locationParts.join(' · ') : 'Luanda, Angola · NIF: 5417088921';

  // Formatação de datas
  function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    const day = String(dt.getDate()).padStart(2, '0');
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const year = dt.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Formatação monetária (ex: 82.000,00)
  function formatMoney(amount) {
    const num = Number(amount) || 0;
    const parts = num.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts.join(',');
  }

  // Cálculo de valores (Base, Desconto, Total)
  const finalAmount = Number(doc.final_amount) || 0;
  const discountAmount = Number(doc.discount) || 0;
  const travelFee = Number(doc.travel_fee) || 0;
  const baseAmount = finalAmount + discountAmount;
  const discountPercent = baseAmount > 0 && discountAmount > 0 ? Math.round((discountAmount / baseAmount) * 100) : 0;

  // Multiplicadores e cálculo de valores por serviço
  let primaryMult = 1.0;
  if (doc.item_size === 'Médio') {
    primaryMult = Number(doc.service_medium_multiplier) || 1.0;
  } else if (doc.item_size === 'Grande') {
    primaryMult = Number(doc.service_large_multiplier) || 1.0;
  }
  const primaryBase = Number(doc.base_service_price != null ? doc.base_service_price : doc.service_base_price) || 0;
  const primaryQty = Number(doc.item_quantity) || 1;
  let primaryAmount = primaryBase * primaryMult * primaryQty;

  let secondaryAmount = 0;
  const secondaryQty = Number(doc.secondary_item_quantity) || 1;
  if (doc.secondary_service_name) {
    let secMult = 1.0;
    if (doc.secondary_item_size === 'Médio') {
      secMult = Number(doc.secondary_medium_multiplier) || 1.0;
    } else if (doc.secondary_item_size === 'Grande') {
      secMult = Number(doc.secondary_large_multiplier) || 1.0;
    }
    const secBase = Number(doc.secondary_service_base_price) || 0;
    secondaryAmount = secBase * secMult * secondaryQty;
  }

  // Consistência com subtotais e baseAmount do agendamento
  const servicesSubtotal = Math.max(0, baseAmount - travelFee);
  if (doc.secondary_service_name) {
    if (primaryAmount === 0 && secondaryAmount === 0 && servicesSubtotal > 0) {
      primaryAmount = servicesSubtotal;
    } else if (primaryAmount === 0 && secondaryAmount > 0) {
      primaryAmount = Math.max(0, servicesSubtotal - secondaryAmount);
    } else if (secondaryAmount === 0 && primaryAmount > 0) {
      secondaryAmount = Math.max(0, servicesSubtotal - primaryAmount);
    } else if ((primaryAmount + secondaryAmount) !== servicesSubtotal && (primaryAmount + secondaryAmount) > 0) {
      const ratio = servicesSubtotal / (primaryAmount + secondaryAmount);
      primaryAmount = Math.round(primaryAmount * ratio * 100) / 100;
      secondaryAmount = Math.round((servicesSubtotal - primaryAmount) * 100) / 100;
    }
  } else {
    if (primaryAmount === 0 && servicesSubtotal > 0) {
      primaryAmount = servicesSubtotal;
    } else if (primaryAmount !== servicesSubtotal && servicesSubtotal > 0) {
      primaryAmount = servicesSubtotal;
    }
  }

  // Desconto HTML
  const discountRowHtml = discountAmount > 0 ? `
    <tr>
      <td style="padding: 2px 0; color: #000000;">DESC (${discountPercent}%)</td>
      <td style="text-align: right; padding: 2px 0; color: #000000;">${formatMoney(discountAmount)} Kz</td>
    </tr>` : '';

  // IBANs da empresa
  const defaultIbans = [
    'AO06005100000833202210182',
    'AO06005100002089848310183'
  ];
  let ibanList = [];
  if (company.iban && company.iban.trim()) {
    ibanList = company.iban.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  }
  if (ibanList.length === 0) {
    ibanList = defaultIbans;
  }

  const ibanRowsHtml = ibanList.map((iban, idx) => `
    <tr>
      <td style="width: 55px; font-weight: 500; color: #000000; padding: 2px 0; vertical-align: top; text-align: left;">${idx === 0 ? 'IBAN' : ''}</td>
      <td style="text-align: right; color: #000000; padding: 2px 0; vertical-align: top;">${iban}</td>
    </tr>
  `).join('');

  // Hash de validação AGT de 4 caracteres
  function getAgtHash(str) {
    if (!str) return 'Y6yh';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let h = Math.abs(hash);
    let res = '';
    for (let i = 0; i < 4; i++) {
      res += chars[h % chars.length];
      h = Math.floor(h / chars.length) + (str.charCodeAt(i % str.length) || 7);
    }
    return res || 'Y6yh';
  }
  const agtHash = getAgtHash(doc.document_number || doc.id);

  return `<!DOCTYPE html>
<html lang="pt-AO">
<head>
  <meta charset="UTF-8" />
  <title>${doc.document_number} — ${company.name || 'CleanXchedule'}</title>
  <style>
    @page { 
      size: A4; 
      margin: 12mm 16mm 12mm 16mm; 
    }
    * {
      box-sizing: border-box;
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      background: #f1f5f9; 
      color: #0f172a; 
      margin: 0; 
      padding: 30px 15px; 
      display: flex; 
      flex-direction: column; 
      align-items: center; 
      -webkit-font-smoothing: antialiased;
    }
    .btn-print-bar { 
      width: 210mm; 
      text-align: right; 
      margin-bottom: 16px; 
    }
    .btn-print { 
      background: #1e3a8a; 
      color: white; 
      border: none; 
      padding: 9px 18px; 
      font-size: 13px; 
      font-weight: 600; 
      border-radius: 6px; 
      cursor: pointer; 
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-print:hover {
      background: #1d4ed8;
    }
    
    .invoice-card { 
      width: 210mm; 
      min-height: 297mm; 
      background: white; 
      box-shadow: 0 4px 25px rgba(0,0,0,0.08); 
      padding: 16mm 18mm 14mm 18mm; 
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    
    /* TOPO */
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: flex-start; 
      margin-bottom: 24px; 
    }
    .brand { 
      font-size: 22px; 
      font-weight: 800; 
      color: #1040a0; 
      letter-spacing: -0.3px;
    }
    .brand span { 
      color: #f59e0b; 
    }
    .header-sub1 {
      font-size: 11px;
      color: #475569;
      margin-top: 4px;
      font-weight: 400;
    }
    .header-sub2 {
      font-size: 11px;
      color: #475569;
      margin-top: 2px;
      font-weight: 400;
    }
    .header-right {
      text-align: right;
    }
    .doc-badge { 
      display: inline-block;
      background: ${badgeBg}; 
      color: #ffffff; 
      font-size: 11px; 
      font-weight: 700; 
      padding: 4px 14px; 
      border-radius: 9999px; 
      text-transform: uppercase; 
      letter-spacing: 0.5px;
    }
    .doc-num {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 7px;
    }
    .doc-date {
      font-size: 11px;
      color: #475569;
      margin-top: 2px;
    }

    /* CARDS CLIENTE & EXECUCAO */
    .grid-cards { 
      display: grid; 
      grid-template-columns: 1fr 1fr; 
      gap: 16px; 
      margin-bottom: 24px; 
    }
    .card-box { 
      border: 1px solid #e2e8f0; 
      border-radius: 8px; 
      padding: 13px 16px; 
      background: #ffffff; 
    }
    .card-label { 
      font-size: 10px; 
      text-transform: uppercase; 
      color: #64748b; 
      font-weight: 700; 
      letter-spacing: 0.5px; 
      margin-bottom: 6px; 
    }
    .card-name {
      font-weight: 700;
      font-size: 14px;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .card-line {
      font-size: 11px;
      color: #334155;
      margin-bottom: 2px;
      line-height: 1.4;
    }
    .card-line strong {
      color: #0f172a;
    }

    /* TABELA DE SERVICOS */
    .items-table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-bottom: 20px; 
    }
    .items-table thead th { 
      background: #f1f5f9; 
      text-align: left; 
      padding: 9px 12px; 
      font-size: 11px; 
      text-transform: uppercase; 
      color: #475569; 
      font-weight: 700; 
      letter-spacing: 0.4px;
    }
    .items-table tbody td { 
      padding: 14px 12px; 
      font-size: 13px; 
      color: #0f172a;
    }
    .service-title {
      font-weight: 700;
      color: #0f172a;
      font-size: 13px;
    }
    .service-desc {
      font-size: 11px;
      color: #64748b;
      margin-top: 3px;
    }

    /* SECCAO INFERIOR (TAXAS, BANCO E SUMARIO) */
    .bottom-section {
      margin-top: auto;
    }
    .lower-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 40px;
      align-items: stretch;
      margin-bottom: 28px;
    }
    
    /* COLUNA ESQUERDA: TAXA & DADOS BANCARIOS */
    .tax-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin-bottom: 4px;
    }
    .tax-table th {
      padding: 0 0 4px 0;
      font-size: 11px;
      font-weight: 700;
      color: #000000;
      border-bottom: 1.5px solid #000000;
    }
    .tax-table td {
      padding: 4px 0 2px 0;
      font-size: 11px;
      color: #000000;
    }
    .tax-note {
      font-size: 9.5px;
      color: #000000;
      margin-top: 3px;
      margin-bottom: 18px;
    }

    .bank-title {
      font-size: 11px;
      font-weight: 700;
      color: #000000;
      border-bottom: 1.5px solid #000000;
      padding-bottom: 3px;
      margin-bottom: 6px;
    }
    .bank-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .bank-table td {
      padding: 2px 0;
      color: #000000;
    }

    /* COLUNA DIREITA: SUMARIO */
    .summary-column {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 125px;
    }
    .summary-title {
      font-size: 11px;
      font-weight: 700;
      color: #000000;
      border-bottom: 1.5px solid #000000;
      padding-bottom: 3px;
      margin-bottom: 6px;
    }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .summary-table td {
      padding: 2px 0;
      color: #000000;
    }
    .summary-divider {
      border-top: 1.5px solid #000000;
      margin-top: 24px;
      margin-bottom: 6px;
    }
    .summary-total {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 16px;
      font-weight: 700;
      color: #000000;
    }

    /* RODAPE: AGT E DADOS DA EMPRESA EMISSORA */
    .agt-line {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #0f172a;
      margin-bottom: 6px;
    }
    .footer-divider {
      border-top: 1px solid #0f172a;
      margin-bottom: 8px;
    }
    .emitter-footer {
      text-align: center;
      font-size: 9px;
      color: #334155;
      line-height: 1.45;
    }

    @media print { 
      body { 
        background: white; 
        padding: 0; 
        margin: 0;
        display: block; 
      }
      .btn-print-bar { 
        display: none !important; 
      }
      .invoice-card { 
        width: 100%; 
        min-height: calc(297mm - 24mm); 
        box-shadow: none; 
        border: none; 
        padding: 0; 
      }
    }
  </style>
</head>
<body>
  <div class="btn-print-bar">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  </div>

  <div class="invoice-card">
    <!-- BLOCO SUPERIOR -->
    <div class="top-section">
      <div class="header">
        <div>
          <div class="brand">${brandMain}${brandAccent ? ` <span>${brandAccent}</span>` : ''}</div>
          <div class="header-sub1">${company.slogan || 'Serviços Profissionais de Higienização de Estofos'}</div>
          <div class="header-sub2">${locationLine}</div>
        </div>
        <div class="header-right">
          <div class="doc-badge">${docTitle}</div>
          <div class="doc-num">${doc.document_number}</div>
          <div class="doc-date">Data: ${formatDate(doc.issued_at)}</div>
        </div>
      </div>

      <div class="grid-cards">
        <div class="card-box">
          <div class="card-label">CLIENTE</div>
          <div class="card-name">${doc.client_name || 'Consumidor Final'}</div>
          <div class="card-line">Tel: ${doc.client_phone || '—'}</div>
          <div class="card-line">End: ${doc.client_address || 'Luanda, Angola'}</div>
        </div>
        <div class="card-box">
          <div class="card-label">DETALHES DA EXECUCAO</div>
          <div class="card-line"><strong>Data Agendada:</strong> ${doc.scheduled_date || formatDate(doc.issued_at)}</div>
          <div class="card-line"><strong>Estado:</strong> ${isReceipt ? 'Liquidado' : 'Pendente'}</div>
          <div class="card-line"><strong>Moeda:</strong> Kwanza Angolano (AOA)</div>
        </div>
      </div>

      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 58%;">DESCRICAO DO SERVICO</th>
            <th style="width: 17%; text-align: center;">QTD</th>
            <th style="width: 25%; text-align: right;">TOTAL (AOA)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="service-title">${doc.service_name || 'Higienizacao & Limpeza Profunda'}</div>
              <div class="service-desc">Execucao especializada ${company.name || 'CleanXchedule Manager'}</div>
            </td>
            <td style="text-align: center;">${doc.item_quantity || 1}</td>
            <td style="text-align: right; font-weight: 500;">${formatMoney(primaryAmount)} AOA</td>
          </tr>
          ${doc.secondary_service_name ? `
          <tr>
            <td>
              <div class="service-title">${doc.secondary_service_name}</div>
              <div class="service-desc">Serviço adicional ${company.name || 'CleanXchedule Manager'}</div>
            </td>
            <td style="text-align: center;">${doc.secondary_item_quantity || 1}</td>
            <td style="text-align: right; font-weight: 500;">${formatMoney(secondaryAmount)} AOA</td>
          </tr>` : ''}
          ${travelFee > 0 ? `
          <tr>
            <td>
              <div class="service-title">Taxa de Deslocação</div>
              <div class="service-desc">Deslocação técnica ao domicílio</div>
            </td>
            <td style="text-align: center;">1</td>
            <td style="text-align: right; font-weight: 500;">${formatMoney(travelFee)} AOA</td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>

    <!-- BLOCO INFERIOR (TAXAS, BANCO, SUMARIO E RODAPE) -->
    <div class="bottom-section">
      <div class="lower-grid">
        <!-- Esquerda: Taxa e Dados Bancários -->
        <div>
          <table class="tax-table">
            <thead>
              <tr>
                <th style="text-align: left; width: 28%;">Taxa</th>
                <th style="text-align: center; width: 44%;">Base</th>
                <th style="text-align: right; width: 28%;">IVA</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align: left;">0%</td>
                <td style="text-align: center;">${formatMoney(baseAmount)} Kz</td>
                <td style="text-align: right;">0,00 Kz</td>
              </tr>
            </tbody>
          </table>
          <div class="tax-note">(1) IVA – Regime de Exclusão</div>

          <div class="bank-section">
            <div class="bank-title">Dados Bancários</div>
            <table class="bank-table">
              ${ibanRowsHtml}
            </table>
          </div>
        </div>

        <!-- Direita: Sumário -->
        <div class="summary-column">
          <div>
            <div class="summary-title">Sumário</div>
            <table class="summary-table">
              <tr>
                <td style="text-align: left;">S/IVA</td>
                <td style="text-align: right;">${formatMoney(baseAmount)} Kz</td>
              </tr>
              ${discountRowHtml}
            </table>
          </div>
          <div>
            <div class="summary-divider"></div>
            <div class="summary-total">
              <span>Total</span>
              <span>${formatMoney(finalAmount)} Kz</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Linha Página e Certificação AGT -->
      <div class="agt-line">
        <div>Página 1/1</div>
        <div>${agtHash}-Processado por programa validado n. 142/AGT</div>
      </div>

      <!-- Divisor e Rodapé da Empresa Emissora -->
      <div class="footer-divider"></div>
      <div class="emitter-footer">
        <div>ND SOLUÇÕES (SU) LDA. &nbsp; Rua dos Comando, Bairro do Tala Hady, Travessa Marcelo Caetano, 7A, Cazenga - Luanda.</div>
        <div>Email: ndsolucoessu@gmail.com Tel.+244 924 044 145/ +244 937 527 159</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function handleInvoiceRequest(req, res, next) {
  try {
    const db = getDb();
    // Verifica se já existe um documento emitido para este booking
    const existing = db.prepare(`
      SELECT id FROM documents WHERE booking_id = ? AND type IN ('Fatura', 'Recibo') ORDER BY issued_at DESC LIMIT 1
    `).get(req.params.booking_id);

    const doc = existing ? getDocumentById(db, existing.id) : generateInvoice(db, req.params.booking_id);

    // Carrega dados dinâmicos da empresa
    const company = db.prepare('SELECT * FROM company_profile WHERE id = 1').get() || {
      name: 'CleanXchedule Manager',
      nif: '',
      location: 'Angola',
      slogan: 'Servicos Profissionais',
    };

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      const html = buildDocumentHtml(doc, company);
      return res.send(html);
    }

    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
}

router.post(
  '/invoice/:booking_id',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  handleInvoiceRequest
);

router.get(
  '/invoice/:booking_id',
  requireRoles('Admin', 'GestorComercial', 'Assistente', 'Tecnico'),
  handleInvoiceRequest
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /documents/:id/download — Obter dados / Download do documento
───────────────────────────────────────────────────────────────────────────── */
router.get('/:id/download', (req, res, next) => {
  try {
    const db = getDb();
    const doc = getDocumentById(db, req.params.id);
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      const company = db.prepare('SELECT * FROM company_profile WHERE id = 1').get() || {
        name: 'CleanXchedule Manager',
        nif: '',
        location: 'Angola',
        slogan: 'Servicos Profissionais',
      };
      return res.send(buildDocumentHtml(doc, company));
    }
    return res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /documents/:id/send-whatsapp — Marcar/Registar envio por WhatsApp
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/:id/send-whatsapp',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const doc = markDocumentSentWhatsApp(db, req.params.id);
      return res.json({ success: true, message: 'Documento marcado como enviado por WhatsApp.', data: doc });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
