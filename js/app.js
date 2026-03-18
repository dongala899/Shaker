// Global variables
let invoice;
let storage;
let companyData;
let customersData;
let itemsData;
let customerPurchaseOrdersData;
let organizationPurchaseOrdersData;
let editingInvoiceIndex = null;
let editingCustomerIndex = null;
let editingItemIndex = null;
let editingCustomerPurchaseOrderIndex = null;
let editingOrganizationPurchaseOrderIndex = null;
let currentWorkspaceView = 'invoice';
let customerPurchaseOrderDraftItems = [];
let formListenersAttached = false;
const FALLBACK_AUTH_KEY = "digidat_invoice_auth";
const FALLBACK_CREDENTIALS_KEY = "digidat_invoice_credentials";
const LOGIN_PAGE_ALIAS = "login.html";
const APP_VERSION = "1.0.0";
const BACKUP_SCHEMA = "shaker-backup-v1";
const STORAGE_KEYS = {
  company: "appCompany",
  customers: "appCustomers",
  items: "appItems",
  invoices: "invoices",
  customerPurchaseOrders: "customerPurchaseOrders",
  organizationPurchaseOrders: "organizationPurchaseOrders",
  currentInvoiceDraft: "currentInvoiceDraft"
};

function isStandalonePreviewPage() {
  const bodyMode = document.body?.dataset?.previewPage === "true";
  const path = window.location.pathname.toLowerCase();
  return bodyMode || path.endsWith("/invoice-preview.html") || path.endsWith("invoice-preview.html");
}

function hasValidSession() {
  if (typeof window.isAuthenticated === "function") {
    return window.isAuthenticated();
  }
  try {
    const raw = localStorage.getItem(FALLBACK_AUTH_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.active === true && parsed.username);
  } catch (error) {
    return false;
  }
}

function ensureAuthenticated() {
  if (hasValidSession()) return true;
  window.location.replace(LOGIN_PAGE_ALIAS);
  return false;
}

function showLoggedOutNotice() {
  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Logged Out</title>',
    '<style>',
    'body{margin:0;font-family:Arial,sans-serif;background:#f5f7fb;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box;}',
    '.card{max-width:420px;background:#fff;border-radius:14px;padding:28px;box-shadow:0 16px 40px rgba(15,23,42,0.12);text-align:center;}',
    'h1{margin:0 0 12px;font-size:1.6rem;}',
    'p{margin:0 0 10px;line-height:1.5;}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="card">',
    '<h1>Logged Out</h1>',
    '<p>The local Shaker server has been stopped.</p>',
    '<p>Use the desktop shortcut again to open the login page.</p>',
    '</div>',
    '</body>',
    '</html>'
  ].join('');

  window.location.replace(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function logoutAndExit() {
  if (typeof window.clearAuthentication === "function") {
    window.clearAuthentication();
  } else {
    localStorage.removeItem(FALLBACK_AUTH_KEY);
  }

  if (typeof window.ShakerServerSession?.loadServerConfig === "function") {
    try {
      await window.ShakerServerSession.loadServerConfig();
    } catch (error) {
      // Fall through to regular login redirect if server management is unavailable.
    }
  }

  const managedShutdown = window.ShakerServerSession?.supportsManagedShutdown?.() === true;
  if (managedShutdown) {
    const shutdownComplete = await window.ShakerServerSession.shutdownServer("logout");
    if (shutdownComplete) {
      showLoggedOutNotice();
      return;
    }
  }

  window.location.replace(LOGIN_PAGE_ALIAS);
}

function openChangePasswordScreen() {
  window.location.href = "change-password.html";
}

window.logoutAndExit = logoutAndExit;
window.openChangePasswordScreen = openChangePasswordScreen;
window.openInvoicePreviewPage = openInvoicePreviewPage;
window.returnToInvoiceEditor = returnToInvoiceEditor;

function getSafeInvoices() {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.invoices)) || [];
  if (!Array.isArray(raw)) return [];
  return raw;
}

function getSafeStoredList(key) {
  const raw = readStorageJson(key, []);
  return Array.isArray(raw) ? raw : [];
}

function readStorageJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function buildCurrentInvoiceDraftPayload() {
  if (!invoice) return null;
  return {
    invoice: invoice.toJSON(),
    editingInvoiceIndex
  };
}

function readCurrentInvoiceDraftPayload() {
  return readStorageJson(STORAGE_KEYS.currentInvoiceDraft, null);
}

function persistCurrentInvoiceDraft() {
  const payload = buildCurrentInvoiceDraftPayload();
  if (!payload) return;
  localStorage.setItem(STORAGE_KEYS.currentInvoiceDraft, JSON.stringify(payload));
}

function normalizeEditingInvoiceIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < getSafeInvoices().length
    ? index
    : null;
}

function getAuthStorageKey() {
  return typeof window.AUTH_STORAGE_KEY === "string" ? window.AUTH_STORAGE_KEY : FALLBACK_AUTH_KEY;
}

function getAuthCredentialsKey() {
  return typeof window.AUTH_CREDENTIALS_KEY === "string" ? window.AUTH_CREDENTIALS_KEY : FALLBACK_CREDENTIALS_KEY;
}

function buildBackupPayload() {
  return {
    schema: BACKUP_SCHEMA,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      appCompany: readStorageJson(STORAGE_KEYS.company, {}),
      appCustomers: readStorageJson(STORAGE_KEYS.customers, []),
      appItems: readStorageJson(STORAGE_KEYS.items, []),
      customerPurchaseOrders: readStorageJson(STORAGE_KEYS.customerPurchaseOrders, []),
      organizationPurchaseOrders: readStorageJson(STORAGE_KEYS.organizationPurchaseOrders, []),
      invoices: getSafeInvoices(),
      invoiceCounter: localStorage.getItem("invoiceCounter"),
      authSession: readStorageJson(getAuthStorageKey(), null),
      authCredentials: readStorageJson(getAuthCredentialsKey(), null)
    }
  };
}

function downloadAppBackup() {
  const payload = buildBackupPayload();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `shaker-backup-${timestamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function triggerRestoreBackup() {
  const input = document.getElementById("restoreBackupInput");
  if (!input) {
    alert("Restore input is not available.");
    return;
  }
  input.value = "";
  input.click();
}

function applyBackupPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : null;
  if (!payload) return false;
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;

  const safeCompany = data.appCompany && typeof data.appCompany === "object" ? data.appCompany : defaultCompanyData;
  const safeCustomers = Array.isArray(data.appCustomers) ? data.appCustomers.map(ensureCustomerState) : [];
  const safeItems = Array.isArray(data.appItems) ? data.appItems.map(ensureCatalogItem) : [];
  const safeInvoices = Array.isArray(data.invoices) ? data.invoices : [];
  const safeCustomerPurchaseOrders = Array.isArray(data.customerPurchaseOrders)
    ? data.customerPurchaseOrders.map(ensureCustomerPurchaseOrder)
    : [];
  const safeOrganizationPurchaseOrders = Array.isArray(data.organizationPurchaseOrders)
    ? data.organizationPurchaseOrders.map(ensureOrganizationPurchaseOrder)
    : [];

  localStorage.setItem(STORAGE_KEYS.company, JSON.stringify(safeCompany));
  localStorage.setItem(STORAGE_KEYS.customers, JSON.stringify(safeCustomers));
  localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(safeItems));
  localStorage.setItem(STORAGE_KEYS.invoices, JSON.stringify(safeInvoices));
  localStorage.setItem(STORAGE_KEYS.customerPurchaseOrders, JSON.stringify(safeCustomerPurchaseOrders));
  localStorage.setItem(STORAGE_KEYS.organizationPurchaseOrders, JSON.stringify(safeOrganizationPurchaseOrders));

  const invoiceCounter = data.invoiceCounter;
  if (invoiceCounter !== undefined && invoiceCounter !== null && String(invoiceCounter).trim() !== "") {
    localStorage.setItem("invoiceCounter", String(invoiceCounter));
  } else {
    localStorage.removeItem("invoiceCounter");
  }

  if (Object.prototype.hasOwnProperty.call(data, "authSession")) {
    if (data.authSession) {
      localStorage.setItem(getAuthStorageKey(), JSON.stringify(data.authSession));
    } else {
      localStorage.removeItem(getAuthStorageKey());
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "authCredentials") && data.authCredentials) {
    localStorage.setItem(getAuthCredentialsKey(), JSON.stringify(data.authCredentials));
  }

  return true;
}

function restoreAppBackup(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid backup structure.");
      }

      const proceed = confirm("Restore this backup now? Current unsaved changes on screen will be lost.");
      if (!proceed) return;

      const applied = applyBackupPayload(parsed);
      if (!applied) {
        throw new Error("Backup data could not be applied.");
      }

      alert("Backup restored successfully. The app will reload now.");
      window.location.reload();
    } catch (error) {
      console.error("Backup restore failed:", error);
      alert("Backup restore failed. Please use a valid backup JSON file.");
    } finally {
      if (input) input.value = "";
    }
  };

  reader.onerror = () => {
    alert("Unable to read the selected backup file.");
    if (input) input.value = "";
  };

  reader.readAsText(file, "utf-8");
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return invoice.formatCurrency(safeNumber(value));
}

function formatMoneyForPDF(value) {
  const amount = safeNumber(value);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
  return `INR ${formatted}`;
}

function displayOptional(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function getNextEntityId(prefix, records) {
  let maxValue = 0;
  (Array.isArray(records) ? records : []).forEach((record) => {
    const match = String(record?.id || '').match(/(\d+)$/);
    if (!match) return;
    const numericValue = parseInt(match[1], 10);
    if (Number.isFinite(numericValue)) {
      maxValue = Math.max(maxValue, numericValue);
    }
  });
  return `${prefix}${String(maxValue + 1).padStart(3, '0')}`;
}

function fitTextToWidth(doc, text, maxWidth, ellipsis = "...") {
  const source = String(text || "-");
  if (!doc || !Number.isFinite(maxWidth) || maxWidth <= 0) return source;
  if (doc.getTextWidth(source) <= maxWidth) return source;

  let output = source;
  while (output.length > 0 && doc.getTextWidth(`${output}${ellipsis}`) > maxWidth) {
    output = output.slice(0, -1);
  }
  return output ? `${output}${ellipsis}` : ellipsis;
}

function fitBuyerAddressLineElements(root = document, viewWindow = window) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const lines = Array.from(root.querySelectorAll('.buyer-address-line'));
  lines.forEach((line) => {
    if (!line) return;

    line.style.whiteSpace = 'normal';
    line.style.overflow = 'visible';
    line.style.textOverflow = 'unset';
    line.style.overflowWrap = 'anywhere';
    line.style.wordBreak = 'break-word';
    line.style.maxWidth = '100%';
    line.style.fontSize = '';
    line.style.letterSpacing = '';
  });
}

const DEFAULT_LOCAL_STATE = 'Telangana';

const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh'
};

function normalizeState(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeHsnSac(value) {
  return String(value || '').trim() || '-';
}

function inferStateFromGstin(gstin) {
  const gst = String(gstin || '').trim();
  const code = gst.slice(0, 2);
  return GST_STATE_CODES[code] || '';
}

function ensureCustomerState(customer) {
  const safeCustomer = { ...customer };
  const stateFromData = normalizeState(safeCustomer.state);
  const stateFromGstin = inferStateFromGstin(safeCustomer.gstin);
  safeCustomer.state = stateFromData || stateFromGstin || DEFAULT_LOCAL_STATE;
  return safeCustomer;
}

function ensureCatalogItem(item) {
  return {
    ...item,
    hsnSac: normalizeHsnSac(item?.hsnSac || item?.hsn || item?.sac)
  };
}

function ensureOrderLineItem(item) {
  const quantity = safeNumber(item?.quantity);
  const rate = safeNumber(item?.rate);
  return {
    id: String(item?.id || '').trim(),
    name: String(item?.name || '').trim() || '-',
    description: String(item?.description || '').trim(),
    hsnSac: normalizeHsnSac(item?.hsnSac || item?.hsn || item?.sac),
    quantity,
    rate,
    total: quantity * rate
  };
}

function ensureCustomerPurchaseOrder(record) {
  const items = Array.isArray(record?.items) ? record.items.map(ensureOrderLineItem) : [];
  const derivedAmount = items.reduce((sum, item) => sum + safeNumber(item.total), 0);
  return {
    id: String(record?.id || '').trim(),
    customerId: String(record?.customerId || '').trim(),
    customerName: String(record?.customerName || '').trim(),
    poNumber: String(record?.poNumber || '').trim(),
    poDate: String(record?.poDate || '').trim(),
    amount: items.length > 0 ? derivedAmount : safeNumber(record?.amount),
    status: String(record?.status || 'Open').trim() || 'Open',
    notes: String(record?.notes || '').trim(),
    items,
    linkedInvoiceNumber: String(record?.linkedInvoiceNumber || '').trim(),
    createdAt: record?.createdAt || new Date().toISOString()
  };
}

function ensureOrganizationPurchaseOrder(record) {
  return {
    id: String(record?.id || '').trim(),
    vendorName: String(record?.vendorName || '').trim(),
    poNumber: String(record?.poNumber || record?.orderNumber || '').trim(),
    poDate: String(record?.poDate || record?.orderDate || '').trim(),
    amount: safeNumber(record?.amount),
    status: String(record?.status || 'Placed').trim() || 'Placed',
    notes: String(record?.notes || '').trim(),
    createdAt: record?.createdAt || new Date().toISOString()
  };
}

function ensureInvoiceLineItem(item) {
  return ensureOrderLineItem(item);
}

function getSafeCustomerPurchaseOrders() {
  return getSafeStoredList(STORAGE_KEYS.customerPurchaseOrders).map(ensureCustomerPurchaseOrder);
}

function getSafeOrganizationPurchaseOrders() {
  return getSafeStoredList(STORAGE_KEYS.organizationPurchaseOrders).map(ensureOrganizationPurchaseOrder);
}

function persistCustomerPurchaseOrders() {
  localStorage.setItem(STORAGE_KEYS.customerPurchaseOrders, JSON.stringify(customerPurchaseOrdersData));
}

function persistOrganizationPurchaseOrders() {
  localStorage.setItem(STORAGE_KEYS.organizationPurchaseOrders, JSON.stringify(organizationPurchaseOrdersData));
}

function formatDateDisplay(value) {
  if (!value) return '-';
  return invoice?.formatDate ? invoice.formatDate(value) : value;
}

function getEmbeddedPdfAsset(...keys) {
  if (!window.PDF_ASSETS) return null;
  for (const key of keys) {
    const value = window.PDF_ASSETS[key];
    if (typeof value === "string" && value.startsWith("data:image/")) {
      return value;
    }
  }
  return null;
}

function getImageTypeForPdf(dataUrl) {
  if (typeof dataUrl !== "string") return "JPEG";
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

function waitForInvoiceImages(root, timeoutMs = 4000) {
  const images = Array.from(root.querySelectorAll('img'));
  if (images.length === 0) return Promise.resolve();

  const waits = images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, timeoutMs);
    });
  });

  return Promise.all(waits).then(() => undefined);
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function imageElementToDataUrl(img) {
  return new Promise((resolve) => {
    if (!img) {
      resolve(null);
      return;
    }

    const convert = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
          resolve(null);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.95));
      } catch (error) {
        resolve(null);
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      convert();
      return;
    }

    const onLoad = () => convert();
    const onError = () => resolve(null);
    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
    setTimeout(() => resolve(null), 2000);
  });
}

async function inlineImages(root) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (img) => {
    if (!img.src || img.src.startsWith('data:')) return;
    try {
      const response = await fetch(img.src, { cache: 'force-cache' });
      if (!response.ok) return;
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      img.src = dataUrl;
    } catch (error) {
      const sameSrcImg = Array.from(document.images).find(
        (domImg) => domImg.src === img.src && domImg !== img
      );
      const dataUrl = await imageElementToDataUrl(sameSrcImg);
      if (dataUrl) {
        img.src = dataUrl;
      }
    }
  }));
}

async function loadPdfAssetDataUrl(paths, selectors = [], embeddedKeys = []) {
  const keys = Array.isArray(embeddedKeys) ? embeddedKeys : [embeddedKeys];
  const embeddedAsset = getEmbeddedPdfAsset(...keys);
  if (embeddedAsset) return embeddedAsset;

  for (const selector of selectors) {
    const domImg = document.querySelector(selector);
    const dataUrl = await imageElementToDataUrl(domImg);
    if (dataUrl) return dataUrl;
  }

  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: "force-cache" });
      if (!response.ok) continue;
      const blob = await response.blob();
      return await blobToDataUrl(blob);
    } catch (error) {
      // Try next path.
    }
  }
  return null;
}

async function exportBasicPdfData() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("jsPDF unavailable for basic export");
  }

  const logoDataUrl = await loadPdfAssetDataUrl([
    "assets/Logo.jpeg",
    "assets/digidat-logo.png",
    "assets/logo.png"
  ], [".invoice-logo-image"], ["logo"]);
  const signDataUrl = await loadPdfAssetDataUrl([
    "assets/Signature.jpeg",
    "assets/digidat-stamp.png",
    "assets/stamp.png"
  ], [".invoice-stamp"], ["signature", "stamp"]);

  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 10;
  const right = pageW - 10;
  let y = 14;

  const line = (text, x, yPos, align = "left") => {
    doc.text(String(text), x, yPos, { align });
  };

  const company = invoice.companyInfo || {};
  const customer = ensureCustomerState(invoice.customerSelected || {});
  const isInterState = invoice.isInterStateSale();
  const headerTop = y;
  const poDateText = invoice.poDate ? invoice.formatDate(invoice.poDate) : "-";
  let contentStartY = headerTop + 6;
  const logoLeft = left;
  const logoTop = headerTop - 2;
  if (logoDataUrl) {
    try {
      const logoWidth = 34;
      const logoHeight = 12;
      doc.addImage(
        logoDataUrl,
        getImageTypeForPdf(logoDataUrl),
        logoLeft,
        logoTop,
        logoWidth,
        logoHeight
      );
      contentStartY = headerTop + 14;
    } catch (error) {
      console.warn("Logo image could not be embedded in PDF.", error);
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  line("Tax Invoice", pageW / 2, contentStartY - 2, "center");

  const headerGap = 6;
  const detailsColWidth = 44;
  const detailsLeft = right - detailsColWidth;
  const companyX = left;
  const companyW = 80;
  const buyerX = companyX + companyW + headerGap;
  const buyerW = Math.max(48, detailsLeft - buyerX - headerGap);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const companyAddressY = contentStartY + 4;
  const companyAddressLines = doc.splitTextToSize(company.address || "-", companyW);
  doc.text(companyAddressLines, companyX, companyAddressY);
  let companyBlockBottom = companyAddressY + (companyAddressLines.length * 4);
  line(`Phone: ${company.phone || "-"}`, companyX, companyBlockBottom + 3);
  line(`Email: ${company.email || "-"}`, companyX, companyBlockBottom + 7);
  line(`GSTIN: ${company.gstin || "-"}`, companyX, companyBlockBottom + 11);
  companyBlockBottom += 11;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  line("Buyer (Bill To):", buyerX, contentStartY + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  let buyerY = contentStartY + 8;
  line(customer.name || "-", buyerX, buyerY);
  buyerY += 4;
  const buyerAddress = fitTextToWidth(doc, customer.address || "-", buyerW);
  doc.text(buyerAddress, buyerX, buyerY);
  buyerY += 4;
  const stateAndGstinLines = doc.splitTextToSize(
    `State: ${customer.state || DEFAULT_LOCAL_STATE} | GSTIN: ${displayOptional(customer.gstin)}`,
    buyerW
  );
  doc.text(stateAndGstinLines, buyerX, buyerY);
  buyerY += stateAndGstinLines.length * 4;
  const phoneAndEmailLines = doc.splitTextToSize(
    `Phone: ${displayOptional(customer.phone)} | Email: ${displayOptional(customer.email)}`,
    buyerW
  );
  doc.text(phoneAndEmailLines, buyerX, buyerY);
  buyerY += phoneAndEmailLines.length * 4;
  const shippingAddressText = String(invoice.shippingAddress || "").trim();
  if (shippingAddressText) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    line("Shipping Address:", buyerX, buyerY + 1);
    buyerY += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const shippingLines = doc.splitTextToSize(shippingAddressText, buyerW);
    doc.text(shippingLines, buyerX, buyerY);
    buyerY += shippingLines.length * 4;
  }
  const buyerBlockBottom = buyerY - 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  line(`INV No: ${invoice.invoiceNumber || "-"}`, right, contentStartY + 4, "right");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  line(`Date: ${invoice.formatDate(invoice.invoiceDate)}`, right, contentStartY + 8, "right");
  line(`PO No: ${invoice.poNumber || "-"}`, right, contentStartY + 12, "right");
  line(`PO Date: ${poDateText}`, right, contentStartY + 16, "right");
  const invoiceBlockBottom = contentStartY + 16;

  y = Math.max(companyBlockBottom, buyerBlockBottom, invoiceBlockBottom) + 6;
  doc.line(left, y, right, y);
  y += 5;

  const tableWidth = right - left;
  const columnWidths = {
    sno: 10,
    desc: 70,
    hsn: 23,
    qty: 12,
    rate: 24,
    rateTax: 24
  };
  const fixedWidth = columnWidths.sno + columnWidths.desc + columnWidths.hsn + columnWidths.qty + columnWidths.rate + columnWidths.rateTax;
  columnWidths.amount = tableWidth - fixedWidth;

  const colStart = {
    sno: left,
    desc: left + columnWidths.sno,
    hsn: left + columnWidths.sno + columnWidths.desc,
    qty: left + columnWidths.sno + columnWidths.desc + columnWidths.hsn,
    rate: left + columnWidths.sno + columnWidths.desc + columnWidths.hsn + columnWidths.qty,
    rateTax: left + columnWidths.sno + columnWidths.desc + columnWidths.hsn + columnWidths.qty + columnWidths.rate,
    amount: left + columnWidths.sno + columnWidths.desc + columnWidths.hsn + columnWidths.qty + columnWidths.rate + columnWidths.rateTax
  };

  const colRight = {
    qty: colStart.qty + columnWidths.qty - 1,
    rate: colStart.rate + columnWidths.rate - 1,
    rateTax: colStart.rateTax + columnWidths.rateTax - 1,
    amount: right
  };
  const colCenter = {
    sno: colStart.sno + (columnWidths.sno / 2),
    hsn: colStart.hsn + (columnWidths.hsn / 2),
    qty: colStart.qty + (columnWidths.qty / 2),
    rate: colStart.rate + (columnWidths.rate / 2),
    rateTax: colStart.rateTax + (columnWidths.rateTax / 2),
    amount: colStart.amount + (columnWidths.amount / 2)
  };

  const drawTableHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.4);
    line("S.No", colCenter.sno, y, "center");
    line("Item Description", colStart.desc + 1, y);
    line("HSN/SAC", colCenter.hsn, y, "center");
    line("Qty", colCenter.qty, y, "center");
    line("Rate+Tax", colCenter.rate, y, "center");
    line("Rate", colCenter.rateTax, y, "center");
    line("Amount", colCenter.amount, y, "center");
    y += 2;
    doc.line(left, y, right, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.3);
  };

  const ensurePage = (neededHeight) => {
    if (y + neededHeight <= pageH - 14) return;
    doc.addPage();
    y = 14;
    drawTableHeader();
  };

  drawTableHeader();
  invoice.items.forEach((item, index) => {
    const safeItem = ensureInvoiceLineItem(item);
    const qty = safeNumber(item.quantity);
    const rate = safeNumber(item.rate);
    const rateWithTax = rate * 1.18;
    const amount = safeNumber(item.total);
    const descText = `${item.name || "-"}${item.description ? ` - ${item.description}` : ""}`;
    const descLines = doc.splitTextToSize(descText, columnWidths.desc - 2);
    const rowHeight = Math.max(5, descLines.length * 3.8);
    ensurePage(rowHeight + 2);

    line(index + 1, colStart.sno + 1, y);
    doc.text(descLines, colStart.desc + 1, y);
    line(String(safeItem.hsnSac || "-").slice(0, 18), colStart.hsn + 1, y);
    line(qty || "-", colRight.qty, y, "right");
    line(formatMoneyForPDF(rateWithTax), colRight.rate, y, "right");
    line(formatMoneyForPDF(rate), colRight.rateTax, y, "right");
    line(formatMoneyForPDF(amount), colRight.amount, y, "right");
    y += rowHeight;
    doc.setDrawColor(228, 231, 235);
    doc.line(left, y, right, y);
    y += 3;
  });

  y += 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  line(`Subtotal: ${formatMoneyForPDF(invoice.getSubtotal())}`, right, y, "right"); y += 5;
  if (isInterState) {
    line(`IGST (18%): ${formatMoneyForPDF(invoice.getIGST())}`, right, y, "right"); y += 5;
  } else {
    line(`CGST (9%): ${formatMoneyForPDF(invoice.getCGST())}`, right, y, "right"); y += 5;
    line(`SGST (9%): ${formatMoneyForPDF(invoice.getSGST())}`, right, y, "right"); y += 5;
  }
  if (invoice.isRoundOffEnabled()) {
    line(`Total: ${formatMoneyForPDF(invoice.getPreRoundGrandTotal())}`, right, y, "right");
    y += 5;
    line(`Round Off: ${formatMoneyForPDF(invoice.getRoundOffAmount())}`, right, y, "right");
    y += 5;
  }
  line(`Grand Total: ${formatMoneyForPDF(invoice.getGrandTotal())}`, right, y, "right");
  y += 8;

  const bankSummary = `Bank: ${company.bankName || "-"} | Account: ${company.accountNumber || "-"} | IFSC: ${company.ifscCode || "-"}`;
  const companySignLine = "For DigiDat InfoSystems";
  const signWidth = 30;
  const signHeight = 20;
  const signatureBlockHeight = 4 + signHeight + 6;

  if (y + signatureBlockHeight > pageH - 20) {
    doc.addPage();
    y = 18;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  line(companySignLine, right, y, "right");
  y += 4;

  if (signDataUrl) {
    if (y + signHeight > pageH - 20) {
      doc.addPage();
      y = 18;
    }
    try {
      doc.addImage(signDataUrl, getImageTypeForPdf(signDataUrl), right - signWidth, y, signWidth, signHeight);
      y += signHeight + 4;
    } catch (error) {
      console.warn("Signature image could not be embedded in PDF.", error);
    }
  }

  y = Math.max(y, pageH - 20);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  line(bankSummary, pageW / 2, y, "center");
  y += 3.8;
  doc.setFont("helvetica", "normal");
  line("This is a computer generated invoice", pageW / 2, y, "center");

  doc.save(`${invoice.invoiceNumber || "invoice"}.pdf`);
}

function getInvoiceCopiesMarkup(invoiceHtml) {
  const invLabelMarker = "<strong>INV No:</strong>";
  const originalHtml = invoiceHtml.replace(invLabelMarker, "<strong>ORIGINAL INV No:</strong>");
  const duplicateHtml = invoiceHtml.replace(invLabelMarker, "<strong>DUPLICATE INV No:</strong>");

  return `
    <div class="print-copy">
      ${originalHtml}
    </div>
    <div class="print-copy">
      ${duplicateHtml}
    </div>
  `;
}

async function exportToPDFFallback(sourceElement) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("jsPDF is not available");
  }
  if (typeof html2canvas === "undefined") {
    throw new Error("html2canvas is not available");
  }
  if (!sourceElement) {
    throw new Error("No source element for PDF export");
  }

  const canvas = await html2canvas(sourceElement, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.98);
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 8;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  doc.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + margin;
    doc.addPage();
    doc.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  doc.save(`${invoice.invoiceNumber || "invoice"}.pdf`);
}

function getCompanyInitials(name) {
  const fallback = "BI";
  if (!name || typeof name !== "string") return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function handleLogoFallback(img) {
  if (!img.dataset.fallbackStep) {
    img.dataset.fallbackStep = "1";
    img.src = "assets/digidat-logo.png";
    return;
  }
  if (img.dataset.fallbackStep === "1") {
    img.dataset.fallbackStep = "2";
    img.src = "assets/logo.png";
    return;
  }
  img.style.display = "none";
  const fallback = img.nextElementSibling;
  if (fallback) fallback.style.display = "flex";
}

function handleStampFallback(img) {
  if (!img.dataset.fallbackStep) {
    img.dataset.fallbackStep = "1";
    img.src = "assets/digidat-stamp.png";
    return;
  }
  if (img.dataset.fallbackStep === "1") {
    img.dataset.fallbackStep = "2";
    img.src = "assets/stamp.png";
    return;
  }
  img.style.display = "none";
}

// Default company data
const defaultCompanyData = {
  "name": "TechPro IT Services",
  "address": "123 Tech Plaza, Business District, Mumbai, 400001",
  "phone": "+91-22-1234-5678",
  "email": "invoices@techpro.com",
  "website": "www.techpro.com",
  "gstin": "27AABCT1234H1Z0",
  "bankName": "",
  "accountNumber": "",
  "ifscCode": ""
};

function applyInvoiceRecordToState(record) {
  const safeRecord = record || {};
  invoice = new Invoice();
  invoice.setCompanyInfo(safeRecord.company || companyData || defaultCompanyData);
  invoice.setCustomer(safeRecord.customer ? ensureCustomerState(safeRecord.customer) : null);
  invoice.items = Array.isArray(safeRecord.items) ? safeRecord.items.map(ensureInvoiceLineItem) : [];
  invoice.setInvoiceNumber(safeRecord.invoiceNumber || '');
  invoice.setInvoiceDate(safeRecord.invoiceDate || new Date().toISOString().split('T')[0]);
  invoice.setCustomerPurchaseOrderId(safeRecord.customerPurchaseOrderId || '');
  invoice.setPONumber(safeRecord.poNumber || safeRecord.dueDate || '');
  invoice.setPODate(safeRecord.poDate || safeRecord.invoiceDate || '');
  invoice.setShippingAddress(safeRecord.shippingAddress || '');
  invoice.setRoundOffEnabled(safeRecord.roundOffEnabled);
}

function syncInvoiceFormWithState() {
  const invoiceNumberDisplay = document.getElementById('invoiceNumberDisplay');
  if (invoiceNumberDisplay) invoiceNumberDisplay.textContent = invoice.invoiceNumber;

  const invoiceDateInput = document.getElementById('invoiceDate');
  if (invoiceDateInput) invoiceDateInput.value = invoice.invoiceDate;

  const customerSelect = document.getElementById('customerSelect');
  if (customerSelect) customerSelect.value = invoice.customerSelected?.id || '';

  const roundOffSelect = document.getElementById('roundOffSelect');
  if (roundOffSelect) roundOffSelect.value = invoice.isRoundOffEnabled() ? 'Yes' : 'No';

  populateCustomerPurchaseOrderDropdown(invoice.customerSelected?.id || '', invoice.customerPurchaseOrderId || '');

  const customerPoSelect = document.getElementById('customerPoSelect');
  if (customerPoSelect) customerPoSelect.value = invoice.customerPurchaseOrderId || '';

  const poNumberInput = document.getElementById('poNumber');
  if (poNumberInput) poNumberInput.value = invoice.poNumber || '';

  const poDateInput = document.getElementById('poDate');
  if (poDateInput) poDateInput.value = invoice.poDate || invoice.invoiceDate || '';

  const shippingAddressInput = document.getElementById('shippingAddress');
  if (shippingAddressInput) shippingAddressInput.value = invoice.shippingAddress || '';

  const itemSelect = document.getElementById('itemSelect');
  if (itemSelect) itemSelect.value = '';

  const quantityInput = document.getElementById('quantityInput');
  if (quantityInput) quantityInput.value = '';

  const rateInput = document.getElementById('rateInput');
  if (rateInput) rateInput.value = '';
}

function setInvoiceSaveButtonLabel() {
  const saveButton = document.getElementById('saveInvoiceBtn');
  if (!saveButton) return;
  saveButton.textContent = editingInvoiceIndex !== null ? "Update Invoice" : "Save Invoice";
}

function restoreCurrentInvoiceDraftIntoEditor() {
  const draftPayload = readCurrentInvoiceDraftPayload();
  if (!draftPayload || !draftPayload.invoice) {
    renderItemsTable();
    updateInvoicePreview();
    setInvoiceSaveButtonLabel();
    return;
  }

  editingInvoiceIndex = normalizeEditingInvoiceIndex(draftPayload.editingInvoiceIndex);

  applyInvoiceRecordToState(draftPayload.invoice);
  syncInvoiceFormWithState();
  renderItemsTable();
  updateInvoicePreview();
  setInvoiceSaveButtonLabel();
}

function initializeStandalonePreviewPage() {
  storage = new InvoiceStorage();
  companyData = readStorageJson(STORAGE_KEYS.company, defaultCompanyData) || defaultCompanyData;
  customersData = getSafeStoredList(STORAGE_KEYS.customers).map(ensureCustomerState);
  itemsData = getSafeStoredList(STORAGE_KEYS.items).map(ensureCatalogItem);
  customerPurchaseOrdersData = getSafeCustomerPurchaseOrders();
  organizationPurchaseOrdersData = getSafeOrganizationPurchaseOrders();

  const draftPayload = readCurrentInvoiceDraftPayload();
  if (draftPayload && draftPayload.invoice) {
    editingInvoiceIndex = normalizeEditingInvoiceIndex(draftPayload.editingInvoiceIndex);
    applyInvoiceRecordToState(draftPayload.invoice);
  } else {
    editingInvoiceIndex = null;
    invoice = new Invoice();
    invoice.setCompanyInfo(companyData);
  }

  setInvoiceSaveButtonLabel();
  updateInvoicePreview();
}

function returnToInvoiceEditor() {
  window.location.href = "app.html";
}

function openInvoicePreviewPage() {
  syncInvoiceStateFromForm();
  persistCurrentInvoiceDraft();
  window.location.href = "invoice-preview.html";
}

// Initialize the application
function initializeApp() {
  invoice = new Invoice();
  storage = new InvoiceStorage();

  // Initialize as empty arrays
  customersData = [];
  itemsData = [];
  customerPurchaseOrdersData = [];
  organizationPurchaseOrdersData = [];

  // Load company data from localStorage or use default
  const savedCompany = localStorage.getItem(STORAGE_KEYS.company);
  companyData = savedCompany ? JSON.parse(savedCompany) : defaultCompanyData;
  localStorage.setItem(STORAGE_KEYS.company, JSON.stringify(companyData));
  invoice.setCompanyInfo(companyData);

  // Check if customers and items exist in localStorage
  const savedCustomers = localStorage.getItem(STORAGE_KEYS.customers);
  const savedItems = localStorage.getItem(STORAGE_KEYS.items);
  const savedCustomerPurchaseOrders = localStorage.getItem(STORAGE_KEYS.customerPurchaseOrders);
  const savedOrganizationPurchaseOrders = localStorage.getItem(STORAGE_KEYS.organizationPurchaseOrders);

  if (savedCustomers) {
    const parsedCustomers = JSON.parse(savedCustomers);
    customersData = Array.isArray(parsedCustomers) ? parsedCustomers.map(ensureCustomerState) : [];
    localStorage.setItem(STORAGE_KEYS.customers, JSON.stringify(customersData));
  }
  if (savedItems) {
    const parsedItems = JSON.parse(savedItems);
    itemsData = Array.isArray(parsedItems) ? parsedItems.map(ensureCatalogItem) : [];
    localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(itemsData));
  }
  if (savedCustomerPurchaseOrders) {
    const parsedCustomerPurchaseOrders = JSON.parse(savedCustomerPurchaseOrders);
    customerPurchaseOrdersData = Array.isArray(parsedCustomerPurchaseOrders)
      ? parsedCustomerPurchaseOrders.map(ensureCustomerPurchaseOrder)
      : [];
    persistCustomerPurchaseOrders();
  }
  if (savedOrganizationPurchaseOrders) {
    const parsedOrganizationPurchaseOrders = JSON.parse(savedOrganizationPurchaseOrders);
    organizationPurchaseOrdersData = Array.isArray(parsedOrganizationPurchaseOrders)
      ? parsedOrganizationPurchaseOrders.map(ensureOrganizationPurchaseOrder)
      : [];
    persistOrganizationPurchaseOrders();
  }

  // If both customers and items exist, show main section, otherwise show setup
  if (customersData.length > 0 && itemsData.length > 0) {
    showMainSection();
  } else {
    showSetupSection();
  }
}

// Show setup section
function showSetupSection() {
  document.getElementById('setupSection').style.display = 'block';
  document.getElementById('mainSection').style.display = 'none';
  
  // Load company info into form
  document.getElementById('companyName').value = companyData.name || '';
  document.getElementById('companyAddress').value = companyData.address || '';
  document.getElementById('companyPhone').value = companyData.phone || '';
  document.getElementById('companyEmail').value = companyData.email || '';
  document.getElementById('companyGST').value = companyData.gstin || '';
  document.getElementById('companyWebsite').value = companyData.website || '';
  document.getElementById('companyBank').value = companyData.bankName || '';
  document.getElementById('companyAccount').value = companyData.accountNumber || '';
  document.getElementById('companyIFSC').value = companyData.ifscCode || '';
  
  displayCustomersList();
  displayItemsList();
}

// Save company info
function saveCompanyInfo() {
  const name = document.getElementById('companyName').value.trim();
  const address = document.getElementById('companyAddress').value.trim();
  const phone = document.getElementById('companyPhone').value.trim();
  const email = document.getElementById('companyEmail').value.trim();
  const gstin = document.getElementById('companyGST').value.trim();
  const website = document.getElementById('companyWebsite').value.trim();
  const bankName = document.getElementById('companyBank').value.trim();
  const accountNumber = document.getElementById('companyAccount').value.trim();
  const ifscCode = document.getElementById('companyIFSC').value.trim();

  if (!name || !address || !gstin) {
    alert('Please fill Company Name, Address, and GSTIN.');
    return;
  }

  companyData = {
    name: name,
    address: address,
    phone: phone,
    email: email,
    website: website,
    gstin: gstin,
    bankName: bankName,
    accountNumber: accountNumber,
    ifscCode: ifscCode
  };

  localStorage.setItem(STORAGE_KEYS.company, JSON.stringify(companyData));
  invoice.setCompanyInfo(companyData);

  alert('Company information saved successfully!');
}

function getDashboardMetrics() {
  const invoices = getSafeInvoices();
  const customerPurchaseOrders = getSafeCustomerPurchaseOrders();
  const organizationPurchaseOrders = getSafeOrganizationPurchaseOrders();

  return {
    totalSales: invoices.reduce((sum, entry) => sum + safeNumber(entry.grandTotal), 0),
    totalCustomerPoValue: customerPurchaseOrders.reduce((sum, entry) => sum + safeNumber(entry.amount), 0),
    totalPurchases: organizationPurchaseOrders.reduce((sum, entry) => sum + safeNumber(entry.amount), 0),
    netBusiness: invoices.reduce((sum, entry) => sum + safeNumber(entry.grandTotal), 0) -
      organizationPurchaseOrders.reduce((sum, entry) => sum + safeNumber(entry.amount), 0),
    openCustomerPoCount: customerPurchaseOrders.filter((entry) => entry.status === 'Open').length,
    openPurchaseCount: organizationPurchaseOrders.filter((entry) => entry.status === 'Placed').length,
    invoiceCount: invoices.length,
    customerPoCount: customerPurchaseOrders.length,
    purchaseCount: organizationPurchaseOrders.length
  };
}

function renderDashboardGraph(metrics) {
  const container = document.getElementById('dashboardGraph');
  if (!container) return;

  const chartSeries = [
    { key: 'sales', label: 'Sales', value: safeNumber(metrics.totalSales), cssClass: 'dashboard-bar-sales' },
    { key: 'customer-po', label: 'Customer POs', value: safeNumber(metrics.totalCustomerPoValue), cssClass: 'dashboard-bar-customer-po' },
    { key: 'purchases', label: 'Purchases', value: safeNumber(metrics.totalPurchases), cssClass: 'dashboard-bar-purchases' },
    { key: 'net', label: 'Net Position', value: safeNumber(metrics.netBusiness), cssClass: 'dashboard-bar-net' }
  ];

  const maxValue = Math.max(...chartSeries.map((entry) => Math.abs(entry.value)), 1);
  container.innerHTML = `
    <div class="dashboard-chart">
      ${chartSeries.map((entry) => {
        const height = Math.max(10, Math.round((Math.abs(entry.value) / maxValue) * 200));
        return `
          <div class="dashboard-bar-card">
            <div class="dashboard-bar-wrap">
              <div class="dashboard-bar ${entry.cssClass}" style="height:${height}px;"></div>
            </div>
            <div class="dashboard-bar-label">${entry.label}</div>
            <div class="dashboard-bar-value">${formatMoney(entry.value)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderDashboardSummary() {
  const container = document.getElementById('dashboardSummary');
  if (!container) return;

  const metrics = getDashboardMetrics();

  container.innerHTML = `
    <div class="dashboard-grid">
      <article class="dashboard-card dashboard-card-sales">
        <div class="dashboard-card-label">Sales</div>
        <div class="dashboard-card-value">${formatMoney(metrics.totalSales)}</div>
        <div class="dashboard-card-meta">${metrics.invoiceCount} saved invoice(s)</div>
      </article>
      <article class="dashboard-card dashboard-card-customer-po">
        <div class="dashboard-card-label">Customer POs</div>
        <div class="dashboard-card-value">${formatMoney(metrics.totalCustomerPoValue)}</div>
        <div class="dashboard-card-meta">${metrics.customerPoCount} received, ${metrics.openCustomerPoCount} open</div>
      </article>
      <article class="dashboard-card dashboard-card-purchases">
        <div class="dashboard-card-label">Purchases</div>
        <div class="dashboard-card-value">${formatMoney(metrics.totalPurchases)}</div>
        <div class="dashboard-card-meta">${metrics.purchaseCount} placed, ${metrics.openPurchaseCount} still active</div>
      </article>
      <article class="dashboard-card dashboard-card-net">
        <div class="dashboard-card-label">Net Position</div>
        <div class="dashboard-card-value">${formatMoney(metrics.netBusiness)}</div>
        <div class="dashboard-card-meta">Sales minus purchases</div>
      </article>
    </div>
  `;

  renderDashboardGraph(metrics);
}

function showWorkspaceView(view) {
  currentWorkspaceView = view;

  const panelMap = {
    invoice: 'invoiceWorkspace',
    'customer-pos': 'customerPoWorkspace',
    purchases: 'purchaseWorkspace',
    dashboard: 'dashboardWorkspace'
  };

  const tabMap = {
    invoice: 'workspaceTabInvoice',
    'customer-pos': 'workspaceTabCustomerPos',
    purchases: 'workspaceTabPurchases',
    dashboard: 'workspaceTabDashboard'
  };

  Object.entries(panelMap).forEach(([key, id]) => {
    const panel = document.getElementById(id);
    if (panel) {
      panel.classList.toggle('active', key === view);
    }
  });

  Object.entries(tabMap).forEach(([key, id]) => {
    const tab = document.getElementById(id);
    if (tab) {
      tab.classList.toggle('active', key === view);
    }
  });

  if (view === 'dashboard') {
    renderDashboardSummary();
  }
}

function populateCustomerPurchaseOrderFormCustomers(selectedCustomerId = '') {
  const select = document.getElementById('customerPoCustomer');
  if (!select) return;

  select.innerHTML = '<option value="">-- Select Customer --</option>';
  customersData.forEach((customer) => {
    const safeCustomer = ensureCustomerState(customer);
    const option = document.createElement('option');
    option.value = safeCustomer.id;
    option.textContent = safeCustomer.name;
    select.appendChild(option);
  });

  if (selectedCustomerId) {
    select.value = selectedCustomerId;
  }
}

function getCustomerPurchaseOrderDraftTotal() {
  return customerPurchaseOrderDraftItems.reduce((sum, item) => sum + safeNumber(item.total), 0);
}

function syncCustomerPurchaseOrderAmountField() {
  const amountInput = document.getElementById('customerPoAmount');
  if (!amountInput) return;
  amountInput.value = getCustomerPurchaseOrderDraftTotal().toFixed(2);
}

function clearCustomerPurchaseOrderItemEntryFields() {
  const itemSelect = document.getElementById('customerPoItemSelect');
  const quantityInput = document.getElementById('customerPoItemQuantity');
  const rateInput = document.getElementById('customerPoItemRate');
  const descriptionInput = document.getElementById('customerPoItemDescription');
  if (itemSelect) itemSelect.value = '';
  if (quantityInput) quantityInput.value = '';
  if (rateInput) rateInput.value = '';
  if (descriptionInput) descriptionInput.value = '';
}

function populateCustomerPurchaseOrderItemDropdown(selectedItemId = '') {
  const select = document.getElementById('customerPoItemSelect');
  if (!select) return;

  select.innerHTML = '<option value="">-- Select Item --</option>';
  itemsData.forEach((item) => {
    const safeItem = ensureCatalogItem(item);
    const option = document.createElement('option');
    option.value = safeItem.id;
    option.textContent = `${safeItem.name} | ${formatMoney(safeNumber(safeItem.defaultRate))}`;
    option.dataset.item = JSON.stringify(safeItem);
    select.appendChild(option);
  });

  if (selectedItemId) {
    select.value = selectedItemId;
  }

  select.onchange = handleCustomerPurchaseOrderItemSelection;
}

function handleCustomerPurchaseOrderItemSelection() {
  const select = document.getElementById('customerPoItemSelect');
  const rateInput = document.getElementById('customerPoItemRate');
  const descriptionInput = document.getElementById('customerPoItemDescription');
  const quantityInput = document.getElementById('customerPoItemQuantity');
  if (!select || !rateInput || !descriptionInput || !quantityInput) return;

  if (!select.value) {
    rateInput.value = '';
    descriptionInput.value = '';
    quantityInput.value = '';
    return;
  }

  const itemData = JSON.parse(select.options[select.selectedIndex].dataset.item);
  rateInput.value = String(safeNumber(itemData.defaultRate) || '');
  descriptionInput.value = itemData.description || '';
  if (!quantityInput.value) {
    quantityInput.value = '1';
  }
}

function renderCustomerPurchaseOrderItemsTable() {
  const tableBody = document.getElementById('customerPoItemsTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = '';

  if (customerPurchaseOrderDraftItems.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No PO items added yet</td></tr>';
    syncCustomerPurchaseOrderAmountField();
    return;
  }

  customerPurchaseOrderDraftItems.forEach((item, index) => {
    const safeItem = ensureOrderLineItem(item);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>
        <strong>${safeItem.name}</strong>
        <textarea onchange="updateCustomerPurchaseOrderDraftItemDescription(${index}, this.value)">${safeItem.description || ''}</textarea>
      </td>
      <td>${safeItem.hsnSac}</td>
      <td class="text-right">
        <input class="inline-qty-input" type="number" min="1" step="1" value="${safeItem.quantity}" onchange="updateCustomerPurchaseOrderDraftItemQuantity(${index}, this.value)">
      </td>
      <td class="text-right">
        <input class="inline-rate-input" type="number" min="0" step="0.01" value="${safeItem.rate}" onchange="updateCustomerPurchaseOrderDraftItemRate(${index}, this.value)">
      </td>
      <td class="text-right">${formatMoney(safeItem.total)}</td>
      <td class="text-right"><button class="btn btn-danger" onclick="removeCustomerPurchaseOrderDraftItem(${index})">Delete</button></td>
    `;
    tableBody.appendChild(row);
  });

  syncCustomerPurchaseOrderAmountField();
}

function addItemToCustomerPurchaseOrderDraft() {
  const itemSelect = document.getElementById('customerPoItemSelect');
  const quantityInput = document.getElementById('customerPoItemQuantity');
  const rateInput = document.getElementById('customerPoItemRate');
  const descriptionInput = document.getElementById('customerPoItemDescription');

  const selectedItem = ensureCatalogItem(itemsData.find((item) => item.id === itemSelect?.value) || {});
  const quantity = safeNumber(quantityInput?.value);
  const rate = safeNumber(rateInput?.value);
  const description = String(descriptionInput?.value || '').trim();

  if (!selectedItem.id) {
    alert('Select an item from the list before adding it to the customer PO.');
    return;
  }

  if (quantity <= 0 || rate <= 0) {
    alert('Enter a valid quantity and rate for the PO item.');
    return;
  }

  customerPurchaseOrderDraftItems.push(ensureOrderLineItem({
    id: selectedItem.id,
    name: selectedItem.name,
    description: description || selectedItem.description || '',
    hsnSac: selectedItem.hsnSac,
    quantity,
    rate
  }));

  clearCustomerPurchaseOrderItemEntryFields();
  renderCustomerPurchaseOrderItemsTable();
}

function updateCustomerPurchaseOrderDraftItemDescription(index, value) {
  const item = customerPurchaseOrderDraftItems[index];
  if (!item) return;
  item.description = String(value || '').trim();
  renderCustomerPurchaseOrderItemsTable();
}

function updateCustomerPurchaseOrderDraftItemQuantity(index, value) {
  const item = customerPurchaseOrderDraftItems[index];
  if (!item) return;

  const quantity = safeNumber(value);
  if (quantity <= 0) {
    alert('Quantity must be greater than 0.');
    renderCustomerPurchaseOrderItemsTable();
    return;
  }

  item.quantity = quantity;
  item.total = quantity * safeNumber(item.rate);
  renderCustomerPurchaseOrderItemsTable();
}

function updateCustomerPurchaseOrderDraftItemRate(index, value) {
  const item = customerPurchaseOrderDraftItems[index];
  if (!item) return;

  const rate = safeNumber(value);
  if (rate <= 0) {
    alert('Rate must be greater than 0.');
    renderCustomerPurchaseOrderItemsTable();
    return;
  }

  item.rate = rate;
  item.total = safeNumber(item.quantity) * rate;
  renderCustomerPurchaseOrderItemsTable();
}

function removeCustomerPurchaseOrderDraftItem(index) {
  if (index < 0 || index >= customerPurchaseOrderDraftItems.length) return;
  customerPurchaseOrderDraftItems.splice(index, 1);
  renderCustomerPurchaseOrderItemsTable();
}

function clearCustomerPurchaseOrderFormFields() {
  const today = new Date().toISOString().split('T')[0];
  customerPurchaseOrderDraftItems = [];
  populateCustomerPurchaseOrderFormCustomers();
  populateCustomerPurchaseOrderItemDropdown();
  document.getElementById('customerPoNumber').value = '';
  document.getElementById('customerPoDate').value = today;
  document.getElementById('customerPoAmount').value = '0.00';
  document.getElementById('customerPoStatus').value = 'Open';
  document.getElementById('customerPoNotes').value = '';
  clearCustomerPurchaseOrderItemEntryFields();
  renderCustomerPurchaseOrderItemsTable();
}

function setCustomerPurchaseOrderFormMode() {
  const actionBtn = document.getElementById('customerPoActionBtn');
  const cancelBtn = document.getElementById('cancelCustomerPoEditBtn');
  if (!actionBtn || !cancelBtn) return;

  const isEditing = editingCustomerPurchaseOrderIndex !== null;
  actionBtn.textContent = isEditing ? 'Update Customer PO' : '+ Add Customer PO';
  actionBtn.classList.toggle('btn-success', !isEditing);
  actionBtn.classList.toggle('btn-primary', isEditing);
  cancelBtn.style.display = isEditing ? 'inline-block' : 'none';
}

function cancelCustomerPurchaseOrderEdit() {
  editingCustomerPurchaseOrderIndex = null;
  clearCustomerPurchaseOrderFormFields();
  setCustomerPurchaseOrderFormMode();
}

function saveCustomerPurchaseOrder() {
  const customerId = document.getElementById('customerPoCustomer').value;
  const poNumber = document.getElementById('customerPoNumber').value.trim();
  const poDate = document.getElementById('customerPoDate').value;
  const amount = getCustomerPurchaseOrderDraftTotal();
  const status = document.getElementById('customerPoStatus').value;
  const notes = document.getElementById('customerPoNotes').value.trim();

  if (!customerId || !poNumber || !poDate || amount <= 0) {
    alert('Select a customer, enter PO number and date, and add at least one PO item.');
    return;
  }

  const customer = customersData.find((entry) => entry.id === customerId);
  if (!customer) {
    alert('Selected customer is unavailable. Refresh and try again.');
    return;
  }

  const isEditing = editingCustomerPurchaseOrderIndex !== null && !!customerPurchaseOrdersData[editingCustomerPurchaseOrderIndex];
  const existingRecord = isEditing ? ensureCustomerPurchaseOrder(customerPurchaseOrdersData[editingCustomerPurchaseOrderIndex]) : null;
  const record = ensureCustomerPurchaseOrder({
    id: existingRecord?.id || getNextEntityId('CPO', customerPurchaseOrdersData),
    customerId,
    customerName: ensureCustomerState(customer).name,
    poNumber,
    poDate,
    amount,
    status,
    notes,
    items: customerPurchaseOrderDraftItems.map(ensureOrderLineItem),
    linkedInvoiceNumber: existingRecord?.linkedInvoiceNumber || ''
  });

  if (isEditing) {
    customerPurchaseOrdersData[editingCustomerPurchaseOrderIndex] = record;
  } else {
    customerPurchaseOrdersData.push(record);
  }

  persistCustomerPurchaseOrders();
  editingCustomerPurchaseOrderIndex = null;

  if (invoice.customerPurchaseOrderId === record.id) {
    document.getElementById('poNumber').value = record.poNumber;
    document.getElementById('poDate').value = record.poDate;
    invoice.setPONumber(record.poNumber);
    invoice.setPODate(record.poDate);
  }

  clearCustomerPurchaseOrderFormFields();
  setCustomerPurchaseOrderFormMode();
  displayCustomerPurchaseOrdersList();
  populateCustomerPurchaseOrderDropdown(invoice.customerSelected?.id || '', invoice.customerPurchaseOrderId || '');
  renderDashboardSummary();
  updateInvoicePreview();
}

function editCustomerPurchaseOrder(index) {
  const record = customerPurchaseOrdersData[index];
  if (!record) return;
  const safeRecord = ensureCustomerPurchaseOrder(record);

  editingCustomerPurchaseOrderIndex = index;
  customerPurchaseOrderDraftItems = Array.isArray(safeRecord.items) ? safeRecord.items.map(ensureOrderLineItem) : [];
  populateCustomerPurchaseOrderFormCustomers(safeRecord.customerId);
  populateCustomerPurchaseOrderItemDropdown();
  document.getElementById('customerPoNumber').value = safeRecord.poNumber;
  document.getElementById('customerPoDate').value = safeRecord.poDate;
  document.getElementById('customerPoAmount').value = safeNumber(safeRecord.amount).toFixed(2);
  document.getElementById('customerPoStatus').value = safeRecord.status;
  document.getElementById('customerPoNotes').value = safeRecord.notes;
  clearCustomerPurchaseOrderItemEntryFields();
  renderCustomerPurchaseOrderItemsTable();
  setCustomerPurchaseOrderFormMode();

  const select = document.getElementById('customerPurchaseOrdersDropdown');
  if (select) select.value = String(index);
}

function editSelectedCustomerPurchaseOrder() {
  const select = document.getElementById('customerPurchaseOrdersDropdown');
  if (!select || select.value === '') return;
  editCustomerPurchaseOrder(parseInt(select.value, 10));
}

function displayCustomerPurchaseOrdersList() {
  const container = document.getElementById('customerPurchaseOrdersList');
  if (!container) return;

  if (!customerPurchaseOrdersData || customerPurchaseOrdersData.length === 0) {
    container.innerHTML = '<p class="setup-empty">No customer purchase orders added yet</p>';
    setCustomerPurchaseOrderFormMode();
    return;
  }

  let options = '';
  customerPurchaseOrdersData.forEach((record, index) => {
    const safeRecord = ensureCustomerPurchaseOrder(record);
    const selected = editingCustomerPurchaseOrderIndex === index ? ' selected' : '';
    const invoiceRef = safeRecord.linkedInvoiceNumber ? ` | Invoice: ${safeRecord.linkedInvoiceNumber}` : '';
    options += `<option value="${index}"${selected}>${safeRecord.customerName} | ${safeRecord.poNumber} | ${safeRecord.items.length} item(s) | ${formatMoney(safeRecord.amount)} | ${safeRecord.status}${invoiceRef}</option>`;
  });

  container.innerHTML = `
    <div class="setup-dropdown-wrap">
      <select id="customerPurchaseOrdersDropdown" class="setup-dropdown">${options}</select>
      <div class="setup-dropdown-actions">
        <button class="btn btn-primary" onclick="editSelectedCustomerPurchaseOrder()">Edit Selected</button>
        <button class="btn btn-danger" onclick="deleteSelectedCustomerPurchaseOrder()">Delete Selected</button>
      </div>
    </div>
  `;
  setCustomerPurchaseOrderFormMode();
}

function deleteCustomerPurchaseOrder(index) {
  const record = customerPurchaseOrdersData[index];
  if (!record) return;

  if (!confirm('Are you sure you want to delete this customer purchase order?')) {
    return;
  }

  const removedRecord = ensureCustomerPurchaseOrder(record);
  customerPurchaseOrdersData.splice(index, 1);
  persistCustomerPurchaseOrders();

  if (editingCustomerPurchaseOrderIndex === index) {
    editingCustomerPurchaseOrderIndex = null;
    clearCustomerPurchaseOrderFormFields();
  } else if (editingCustomerPurchaseOrderIndex !== null && editingCustomerPurchaseOrderIndex > index) {
    editingCustomerPurchaseOrderIndex -= 1;
  }

  if (invoice.customerPurchaseOrderId === removedRecord.id) {
    invoice.setCustomerPurchaseOrderId('');
    document.getElementById('customerPoSelect').value = '';
    document.getElementById('poNumber').value = '';
    document.getElementById('poDate').value = document.getElementById('invoiceDate').value || '';
    invoice.setPONumber('');
    invoice.setPODate(document.getElementById('poDate').value || '');
    updateInvoicePreview();
  }

  displayCustomerPurchaseOrdersList();
  populateCustomerPurchaseOrderDropdown(invoice.customerSelected?.id || '', invoice.customerPurchaseOrderId || '');
  renderDashboardSummary();
}

function deleteSelectedCustomerPurchaseOrder() {
  const select = document.getElementById('customerPurchaseOrdersDropdown');
  if (!select || select.value === '') return;
  deleteCustomerPurchaseOrder(parseInt(select.value, 10));
}

function replaceInvoiceItemsFromCustomerPurchaseOrder(record, skipConfirm = false) {
  const safeRecord = ensureCustomerPurchaseOrder(record);
  const shouldConfirm = !skipConfirm && invoice.items.length > 0 && invoice.customerPurchaseOrderId !== safeRecord.id;
  if (shouldConfirm) {
    const proceed = confirm('Replace current invoice items with the selected customer PO items?');
    if (!proceed) {
      return false;
    }
  }

  invoice.clearItems();
  invoice.items = safeRecord.items.map(ensureInvoiceLineItem);
  const itemSelect = document.getElementById('itemSelect');
  const quantityInput = document.getElementById('quantityInput');
  const rateInput = document.getElementById('rateInput');
  if (itemSelect) itemSelect.value = '';
  if (quantityInput) quantityInput.value = '';
  if (rateInput) rateInput.value = '';
  renderItemsTable();
  updateInvoicePreview();
  return true;
}

function populateCustomerPurchaseOrderDropdown(customerId = '', selectedRecordId = '') {
  const select = document.getElementById('customerPoSelect');
  if (!select) return;

  const safeCustomerId = String(customerId || '').trim();
  const availableRecords = customerPurchaseOrdersData
    .map(ensureCustomerPurchaseOrder)
    .filter((record) => record.customerId === safeCustomerId);
  const currentValue = selectedRecordId || invoice.customerPurchaseOrderId || '';

  select.onchange = handleCustomerPurchaseOrderSelection;

  if (!safeCustomerId) {
    select.disabled = true;
    select.innerHTML = '<option value="">-- Select Customer First --</option>';
    return;
  }

  select.disabled = false;
  if (availableRecords.length === 0) {
    select.disabled = true;
    select.innerHTML = '<option value="">-- No Saved Customer POs --</option>';
    return;
  }

  let options = '<option value="">-- Select Saved Customer PO --</option>';
  availableRecords.forEach((record) => {
    options += `<option value="${record.id}">${record.poNumber} | ${record.items.length} item(s) | ${formatMoney(record.amount)} | ${record.status}</option>`;
  });
  select.innerHTML = options;

  if (currentValue && availableRecords.some((record) => record.id === currentValue)) {
    select.value = currentValue;
  } else {
    select.value = '';
  }
}

function handleCustomerPurchaseOrderSelection() {
  const select = document.getElementById('customerPoSelect');
  const poNumberInput = document.getElementById('poNumber');
  const poDateInput = document.getElementById('poDate');
  if (!select || !poNumberInput || !poDateInput) return;

  if (!select.value) {
    invoice.setCustomerPurchaseOrderId('');
    poNumberInput.value = '';
    poDateInput.value = document.getElementById('invoiceDate').value || '';
    invoice.setPONumber('');
    invoice.setPODate(poDateInput.value || '');
    updateInvoicePreview();
    return;
  }

  const record = customerPurchaseOrdersData
    .map(ensureCustomerPurchaseOrder)
    .find((entry) => entry.id === select.value);
  if (!record) {
    select.value = '';
    invoice.setCustomerPurchaseOrderId('');
    return;
  }

  const previousPoId = invoice.customerPurchaseOrderId || '';
  const previousPoNumber = invoice.poNumber || '';
  const previousPoDate = invoice.poDate || '';
  poNumberInput.value = record.poNumber;
  poDateInput.value = record.poDate;
  invoice.setPONumber(record.poNumber);
  invoice.setPODate(record.poDate);
  if (record.items.length > 0) {
    const replaced = replaceInvoiceItemsFromCustomerPurchaseOrder(record);
    if (!replaced) {
      select.value = previousPoId;
      poNumberInput.value = previousPoNumber;
      poDateInput.value = previousPoDate;
      invoice.setPONumber(previousPoNumber);
      invoice.setPODate(previousPoDate);
      return;
    }
  }
  invoice.setCustomerPurchaseOrderId(record.id);
  updateInvoicePreview();
}

function clearOrganizationPurchaseOrderFormFields() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('organizationOrderVendor').value = '';
  document.getElementById('organizationOrderNumber').value = '';
  document.getElementById('organizationOrderDate').value = today;
  document.getElementById('organizationOrderAmount').value = '';
  document.getElementById('organizationOrderStatus').value = 'Placed';
  document.getElementById('organizationOrderNotes').value = '';
}

function setOrganizationPurchaseOrderFormMode() {
  const actionBtn = document.getElementById('organizationOrderActionBtn');
  const cancelBtn = document.getElementById('cancelOrganizationOrderEditBtn');
  if (!actionBtn || !cancelBtn) return;

  const isEditing = editingOrganizationPurchaseOrderIndex !== null;
  actionBtn.textContent = isEditing ? 'Update Purchase Order' : '+ Add Purchase Order';
  actionBtn.classList.toggle('btn-success', !isEditing);
  actionBtn.classList.toggle('btn-primary', isEditing);
  cancelBtn.style.display = isEditing ? 'inline-block' : 'none';
}

function cancelOrganizationPurchaseOrderEdit() {
  editingOrganizationPurchaseOrderIndex = null;
  clearOrganizationPurchaseOrderFormFields();
  setOrganizationPurchaseOrderFormMode();
}

function saveOrganizationPurchaseOrder() {
  const vendorName = document.getElementById('organizationOrderVendor').value.trim();
  const poNumber = document.getElementById('organizationOrderNumber').value.trim();
  const poDate = document.getElementById('organizationOrderDate').value;
  const amount = safeNumber(document.getElementById('organizationOrderAmount').value);
  const status = document.getElementById('organizationOrderStatus').value;
  const notes = document.getElementById('organizationOrderNotes').value.trim();

  if (!vendorName || !poNumber || !poDate || amount <= 0) {
    alert('Enter vendor, order number, date, and amount for the purchase order.');
    return;
  }

  const isEditing = editingOrganizationPurchaseOrderIndex !== null && !!organizationPurchaseOrdersData[editingOrganizationPurchaseOrderIndex];
  const existingRecord = isEditing ? ensureOrganizationPurchaseOrder(organizationPurchaseOrdersData[editingOrganizationPurchaseOrderIndex]) : null;
  const record = ensureOrganizationPurchaseOrder({
    id: existingRecord?.id || getNextEntityId('PPO', organizationPurchaseOrdersData),
    vendorName,
    poNumber,
    poDate,
    amount,
    status,
    notes
  });

  if (isEditing) {
    organizationPurchaseOrdersData[editingOrganizationPurchaseOrderIndex] = record;
  } else {
    organizationPurchaseOrdersData.push(record);
  }

  persistOrganizationPurchaseOrders();
  editingOrganizationPurchaseOrderIndex = null;
  clearOrganizationPurchaseOrderFormFields();
  setOrganizationPurchaseOrderFormMode();
  displayOrganizationPurchaseOrdersList();
  renderDashboardSummary();
}

function editOrganizationPurchaseOrder(index) {
  const record = organizationPurchaseOrdersData[index];
  if (!record) return;
  const safeRecord = ensureOrganizationPurchaseOrder(record);

  editingOrganizationPurchaseOrderIndex = index;
  document.getElementById('organizationOrderVendor').value = safeRecord.vendorName;
  document.getElementById('organizationOrderNumber').value = safeRecord.poNumber;
  document.getElementById('organizationOrderDate').value = safeRecord.poDate;
  document.getElementById('organizationOrderAmount').value = String(safeRecord.amount || '');
  document.getElementById('organizationOrderStatus').value = safeRecord.status;
  document.getElementById('organizationOrderNotes').value = safeRecord.notes;
  setOrganizationPurchaseOrderFormMode();

  const select = document.getElementById('organizationPurchaseOrdersDropdown');
  if (select) select.value = String(index);
}

function editSelectedOrganizationPurchaseOrder() {
  const select = document.getElementById('organizationPurchaseOrdersDropdown');
  if (!select || select.value === '') return;
  editOrganizationPurchaseOrder(parseInt(select.value, 10));
}

function displayOrganizationPurchaseOrdersList() {
  const container = document.getElementById('organizationPurchaseOrdersList');
  if (!container) return;

  if (!organizationPurchaseOrdersData || organizationPurchaseOrdersData.length === 0) {
    container.innerHTML = '<p class="setup-empty">No organization purchase orders added yet</p>';
    setOrganizationPurchaseOrderFormMode();
    return;
  }

  let options = '';
  organizationPurchaseOrdersData.forEach((record, index) => {
    const safeRecord = ensureOrganizationPurchaseOrder(record);
    const selected = editingOrganizationPurchaseOrderIndex === index ? ' selected' : '';
    options += `<option value="${index}"${selected}>${safeRecord.vendorName} | ${safeRecord.poNumber} | ${formatDateDisplay(safeRecord.poDate)} | ${formatMoney(safeRecord.amount)} | ${safeRecord.status}</option>`;
  });

  container.innerHTML = `
    <div class="setup-dropdown-wrap">
      <select id="organizationPurchaseOrdersDropdown" class="setup-dropdown">${options}</select>
      <div class="setup-dropdown-actions">
        <button class="btn btn-primary" onclick="editSelectedOrganizationPurchaseOrder()">Edit Selected</button>
        <button class="btn btn-danger" onclick="deleteSelectedOrganizationPurchaseOrder()">Delete Selected</button>
      </div>
    </div>
  `;
  setOrganizationPurchaseOrderFormMode();
}

function deleteOrganizationPurchaseOrder(index) {
  const record = organizationPurchaseOrdersData[index];
  if (!record) return;

  if (!confirm('Are you sure you want to delete this organization purchase order?')) {
    return;
  }

  organizationPurchaseOrdersData.splice(index, 1);
  persistOrganizationPurchaseOrders();

  if (editingOrganizationPurchaseOrderIndex === index) {
    editingOrganizationPurchaseOrderIndex = null;
    clearOrganizationPurchaseOrderFormFields();
  } else if (editingOrganizationPurchaseOrderIndex !== null && editingOrganizationPurchaseOrderIndex > index) {
    editingOrganizationPurchaseOrderIndex -= 1;
  }

  displayOrganizationPurchaseOrdersList();
  renderDashboardSummary();
}

function deleteSelectedOrganizationPurchaseOrder() {
  const select = document.getElementById('organizationPurchaseOrdersDropdown');
  if (!select || select.value === '') return;
  deleteOrganizationPurchaseOrder(parseInt(select.value, 10));
}

function linkCustomerPurchaseOrderToInvoice(poId, invoiceNumber) {
  const index = customerPurchaseOrdersData.findIndex((entry) => ensureCustomerPurchaseOrder(entry).id === poId);
  if (index < 0) return;

  const record = ensureCustomerPurchaseOrder(customerPurchaseOrdersData[index]);
  customerPurchaseOrdersData[index] = {
    ...record,
    linkedInvoiceNumber: invoiceNumber,
    status: record.status === 'Closed' ? 'Closed' : 'Invoiced'
  };
  persistCustomerPurchaseOrders();
  displayCustomerPurchaseOrdersList();
  populateCustomerPurchaseOrderDropdown(invoice.customerSelected?.id || '', poId);
  renderDashboardSummary();
}

function unlinkCustomerPurchaseOrderFromInvoice(poId, invoiceNumber = '') {
  const index = customerPurchaseOrdersData.findIndex((entry) => ensureCustomerPurchaseOrder(entry).id === poId);
  if (index < 0) return;

  const record = ensureCustomerPurchaseOrder(customerPurchaseOrdersData[index]);
  if (invoiceNumber && record.linkedInvoiceNumber && record.linkedInvoiceNumber !== invoiceNumber) {
    return;
  }

  customerPurchaseOrdersData[index] = {
    ...record,
    linkedInvoiceNumber: '',
    status: record.status === 'Invoiced' ? 'Open' : record.status
  };
  persistCustomerPurchaseOrders();
  displayCustomerPurchaseOrdersList();
  populateCustomerPurchaseOrderDropdown(invoice.customerSelected?.id || '', invoice.customerPurchaseOrderId || '');
  renderDashboardSummary();
}

function syncCustomerPurchaseOrdersForCustomer(customer) {
  let hasChanges = false;
  customerPurchaseOrdersData = customerPurchaseOrdersData.map((entry) => {
    const record = ensureCustomerPurchaseOrder(entry);
    if (record.customerId !== customer.id || record.customerName === customer.name) {
      return record;
    }
    hasChanges = true;
    return {
      ...record,
      customerName: customer.name
    };
  });

  if (!hasChanges) return;
  persistCustomerPurchaseOrders();
  displayCustomerPurchaseOrdersList();
  populateCustomerPurchaseOrderDropdown(invoice.customerSelected?.id || '', invoice.customerPurchaseOrderId || '');
}

function removeCustomerPurchaseOrdersForCustomer(customerId) {
  const previousLength = customerPurchaseOrdersData.length;
  const removedIds = customerPurchaseOrdersData
    .map(ensureCustomerPurchaseOrder)
    .filter((entry) => entry.customerId === customerId)
    .map((entry) => entry.id);

  customerPurchaseOrdersData = customerPurchaseOrdersData
    .map(ensureCustomerPurchaseOrder)
    .filter((entry) => entry.customerId !== customerId);

  if (customerPurchaseOrdersData.length === previousLength) return;

  persistCustomerPurchaseOrders();
  if (removedIds.includes(invoice.customerPurchaseOrderId)) {
    invoice.setCustomerPurchaseOrderId('');
    const customerPoSelect = document.getElementById('customerPoSelect');
    if (customerPoSelect) customerPoSelect.value = '';
    const poNumberInput = document.getElementById('poNumber');
    const poDateInput = document.getElementById('poDate');
    if (poNumberInput) poNumberInput.value = '';
    if (poDateInput) {
      poDateInput.value = document.getElementById('invoiceDate').value || '';
      invoice.setPODate(poDateInput.value || '');
    }
    invoice.setPONumber('');
    updateInvoicePreview();
  }
  displayCustomerPurchaseOrdersList();
  populateCustomerPurchaseOrderDropdown(invoice.customerSelected?.id || '', invoice.customerPurchaseOrderId || '');
  renderDashboardSummary();
}

// Show main invoice creation section
function showMainSection() {
  document.getElementById('setupSection').style.display = 'none';
  document.getElementById('mainSection').style.display = 'block';
  generateNewInvoiceNumber();
  populateCustomerDropdown();
  populateCustomerPurchaseOrderFormCustomers();
  populateCustomerPurchaseOrderItemDropdown();
  populateCustomerPurchaseOrderDropdown();
  populateItemsDropdown();
  setTodayDate();
  attachFormListeners();
  displayCustomerPurchaseOrdersList();
  displayOrganizationPurchaseOrdersList();
  setCustomerPurchaseOrderFormMode();
  setOrganizationPurchaseOrderFormMode();
  if (editingCustomerPurchaseOrderIndex === null) clearCustomerPurchaseOrderFormFields();
  if (editingOrganizationPurchaseOrderIndex === null) clearOrganizationPurchaseOrderFormFields();
  renderDashboardSummary();
  restoreCurrentInvoiceDraftIntoEditor();
  showWorkspaceView('invoice');
}

function attachFormListeners() {
  if (formListenersAttached) return;

  const poNumberInput = document.getElementById('poNumber');
  const poDateInput = document.getElementById('poDate');

  if (poNumberInput) {
    poNumberInput.addEventListener('input', handlePONumberChange);
  }

  if (poDateInput) {
    poDateInput.addEventListener('change', handlePODateChange);
  }

  formListenersAttached = true;
}

function clearCustomerFormFields() {
  document.getElementById('customerName').value = '';
  document.getElementById('customerEmail').value = '';
  document.getElementById('customerPhone').value = '';
  document.getElementById('customerAddress').value = '';
  document.getElementById('customerGST').value = '';
  document.getElementById('customerState').value = '';
}

function setCustomerFormMode() {
  const actionBtn = document.getElementById('customerActionBtn');
  const cancelBtn = document.getElementById('cancelCustomerEditBtn');
  if (!actionBtn || !cancelBtn) return;

  const isEditing = editingCustomerIndex !== null;
  actionBtn.textContent = isEditing ? 'Update Customer' : '+ Add Customer';
  actionBtn.classList.toggle('btn-success', !isEditing);
  actionBtn.classList.toggle('btn-primary', isEditing);
  cancelBtn.style.display = isEditing ? 'inline-block' : 'none';
}

function clearItemFormFields() {
  document.getElementById('itemType').value = 'Service';
  document.getElementById('itemName').value = '';
  document.getElementById('itemDescription').value = '';
  document.getElementById('itemHsn').value = '';
  document.getElementById('itemRate').value = '';
}

function setItemFormMode() {
  const actionBtn = document.getElementById('itemActionBtn');
  const cancelBtn = document.getElementById('cancelItemEditBtn');
  if (!actionBtn || !cancelBtn) return;

  const isEditing = editingItemIndex !== null;
  actionBtn.textContent = isEditing ? 'Update Item/Service' : '+ Add Item/Service';
  actionBtn.classList.toggle('btn-success', !isEditing);
  actionBtn.classList.toggle('btn-primary', isEditing);
  cancelBtn.style.display = isEditing ? 'inline-block' : 'none';
}

function cancelCustomerEdit() {
  editingCustomerIndex = null;
  clearCustomerFormFields();
  setCustomerFormMode();
}

function cancelItemEdit() {
  editingItemIndex = null;
  clearItemFormFields();
  setItemFormMode();
}

// Add or update Customer
function addCustomer() {
  const name = document.getElementById('customerName').value.trim();
  const email = document.getElementById('customerEmail').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  const address = document.getElementById('customerAddress').value.trim();
  const gstin = document.getElementById('customerGST').value.trim();
  const state = normalizeState(document.getElementById('customerState').value);

  if (!name || !address || !gstin) {
    alert('Please fill Customer Name, Address, and GSTIN.');
    return;
  }

  const isEditing = editingCustomerIndex !== null && !!customersData[editingCustomerIndex];
  const existingCustomer = isEditing ? customersData[editingCustomerIndex] : null;
  const customer = ensureCustomerState({
    id: existingCustomer?.id || getNextEntityId('CUST', customersData),
    name,
    email,
    phone,
    address,
    gstin,
    state
  });

  if (isEditing) {
    customersData[editingCustomerIndex] = customer;
  } else {
    customersData.push(customer);
  }
  localStorage.setItem(STORAGE_KEYS.customers, JSON.stringify(customersData));
  syncCustomerPurchaseOrdersForCustomer(customer);

  if (invoice.customerSelected?.id === customer.id) {
    invoice.setCustomer(customer);
    updateInvoicePreview();
  }

  editingCustomerIndex = null;
  clearCustomerFormFields();
  setCustomerFormMode();
  displayCustomersList();
  populateCustomerDropdown();
  populateCustomerPurchaseOrderFormCustomers();
  checkIfReadyToStart();
}

function editCustomer(index) {
  const existingCustomer = customersData[index];
  if (!existingCustomer) return;
  const customer = ensureCustomerState(existingCustomer);

  editingCustomerIndex = index;
  document.getElementById('customerName').value = customer.name || '';
  document.getElementById('customerEmail').value = customer.email || '';
  document.getElementById('customerPhone').value = customer.phone || '';
  document.getElementById('customerAddress').value = customer.address || '';
  document.getElementById('customerGST').value = customer.gstin || '';
  document.getElementById('customerState').value = customer.state || '';

  setCustomerFormMode();
  const select = document.getElementById('customersDropdown');
  if (select) select.value = String(index);
}

function editSelectedCustomer() {
  const select = document.getElementById('customersDropdown');
  if (!select || select.value === '') return;
  editCustomer(parseInt(select.value, 10));
}

// Display Customers List
function displayCustomersList() {
  const container = document.getElementById('customersList');

  if (!customersData || customersData.length === 0) {
    container.innerHTML = '<p class="setup-empty">No customers added yet</p>';
    setCustomerFormMode();
    return;
  }

  let options = '';
  customersData.forEach((customer, index) => {
    const safeCustomer = ensureCustomerState(customer);
    const selected = editingCustomerIndex === index ? ' selected' : '';
    options += `<option value="${index}"${selected}>${safeCustomer.name} | ${safeCustomer.state || DEFAULT_LOCAL_STATE} | GSTIN: ${displayOptional(safeCustomer.gstin)} | Phone: ${displayOptional(safeCustomer.phone)}</option>`;
  });

  container.innerHTML = `
    <div class="setup-dropdown-wrap">
      <select id="customersDropdown" class="setup-dropdown">${options}</select>
      <div class="setup-dropdown-actions">
        <button class="btn btn-primary" onclick="editSelectedCustomer()">Edit Selected</button>
        <button class="btn btn-danger" onclick="deleteSelectedCustomer()">Delete Selected</button>
      </div>
    </div>
  `;
  setCustomerFormMode();
}

// Delete Customer
function deleteCustomer(index) {
  const customer = customersData[index];
  if (!customer) return;

  if (confirm('Are you sure you want to delete this customer?')) {
    customersData.splice(index, 1);

    if (editingCustomerIndex === index) {
      editingCustomerIndex = null;
      clearCustomerFormFields();
    } else if (editingCustomerIndex !== null && editingCustomerIndex > index) {
      editingCustomerIndex -= 1;
    }

    if (invoice.customerSelected?.id === customer.id) {
      invoice.setCustomer(null);
      const customerSelect = document.getElementById('customerSelect');
      if (customerSelect) customerSelect.value = '';
      updateInvoicePreview();
    }

    localStorage.setItem(STORAGE_KEYS.customers, JSON.stringify(customersData));
    removeCustomerPurchaseOrdersForCustomer(customer.id);
    displayCustomersList();
    populateCustomerDropdown();
    populateCustomerPurchaseOrderFormCustomers();
    checkIfReadyToStart();
  }
}

function deleteSelectedCustomer() {
  const select = document.getElementById('customersDropdown');
  if (!select || select.value === '') return;
  deleteCustomer(parseInt(select.value, 10));
}

// Add or update Item
function addItem() {
  const type = document.getElementById('itemType').value;
  const name = document.getElementById('itemName').value.trim();
  const description = document.getElementById('itemDescription').value.trim();
  const hsnSac = normalizeHsnSac(document.getElementById('itemHsn').value);
  const rate = document.getElementById('itemRate').value.trim();

  if (!name || !description || !rate) {
    alert('Please fill in all item fields');
    return;
  }

  if (parseFloat(rate) <= 0) {
    alert('Rate must be greater than 0');
    return;
  }

  const isEditing = editingItemIndex !== null && !!itemsData[editingItemIndex];
  const existingItem = isEditing ? ensureCatalogItem(itemsData[editingItemIndex]) : null;
  const item = ensureCatalogItem({
    id: existingItem?.id || getNextEntityId('SRV', itemsData),
    type,
    name,
    description,
    hsnSac,
    defaultRate: parseFloat(rate)
  });

  if (isEditing) {
    itemsData[editingItemIndex] = item;
  } else {
    itemsData.push(item);
  }
  localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(itemsData));

  invoice.items = invoice.items.map((lineItem) => {
    if (lineItem.id !== item.id) return lineItem;
    return {
      ...lineItem,
      name: item.name,
      description: item.description,
      hsnSac: item.hsnSac
    };
  });

  customerPurchaseOrderDraftItems = customerPurchaseOrderDraftItems.map((lineItem) => {
    if (lineItem.id !== item.id) return lineItem;
    return {
      ...lineItem,
      name: item.name,
      hsnSac: item.hsnSac
    };
  });

  editingItemIndex = null;
  clearItemFormFields();
  setItemFormMode();
  displayItemsList();
  populateItemsDropdown();
  populateCustomerPurchaseOrderItemDropdown();
  renderCustomerPurchaseOrderItemsTable();
  renderItemsTable();
  updateInvoicePreview();
  checkIfReadyToStart();
}

function editItem(index) {
  const existingItem = itemsData[index];
  if (!existingItem) return;
  const item = ensureCatalogItem(existingItem);

  editingItemIndex = index;
  document.getElementById('itemType').value = item.type || 'Service';
  document.getElementById('itemName').value = item.name || '';
  document.getElementById('itemDescription').value = item.description || '';
  document.getElementById('itemHsn').value = item.hsnSac || '';
  document.getElementById('itemRate').value = String(safeNumber(item.defaultRate) || '');

  setItemFormMode();
  const select = document.getElementById('itemsDropdown');
  if (select) select.value = String(index);
}

function editSelectedItem() {
  const select = document.getElementById('itemsDropdown');
  if (!select || select.value === '') return;
  editItem(parseInt(select.value, 10));
}

// Display Items List
function displayItemsList() {
  const container = document.getElementById('itemsList');

  if (!itemsData || itemsData.length === 0) {
    container.innerHTML = '<p class="setup-empty">No items added yet</p>';
    setItemFormMode();
    return;
  }

  let options = '';
  itemsData.forEach((item, index) => {
    const safeItem = ensureCatalogItem(item);
    const selected = editingItemIndex === index ? ' selected' : '';
    options += `<option value="${index}"${selected}>${safeItem.name} | HSN/SAC: ${safeItem.hsnSac} | ${formatMoney(safeItem.defaultRate)}</option>`;
  });

  container.innerHTML = `
    <div class="setup-dropdown-wrap">
      <select id="itemsDropdown" class="setup-dropdown">${options}</select>
      <div class="setup-dropdown-actions">
        <button class="btn btn-primary" onclick="editSelectedItem()">Edit Selected</button>
        <button class="btn btn-danger" onclick="deleteSelectedItem()">Delete Selected</button>
      </div>
    </div>
  `;
  setItemFormMode();
}

// Delete Item
function deleteItem(index) {
  const item = itemsData[index];
  if (!item) return;

  if (confirm('Are you sure you want to delete this item?')) {
    itemsData.splice(index, 1);

    if (editingItemIndex === index) {
      editingItemIndex = null;
      clearItemFormFields();
    } else if (editingItemIndex !== null && editingItemIndex > index) {
      editingItemIndex -= 1;
    }

    localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(itemsData));
    displayItemsList();
    populateItemsDropdown();
    populateCustomerPurchaseOrderItemDropdown();
    checkIfReadyToStart();
  }
}

function deleteSelectedItem() {
  const select = document.getElementById('itemsDropdown');
  if (!select || select.value === '') return;
  deleteItem(parseInt(select.value, 10));
}

// Check if ready to start invoice creation
function checkIfReadyToStart() {
  const startBtn = document.querySelector('[onclick="startInvoiceCreation()"]');
  if (startBtn) {
    if (customersData && customersData.length > 0 && itemsData && itemsData.length > 0) {
      startBtn.disabled = false;
      startBtn.style.opacity = '1';
    } else {
      startBtn.disabled = true;
      startBtn.style.opacity = '0.5';
    }
  }
}

// Start invoice creation
function startInvoiceCreation() {
  if (!customersData || customersData.length === 0 || !itemsData || itemsData.length === 0) {
    alert('Please add at least one customer and one item before continuing');
    return;
  }
  showMainSection();
}

// Back to setup
function backToSetup() {
  showSetupSection();
}

// Populate customer dropdown
function populateCustomerDropdown() {
  const select = document.getElementById('customerSelect');
  const currentValue = invoice.customerSelected?.id || '';
  select.innerHTML = '<option value="">-- Select Customer --</option>';

  customersData.forEach((customer) => {
    const safeCustomer = ensureCustomerState(customer);
    const option = document.createElement('option');
    option.value = safeCustomer.id;
    option.textContent = safeCustomer.name;
    option.dataset.customer = JSON.stringify(safeCustomer);
    select.appendChild(option);
  });

  if (currentValue) {
    select.value = currentValue;
  }

  select.onchange = handleCustomerChange;
}

// Handle customer change
function handleCustomerChange() {
  const select = document.getElementById('customerSelect');
  const previousCustomerId = invoice.customerSelected?.id || '';
  if (select.value) {
    const customerData = JSON.parse(select.options[select.selectedIndex].dataset.customer);
    invoice.setCustomer(customerData);
  } else {
    invoice.setCustomer(null);
  }

  if (!select.value || select.value !== previousCustomerId) {
    invoice.setCustomerPurchaseOrderId('');
    document.getElementById('poNumber').value = '';
    document.getElementById('poDate').value = document.getElementById('invoiceDate').value || '';
    invoice.setPONumber('');
    invoice.setPODate(document.getElementById('poDate').value || '');
  }

  populateCustomerPurchaseOrderDropdown(select.value || '');
  updateInvoicePreview();
}

// Populate items dropdown
function populateItemsDropdown() {
  const select = document.getElementById('itemSelect');
  select.innerHTML = '<option value="">-- Select Service/Item --</option>';

  itemsData.forEach((item) => {
    const safeItem = ensureCatalogItem(item);
    const option = document.createElement('option');
    option.value = safeItem.id;
    option.textContent = safeItem.name;
    option.dataset.item = JSON.stringify(safeItem);
    select.appendChild(option);
  });

  select.onchange = handleItemChange;
}

// Handle item change
function handleItemChange() {
  const select = document.getElementById('itemSelect');
  const rateInput = document.getElementById('rateInput');

  if (select.value) {
    const itemData = JSON.parse(select.options[select.selectedIndex].dataset.item);
    rateInput.value = itemData.defaultRate;
  } else {
    rateInput.value = '';
  }
}

// Set today's date
function setTodayDate() {
  const today = new Date().toISOString().split('T')[0];
  const invoiceDateInput = document.getElementById('invoiceDate');
  const poDateInput = document.getElementById('poDate');
  if (invoiceDateInput) invoiceDateInput.value = today;
  if (poDateInput) poDateInput.value = today;
  invoice.setInvoiceDate(today);
  invoice.setPODate(today);
}

// Generate new invoice number
function generateNewInvoiceNumber() {

  const invoices = getSafeInvoices();

  let nextNumber = 1;

  if (invoices.length > 0) {

    // Get last invoice in array
    const lastInvoice = invoices[invoices.length - 1];

    if (lastInvoice.invoiceNumber) {

      const match = lastInvoice.invoiceNumber.match(/\d+/);

      if (match) {
        nextNumber = parseInt(match[0], 10) + 1;
      }
    }
  }

  const formattedNumber = `INV-${String(nextNumber).padStart(4, '0')}`;

  const invoiceNumberDisplay = document.getElementById('invoiceNumberDisplay');
  if (invoiceNumberDisplay) {
    invoiceNumberDisplay.textContent = formattedNumber;
  }
  invoice.setInvoiceNumber(formattedNumber);
}

// Handle date change
function handleDateChange(event) {
  invoice.setInvoiceDate(event.target.value);
  updateInvoicePreview();
}

function handlePONumberChange(event) {
  invoice.setPONumber(event.target.value.trim());
  updateInvoicePreview();
}

function handlePODateChange(event) {
  invoice.setPODate(event.target.value);
  updateInvoicePreview();
}

function handleShippingAddressChange(event) {
  invoice.setShippingAddress(event.target.value);
  updateInvoicePreview();
}

function handleRoundOffChange(event) {
  invoice.setRoundOffEnabled(event.target.value);
  updateInvoicePreview();
}

function syncInvoiceStateFromForm() {
  const invoiceDateInput = document.getElementById('invoiceDate');
  if (invoiceDateInput?.value) {
    invoice.setInvoiceDate(invoiceDateInput.value);
  }

  const poNumberInput = document.getElementById('poNumber');
  if (poNumberInput) {
    invoice.setPONumber(poNumberInput.value.trim());
  }

  const poDateInput = document.getElementById('poDate');
  if (poDateInput) {
    invoice.setPODate(poDateInput.value || '');
  }

  const shippingAddressInput = document.getElementById('shippingAddress');
  if (shippingAddressInput) {
    invoice.setShippingAddress(shippingAddressInput.value || '');
  }

  const customerPoSelect = document.getElementById('customerPoSelect');
  if (customerPoSelect) {
    invoice.setCustomerPurchaseOrderId(customerPoSelect.value || '');
  }

  const roundOffSelect = document.getElementById('roundOffSelect');
  if (roundOffSelect) {
    invoice.setRoundOffEnabled(roundOffSelect.value);
  }
}

// Validate form inputs
function validateInputs() {
  const customerSelect = document.getElementById('customerSelect').value;
  const itemSelect = document.getElementById('itemSelect').value;
  const quantity = document.getElementById('quantityInput').value;
  const rate = document.getElementById('rateInput').value;

  if (!customerSelect) {
    alert('Please select a customer');
    return false;
  }

  if (!itemSelect) {
    alert('Please select a service/item');
    return false;
  }

  if (!quantity || parseFloat(quantity) <= 0) {
    alert('Please enter a valid quantity');
    return false;
  }

  if (!rate || parseFloat(rate) <= 0) {
    alert('Please enter a valid rate');
    return false;
  }

  return true;
}

// Add item to invoice
function addItemToInvoice() {
  if (!validateInputs()) return;

  const itemSelect = document.getElementById('itemSelect');
  const quantityInput = document.getElementById('quantityInput');
  const rateInput = document.getElementById('rateInput');

  const selectedItem = ensureCatalogItem(itemsData.find(item => item.id === itemSelect.value) || {});
  const quantity = quantityInput.value;
  const rate = rateInput.value;

  if (!selectedItem.id) {
    alert('Selected item is invalid. Please choose again.');
    return;
  }

  invoice.addItem(selectedItem, quantity, rate);

  // Clear form
  itemSelect.value = '';
  quantityInput.value = '';
  rateInput.value = '';

  updateInvoicePreview();
  renderItemsTable();
}

// Render items table
function renderItemsTable() {
  const tableBody = document.getElementById('invoiceItemsTableBody');
  tableBody.innerHTML = '';

  if (invoice.items.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No items added yet</td></tr>';
    return;
  }

  invoice.items.forEach((item, index) => {
    const safeItem = ensureInvoiceLineItem(item);
    const rateWithTax = item.rate * 1.18;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>
        <strong>${item.name}</strong>
        <textarea onchange="updateItemDescription(${index}, this.value)">${safeItem.description || ''}</textarea>
      </td>
      <td>${safeItem.hsnSac}</td>
      <td class="text-right">
        <input
          class="inline-qty-input"
          type="number"
          value="${safeItem.quantity}"
          min="1"
          step="1"
          onchange="updateQuantity(${index}, this.value)">
      </td>
      <td class="text-right">${invoice.formatCurrency(rateWithTax)}</td>
      <td class="text-right">
        <input
          class="inline-rate-input"
          type="number"
          value="${safeItem.rate}"
          min="0"
          step="0.01"
          onchange="updateItemRate(${index}, this.value)">
      </td>
      <td class="text-right">${invoice.formatCurrency(safeItem.total)}</td>
      <td class="text-right"><button class="btn btn-danger" onclick="removeItem(${index})">Delete</button></td>
    `;
    tableBody.appendChild(row);
  });
}

// Remove item from invoice
function removeItem(index) {
  invoice.removeItem(index);
  renderItemsTable();
  updateInvoicePreview();
}
function updateQuantity(index, newQty) {

  const qty = parseFloat(newQty);

  if (!qty || qty <= 0) {
    alert("Quantity must be greater than 0");
    renderItemsTable();
    return;
  }

  const item = invoice.items[index];

  item.quantity = qty;
  item.total = qty * item.rate;

  renderItemsTable();
  updateInvoicePreview();
}

function updateItemRate(index, newRate) {
  const rate = safeNumber(newRate);
  if (rate <= 0) {
    alert("Rate must be greater than 0");
    renderItemsTable();
    return;
  }

  const item = invoice.items[index];
  if (!item) return;

  item.rate = rate;
  item.total = safeNumber(item.quantity) * rate;

  renderItemsTable();
  updateInvoicePreview();
}

function updateItemDescription(index, newDescription) {
  const item = invoice.items[index];
  if (!item) return;

  item.description = String(newDescription || '').trim();
  updateInvoicePreview();
}

// Update invoice preview
function updateInvoicePreview() {
  const preview = document.getElementById('invoicePreview');
  persistCurrentInvoiceDraft();

  if (!preview) {
    return;
  }

  if (invoice.isEmpty() || !invoice.customerSelected) {
    const emptyMessage = isStandalonePreviewPage()
      ? 'Open an invoice from the editor to see the preview here.'
      : 'Select a customer and add items to preview invoice';
    preview.innerHTML = `<div class="empty-state"><p>${emptyMessage}</p></div>`;
    return;
  }

  const companyInfo = invoice.companyInfo;
  const customer = ensureCustomerState(invoice.customerSelected);
  const subtotal = invoice.getSubtotal();
  const cgst = invoice.getCGST();
  const sgst = invoice.getSGST();
  const igst = invoice.getIGST();
  const totalBeforeRoundOff = invoice.getPreRoundGrandTotal();
  const roundOffAmount = invoice.getRoundOffAmount();
  const grandTotal = invoice.getGrandTotal();
  const isInterState = invoice.isInterStateSale();
  const poDateDisplay = invoice.poDate ? invoice.formatDate(invoice.poDate) : '-';
  const shippingAddress = String(invoice.shippingAddress || '').trim();

  let itemsHTML = '';
  invoice.items.forEach((item, index) => {
    const safeItem = ensureInvoiceLineItem(item);
    const rateWithTax = item.rate * 1.18;
    itemsHTML += `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${item.name}</strong><br><span class="item-subtext">${item.description || '-'}</span></td>
        <td>${safeItem.hsnSac}</td>
        <td class="text-right">${item.quantity}</td>
        <td class="text-right">${invoice.formatCurrency(rateWithTax)}</td>
        <td class="text-right">${invoice.formatCurrency(item.rate)}</td>
        <td class="text-right">${invoice.formatCurrency(item.total)}</td>
      </tr>
    `;
  });

  const taxRowsHTML = isInterState
    ? `<div class="totals-row"><span class="total-label">IGST (18%):</span><span class="total-amount">${invoice.formatCurrency(igst)}</span></div>`
    : `
      <div class="totals-row"><span class="total-label">CGST (9%):</span><span class="total-amount">${invoice.formatCurrency(cgst)}</span></div>
      <div class="totals-row"><span class="total-label">SGST (9%):</span><span class="total-amount">${invoice.formatCurrency(sgst)}</span></div>
    `;
  const roundOffRowHTML = invoice.isRoundOffEnabled()
    ? `<div class="totals-row"><span class="total-label">Round Off:</span><span class="total-amount">${invoice.formatCurrency(roundOffAmount)}</span></div>`
    : '';
  const totalBeforeRoundOffRowHTML = invoice.isRoundOffEnabled()
    ? `<div class="totals-row total-before-roundoff-row"><span class="total-label">Total:</span><span class="total-amount">${invoice.formatCurrency(totalBeforeRoundOff)}</span></div>`
    : '';

  preview.innerHTML = `
    <div class="invoice-preview">
      <div class="invoice-header">
        <div class="invoice-title-center">Tax Invoice</div>
        <div class="invoice-header-row">
          <div class="company-brand">
            <div class="company-brand-top">
              <img
                class="invoice-logo-image"
                src="assets/Logo.jpeg"
                alt="Digidat Info Systems Logo"
                onerror="handleLogoFallback(this)"
              >
              <div class="invoice-logo-fallback">${getCompanyInitials(companyInfo.name)}</div>
              <div class="company-info">
                <p>${companyInfo.address}</p>
                <p>Phone: ${displayOptional(companyInfo.phone)}</p>
                <p>Email: ${displayOptional(companyInfo.email)}</p>
                <p>GSTIN: ${displayOptional(companyInfo.gstin)}</p>
              </div>
            </div>
          </div>
          <div class="customer-info buyer-info-block">
            <div class="section-title">Buyer (Bill To):</div>
            <p><strong>${customer.name}</strong></p>
            <p class="buyer-address-line">${customer.address}</p>
            <p>State: ${customer.state || DEFAULT_LOCAL_STATE} | GSTIN: ${displayOptional(customer.gstin)}</p>
            <p>Phone: ${displayOptional(customer.phone)} | Email: ${displayOptional(customer.email)}</p>
            ${shippingAddress ? `<div class="section-title shipping-title">Shipping Address:</div><p class="buyer-address-line">${shippingAddress}</p>` : ''}
          </div>
          <div class="invoice-meta-right">
            <div class="invoice-details">
              <div><strong>INV No:</strong> ${invoice.invoiceNumber}</div>
              <div><strong>Date:</strong> ${invoice.formatDate(invoice.invoiceDate)}</div>
    <p><strong>PO No:</strong> ${
      invoice.poNumber || '-'
    }</p>
    <p><strong>PO Date:</strong> ${poDateDisplay}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="invoice-preview-table-wrap">
        <table class="invoice-table">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Item Description</th>
              <th>HSN/SAC</th>
              <th>Qty</th>
              <th>Rate with Tax</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>
      </div>

      <div class="totals-section">
        <div class="totals-row"><span class="total-label">Subtotal:</span><span class="total-amount">${invoice.formatCurrency(subtotal)}</span></div>
        ${taxRowsHTML}
        ${totalBeforeRoundOffRowHTML}
        ${roundOffRowHTML}
        <div class="grand-total-row">
          <span class="total-label">Grand Total:</span>
          <span class="total-amount">${invoice.formatCurrency(grandTotal)}</span>
        </div>
      </div>
      <div class="totals-signature">
        <p class="signature-company">For DigiDat InfoSystems</p>
        <img
          class="invoice-stamp"
          src="assets/Signature.jpeg"
          alt="Company Stamp"
          onerror="handleStampFallback(this)"
        >
      </div>
      <div class="invoice-footer">
        <p class="invoice-bank-line">Bank: ${companyInfo.bankName || '-'} | Account: ${companyInfo.accountNumber || '-'} | IFSC: ${companyInfo.ifscCode || '-'}</p>
        <p>This is a computer generated invoice</p>
      </div>
    </div>
  `;
  fitBuyerAddressLineElements(preview, window);
}

// Save invoice to storage
function saveInvoice() {
  const previewMode = isStandalonePreviewPage();
  syncInvoiceStateFromForm();

  if (invoice.isEmpty()) {
    alert('Please add at least one item');
    return;
  }

  if (!invoice.customerSelected) {
    alert('Please select a customer');
    return;
  }

  const invoiceData = invoice.toJSON();
  let invoices = getSafeInvoices();
  const canUpdateExisting = Number.isInteger(editingInvoiceIndex)
    && editingInvoiceIndex >= 0
    && editingInvoiceIndex < invoices.length;
  const previousInvoice = canUpdateExisting ? invoices[editingInvoiceIndex] : null;

  if (canUpdateExisting) {
    invoices[editingInvoiceIndex] = invoiceData;
    alert("Invoice updated successfully!");
  } else {
    invoices.push(invoiceData);
    alert("Invoice saved successfully!");
  }

  localStorage.setItem(STORAGE_KEYS.invoices, JSON.stringify(invoices));

  if (previousInvoice?.customerPurchaseOrderId && previousInvoice.customerPurchaseOrderId !== invoiceData.customerPurchaseOrderId) {
    unlinkCustomerPurchaseOrderFromInvoice(previousInvoice.customerPurchaseOrderId, previousInvoice.invoiceNumber || '');
  }
  if (invoiceData.customerPurchaseOrderId) {
    linkCustomerPurchaseOrderToInvoice(invoiceData.customerPurchaseOrderId, invoiceData.invoiceNumber);
  }

  editingInvoiceIndex = null;
  invoice = new Invoice();
  invoice.setCompanyInfo(companyData);
  generateNewInvoiceNumber();
  setTodayDate();
  persistCurrentInvoiceDraft();

  if (previewMode) {
    returnToInvoiceEditor();
    return;
  }

  const customerSelect = document.getElementById('customerSelect');
  if (customerSelect) customerSelect.value = '';

  const customerPoSelect = document.getElementById('customerPoSelect');
  if (customerPoSelect) customerPoSelect.value = '';

  const poNumberInput = document.getElementById('poNumber');
  if (poNumberInput) poNumberInput.value = '';

  const shippingAddressInput = document.getElementById('shippingAddress');
  if (shippingAddressInput) shippingAddressInput.value = '';

  const roundOffSelect = document.getElementById('roundOffSelect');
  if (roundOffSelect) roundOffSelect.value = 'No';

  const poDateInput = document.getElementById('poDate');
  const invoiceDateInput = document.getElementById('invoiceDate');
  if (poDateInput) poDateInput.value = invoiceDateInput?.value || '';

  invoice.setShippingAddress('');
  populateCustomerPurchaseOrderDropdown('');

  renderItemsTable();
  updateInvoicePreview();
  renderDashboardSummary();
  setInvoiceSaveButtonLabel();
}

// Export to PDF
async function exportToPDF() {

  if (invoice.isEmpty() || !invoice.customerSelected) {
    alert('Please complete the invoice first');
    return;
  }

  const preview = document.querySelector('.invoice-preview');
  if (!preview) {
    alert('Invoice preview is not available for PDF export.');
    return;
  }

  if (typeof html2canvas === 'undefined' || !window.jspdf || !window.jspdf.jsPDF) {
    try {
      await exportBasicPdfData();
      return;
    } catch (primaryError) {
      console.error('Primary PDF export failed:', primaryError);
      alert('Download PDF failed. Please try again after refreshing the page.');
      return;
    }
  }

  const invoiceHtml = preview.outerHTML;
  const exportRoot = document.createElement('div');
  exportRoot.id = 'pdfRenderRoot';
  exportRoot.style.position = 'fixed';
  exportRoot.style.top = '0';
  exportRoot.style.left = '0';
  exportRoot.style.width = '100vw';
  exportRoot.style.height = '100vh';
  exportRoot.style.overflow = 'auto';
  exportRoot.style.background = '#fff';
  exportRoot.style.padding = '8mm';
  exportRoot.style.zIndex = '2147483647';
  exportRoot.innerHTML = getInvoiceCopiesMarkup(invoiceHtml);

  document.body.appendChild(exportRoot);
  document.body.classList.add('pdf-export-mode');

  try {
    await waitForInvoiceImages(exportRoot);
    await inlineImages(exportRoot);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const canvas = await html2canvas(exportRoot, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: exportRoot.scrollWidth,
      windowHeight: exportRoot.scrollHeight
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.98);
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 8;
    const contentW = pageW - margin * 2;
    const imgH = (canvas.height * contentW) / canvas.width;
    const pageUsableH = pageH - margin * 2;

    let heightLeft = imgH;
    let y = margin;
    doc.addImage(imgData, 'JPEG', margin, y, contentW, imgH);
    heightLeft -= pageUsableH;

    while (heightLeft > 0) {
      y = heightLeft - imgH + margin;
      doc.addPage();
      doc.addImage(imgData, 'JPEG', margin, y, contentW, imgH);
      heightLeft -= pageUsableH;
    }

    doc.save(`${invoice.invoiceNumber}.pdf`);
  } catch (error) {
    console.error('PDF export failed:', error);
    try {
      await exportBasicPdfData();
    } catch (basicError) {
      console.error('Basic PDF export failed:', basicError);
      alert('Download PDF failed. Please try again after refreshing the page.');
    }
  } finally {
    document.body.classList.remove('pdf-export-mode');
    if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
  }
}

// Print invoice
function printInvoice() {
  if (invoice.isEmpty()) {
    alert('Please add at least one item to the invoice');
    return;
  }

  if (!invoice.customerSelected) {
    alert('Please select a customer');
    return;
  }

  const preview = document.querySelector('.invoice-preview');
  if (!preview) {
    alert('Invoice preview is not available for printing');
    return;
  }

  const invoiceHtml = preview.outerHTML;
  const printWindow = window.open('', '_blank', 'width=1000,height=900');
  if (!printWindow) {
    alert('Popup blocked. Please allow popups to print invoice copies.');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${invoice.invoiceNumber} - Print</title>
      <base href="${window.location.href}">
      <link rel="stylesheet" href="css/styles.css">
      <style>
        body { margin: 0; padding: 0mm; background: #fff; font-family: Arial, sans-serif; }
        .print-copy { margin-bottom: 10mm; page-break-after: always; page-break-inside: auto; }
        .print-copy:last-child { page-break-after: auto; margin-bottom: 0; }
        .copy-label { text-align: right; font-weight: 700; margin-bottom: 4mm; letter-spacing: 0.4px; }
        .item-subtext { color: #4b5563; font-size: 10px; }
        .invoice-header { display: block; margin-bottom: 6px; padding-bottom: 6px; }
        .invoice-title-center { text-align: center; font-weight: 700; font-size: 14px; letter-spacing: 0.4px; margin-bottom: 2px; line-height: 1.05; }
        .invoice-header-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.1fr) minmax(150px, 0.78fr); align-items: flex-start; gap: 9px; }
        .company-brand, .buyer-info-block, .invoice-meta-right { min-width: 0; }
        .company-brand { display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start; }
        .company-brand-top { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: -2px; width: 100%; text-align: left; }
        .invoice-logo-image { display: block; margin: 0 auto 0 0 !important; width: 95px; align-self: flex-start; }
        .invoice-meta-right { margin-left: 0; margin-right: 2.5mm; width: 100%; min-width: 0; max-width: 190px; justify-self: end; display: block; }
        .invoice-meta-right .invoice-details { width: 100%; max-width: 100%; text-align: right; font-size: 9.5px; line-height: 1.15; overflow-wrap: anywhere; word-break: break-word; }
        .copy-label-inline { text-align: right; font-weight: 700; letter-spacing: 0.4px; margin-bottom: 4px; }
        .buyer-info-block { margin-bottom: 0; text-align: left; }
        .buyer-info-block .section-title { margin-top: 0; text-align: left; }
        .company-info { text-align: left; }
        .company-info p, .buyer-info-block p { margin-bottom: 2px; font-size: 10px; line-height: 1.2; overflow-wrap: anywhere; }
        .invoice-details div, .invoice-details p { margin-bottom: 2px; font-size: 9.5px; line-height: 1.15; overflow-wrap: anywhere; word-break: break-word; }
        .buyer-info-block .section-title { font-size: 0.85rem; margin-bottom: 4px; }
        .buyer-address-line {
          display: block;
          white-space: normal;
          overflow: visible;
          text-overflow: unset;
          overflow-wrap: anywhere;
          word-break: break-word;
          line-height: 1.2;
        }
        .invoice-table { width: 100%; table-layout: auto; border-collapse: collapse; }
        .invoice-table thead th { text-align: center !important; white-space: nowrap; }
        .invoice-table th:nth-child(1), .invoice-table td:nth-child(1) { width: 6% !important; text-align: center !important; }
        .invoice-table th:nth-child(2), .invoice-table td:nth-child(2) { width: 36% !important; text-align: left !important; overflow-wrap: anywhere; }
        .invoice-table th:nth-child(3), .invoice-table td:nth-child(3) { width: 12% !important; text-align: center !important; white-space: nowrap; }
        .invoice-table th:nth-child(4),
        .invoice-table th:nth-child(5),
        .invoice-table th:nth-child(6),
        .invoice-table th:nth-child(7) {
          width: 11.5% !important;
          text-align: center !important;
          white-space: nowrap;
        }
        .invoice-table td:nth-child(4),
        .invoice-table td:nth-child(5),
        .invoice-table td:nth-child(6),
        .invoice-table td:nth-child(7) {
          width: 11.5% !important;
          text-align: right !important;
          white-space: nowrap;
        }
        .totals-section { margin-left: auto; width: 52%; min-width: 280px; font-size: 10px; }
        .totals-row, .grand-total-row { display: grid; grid-template-columns: 1fr 130px; gap: 8px; align-items: center; }
        .total-label { text-align: left; }
        .total-amount { text-align: right; justify-self: end; font-size: 10px; }
        @media print {
          body { visibility: visible !important; }
          .invoice-preview { position: static !important; visibility: visible !important; width: 100% !important; box-sizing: border-box !important; padding-right: 3mm !important; page-break-inside: auto !important; }
        }
      </style>
    </head>
    <body>
      ${getInvoiceCopiesMarkup(invoiceHtml)}
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    try {
      fitBuyerAddressLineElements(printWindow.document, printWindow);
    } catch (error) {
      console.warn('Could not auto-fit buyer address for print.', error);
    }
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 120);
  };
}

// Clear form
function clearForm() {
  document.getElementById('customerSelect').value = '';
  document.getElementById('customerPoSelect').value = '';
  document.getElementById('itemSelect').value = '';
  document.getElementById('quantityInput').value = '';
  document.getElementById('rateInput').value = '';
  document.getElementById('poNumber').value = '';
  document.getElementById('shippingAddress').value = '';
  document.getElementById('roundOffSelect').value = 'No';

  invoice.clearItems();
  invoice.customerSelected = null;
  invoice.setCustomerPurchaseOrderId('');
  invoice.setPONumber('');
  invoice.setShippingAddress('');
  invoice.setRoundOffEnabled(false);
  setTodayDate();
  populateCustomerPurchaseOrderDropdown('');
  renderItemsTable();
  updateInvoicePreview();
}
function exportAllInvoicesToExcel() {
  const invoices = getSafeInvoices();

  if (invoices.length === 0) {
    alert("No invoices found.");
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert("Excel export library is not loaded. Please refresh and try again.");
    return;
  }

  try {
    const excelData = invoices.map((inv) => {
      const subtotal = safeNumber(inv.subtotal);
      const cgst = safeNumber(inv.cgst);
      const sgst = safeNumber(inv.sgst);
      const igst = safeNumber(inv.igst);
      const roundOffAmount = safeNumber(inv.roundOffAmount);
      const taxType = inv.taxType || (igst > 0 ? 'IGST' : 'CGST_SGST');

      return {
        "INV No": inv.invoiceNumber || "-",
        "Date": inv.invoiceDate || "-",
        "Customer Name": inv.customer?.name || "Unknown Customer",
        "Customer State": inv.customer?.state || DEFAULT_LOCAL_STATE,
        "No of Products": Array.isArray(inv.items) ? inv.items.length : 0,
        "Subtotal": subtotal.toFixed(2),
        "CGST": cgst.toFixed(2),
        "SGST": sgst.toFixed(2),
        "IGST": igst.toFixed(2),
        "Round Off Applied": inv.roundOffEnabled ? "Yes" : "No",
        "Round Off Amount": roundOffAmount.toFixed(2),
        "Tax Type": taxType,
        "Grand Total": safeNumber(inv.grandTotal).toFixed(2),
        "PO No": inv.poNumber || inv.dueDate || "-",
        "PO Date": inv.poDate || inv.invoiceDate || "-",
        "Shipping Address": inv.shippingAddress || "-"
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Summary");
    XLSX.writeFile(workbook, "All_Invoices_Summary.xlsx");
  } catch (error) {
    console.error("Export failed:", error);
    alert("Export failed. Please check saved invoice data and try again.");
  }
}


function showInvoiceHistory() {
  showWorkspaceView('invoice');
  const invoices = getSafeInvoices();

  const section = document.getElementById('invoiceHistorySection');
  const container = document.getElementById('invoiceHistoryList');

  section.style.display = "block";

  if (invoices.length === 0) {
    container.innerHTML = "<p>No invoices saved yet.</p>";
    return;
  }

  let options = '';
  invoices.forEach((inv, index) => {
    options += `<option value="${index}">${inv.invoiceNumber || "Invoice"} | ${inv.invoiceDate || "-"} | ${inv.customer?.name || "Unknown Customer"} | ${formatMoney(inv.grandTotal)}</option>`;
  });

  container.innerHTML = `
    <div class="setup-dropdown-wrap">
      <select id="savedInvoicesDropdown" class="setup-dropdown">${options}</select>
      <div class="setup-dropdown-actions">
        <button class="btn btn-success history-view-btn" onclick="loadSelectedSavedInvoice()">Load Selected Invoice</button>
      </div>
    </div>
  `;
}

function loadSelectedSavedInvoice() {
  const select = document.getElementById('savedInvoicesDropdown');
  if (!select || select.value === '') return;
  loadInvoice(parseInt(select.value, 10));
}

function loadInvoice(index) {

  const invoices = getSafeInvoices();
  const savedInvoice = invoices[index];

  if (!savedInvoice) {
    alert("Invoice not found.");
    return;
  }

  editingInvoiceIndex = index;
  applyInvoiceRecordToState(savedInvoice);
  syncInvoiceFormWithState();

  renderItemsTable();
  updateInvoicePreview();

  setInvoiceSaveButtonLabel();
  document.getElementById('invoiceHistorySection').style.display = "none";
  showWorkspaceView('invoice');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  if (!ensureAuthenticated()) return;
  window.addEventListener('beforeprint', () => {
    fitBuyerAddressLineElements(document, window);
  });
  try {
    if (isStandalonePreviewPage()) {
      initializeStandalonePreviewPage();
      return;
    }
    initializeApp();
  } catch (error) {
    console.error('App initialization failed:', error);
    const previewPage = isStandalonePreviewPage();
    const setup = document.getElementById('setupSection');
    const main = document.getElementById('mainSection');
    if (setup) setup.style.display = 'block';
    if (main) main.style.display = 'none';
    alert(previewPage
      ? 'Something went wrong while loading the invoice preview.'
      : 'Something went wrong while loading the app. Setup view has been opened.');
  }
});
