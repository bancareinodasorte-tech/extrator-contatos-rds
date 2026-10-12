"use strict";
const API = "https://api.reinodasorte.com.br";
const $ = (id) => document.getElementById(id);
let accessToken = null;
let allDraws = [];
let resultContacts = [];
let activeTabId = null;
let deviceId = null;

function log(message) {
  $("log").textContent = String(message);
}
function setStatus(message) {
  $("connection").textContent = message;
}
function authHeaders() {
  return { "Authorization": "Bearer " + accessToken, "Accept": "application/json", "x-device-id": deviceId || ("web_" + Date.now()) };
}
async function apiGet(path) {
  const response = await fetch(API + path, { method: "GET", headers: authHeaders() });
  const body = await response.text();
  let data;
  try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body.slice(0, 300) }; }
  if (!response.ok) {
    throw new Error("API respondeu HTTP " + response.status + (data.message ? ": " + data.message : ""));
  }
  return data;
}
function unwrapList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["draws", "items", "results", "data"]) {
    if (Array.isArray(data?.[key])) return data[key];
    if (data?.[key] && Array.isArray(data[key].draws)) return data[key].draws;
  }
  return [];
}
function drawId(d) { return d?.id ?? d?.drawId ?? d?.draw_id ?? d?.sorteioId; }
function drawLabel(d) {
  const id = drawId(d);
  const name = d?.title ?? d?.name ?? d?.description ?? d?.drawName ?? d?.draw_name ?? "";
  const status = (d?.draw_status ?? d?.status) ? " · " + (d?.draw_status ?? d?.status) : "";
  return (name ? String(name) + " — " : "Sorteio ") + id + status;
}
async function getTokenFromOfficialTab() {
  const tabs = await chrome.tabs.query({ url: "https://admin.reinodasorte.com.br/*" });
  const tab = tabs.find(t => t.active) || tabs[0];
  if (!tab?.id) throw new Error("Abra o painel oficial https://admin.reinodasorte.com.br/draws e entre na sua conta.");
  activeTabId = tab.id;
  let reply;
  try {
    reply = await chrome.tabs.sendMessage(tab.id, { type: "RDS_GET_SESSION" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    reply = await chrome.tabs.sendMessage(tab.id, { type: "RDS_GET_SESSION" });
  }
  if (!reply?.token) throw new Error("Não encontrei accessToken na sessão desta página. Entre novamente no painel oficial e tente outra vez.");
  accessToken = reply.token;
  deviceId = reply.deviceId || null;
  return tab;
}
function normalizePhone(value) {
  let n = String(value ?? "").replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 10 || n.length === 11) n = "55" + n;
  if (n.length < 12 || n.length > 13 || !n.startsWith("55")) return "";
  const national = n.slice(2);
  if (national.length < 10 || national.length > 11) return "";
  return "+" + n;
}
function getPhone(ticket) {
  const candidates = [
    ticket?.buyer?.phone, ticket?.buyer?.cellphone, ticket?.buyer?.mobile,
    ticket?.customer?.phone, ticket?.customer?.cellphone, ticket?.phone,
    ticket?.buyerPhone, ticket?.buyer_phone, ticket?.telephone,
    ticket?.buyer?.telephone, ticket?.customer?.mobile
  ];
  return candidates.find(v => v != null && String(v).trim()) ?? "";
}
function getBuyerName(ticket) {
  const buyer = ticket?.buyer ?? ticket?.customer ?? {};
  return String(buyer?.name ?? buyer?.fullName ?? buyer?.full_name ?? ticket?.buyerName ?? ticket?.buyer_name ?? ticket?.name ?? "").trim();
}
function getSellerName(ticket) {
  const seller = ticket?.seller ?? ticket?.vendor ?? {};
  return String(seller?.name ?? seller?.fullName ?? ticket?.sellerName ?? ticket?.seller_name ?? "").trim();
}
function cleanName(name) {
  let n = String(name || "SEM NOME").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
  n = n.replace(/^(?:CLIENTE\s*)+/u, "").trim();
  return "CLIENTE " + (n || "SEM NOME");
}
function deduplicateByPhone(rows) {
  const byPhone = new Map();
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, { name: cleanName(row.name), phone, seller: row.seller || "", draw: row.draw || "" });
  }
  const nameCounts = new Map();
  for (const item of byPhone.values()) {
    const count = (nameCounts.get(item.name) || 0) + 1;
    nameCounts.set(item.name, count);
    if (count > 1) item.name += " " + count;
  }
  return [...byPhone.values()];
}
async function loadDraws() {
  await getTokenFromOfficialTab();
  // Endpoints podem variar conforme a versão do painel; não adivinhamos IDs nem incluímos sorteios antigos fixos.
  let response, lastError;
  for (const path of ["/admin/draws", "/admin/draws?page=1&limit=100"]) {
    try { response = await apiGet(path); break; } catch (e) { lastError = e; }
  }
  if (!response) throw lastError || new Error("Não foi possível listar sorteios.");
  allDraws = unwrapList(response);
  if (!allDraws.length) {
    throw new Error("A API respondeu, mas não reconheci a lista de sorteios. A estrutura retornada precisa ser conferida antes de extrair.");
  }
  const seen = new Set();
  allDraws = allDraws.filter(d => drawId(d) != null && !seen.has(String(drawId(d))) && seen.add(String(drawId(d))));
  $("draws").innerHTML = "";
  for (const draw of allDraws) {
    const label = document.createElement("label");
    label.className = "draw";
    const input = document.createElement("input");
    input.type = "checkbox"; input.value = String(drawId(draw)); input.className = "draw-check";
    const text = document.createElement("span");
    text.textContent = drawLabel(draw);
    const small = document.createElement("small");
    small.textContent = "ID: " + drawId(draw) + ((draw?.draw_status ?? draw?.status) ? " · Status: " + (draw?.draw_status ?? draw?.status) : "");
    text.appendChild(small); label.append(input, text); $("draws").appendChild(label);
  }
  $("extract").disabled = false;
  setStatus("Conectado ao painel oficial. Token mantido somente nesta janela.");
  log("Sorteios listados: " + allDraws.length + ". Selecione um ou mais para continuar.");
}
function selectedDraws() {
  const ids = [...document.querySelectorAll(".draw-check:checked")].map(el => el.value);
  return allDraws.filter(d => ids.includes(String(drawId(d))));
}
function unwrapTickets(response) {
  const data = response?.data;
  if (Array.isArray(data?.tickets)) return data.tickets;
  if (Array.isArray(response?.tickets)) return response.tickets;
  if (Array.isArray(data)) return data;
  return [];
}
function pageCount(response) {
  const p = response?.data?.pagination ?? response?.pagination ?? {};
  const total = Number(p.totalPages ?? p.total_pages ?? p.pages ?? 1);
  return Number.isFinite(total) && total > 0 ? Math.min(total, 100000) : 1;
}
async function extractSelected() {
  const draws = selectedDraws();
  if (!draws.length) throw new Error("Marque pelo menos um sorteio.");
  const filter = $("seller").value.trim().toLocaleUpperCase("pt-BR");
  const rows = [];
  let ticketsSeen = 0;
  let pageRequests = 0;
  const lots = [1, 2, 3, 4, 5];
  const errors = [];
  const started = Date.now();
  for (let di = 0; di < draws.length; di++) {
    const draw = draws[di];
    log("Processando sorteio " + drawId(draw) + " (" + (di + 1) + "/" + draws.length + ")…");
    for (const lot of lots) {
      let page = 1, pages = 1;
      do {
        let response;
        try {
          response = await apiGet("/admin/draws/" + encodeURIComponent(drawId(draw)) + "/lots/" + lot + "/tickets?page=" + page + "&limit=100");
        } catch (e) {
          // Lote ausente/inacessível não deve interromper todos os sorteios.
          if (page === 1) { errors.push("Sorteio " + drawId(draw) + ", lote " + lot + ": " + e.message); break; }
          throw e;
        }
        pageRequests++;
        const tickets = unwrapTickets(response);
        pages = pageCount(response);
        for (const ticket of tickets) {
          ticketsSeen++;
          const seller = getSellerName(ticket);
          if (filter && !seller.toLocaleUpperCase("pt-BR").includes(filter)) continue;
          const name = getBuyerName(ticket);
          const phone = getPhone(ticket);
          if (phone) rows.push({ name, phone, seller, draw: drawLabel(draw) });
        }
        if (tickets.length === 0 && page === 1 && pages === 1) break;
        page++;
        if (pageRequests % 10 === 0) log("Sorteio " + drawId(draw) + " · lote " + lot + " · página " + (page - 1) + "/" + pages + "\nBilhetes lidos: " + ticketsSeen);
      } while (page <= pages);
    }
  }
  resultContacts = deduplicateByPhone(rows);
  $("summary").textContent = "Bilhetes lidos: " + ticketsSeen + "\nContatos com telefone válido e únicos: " + resultContacts.length + "\nRequisições de páginas: " + pageRequests + "\nTempo: " + Math.round((Date.now() - started) / 1000) + " s" + (errors.length ? "\nLotes com erro: " + errors.length : "");
  $("export").disabled = !resultContacts.length;
  $("csv").disabled = !resultContacts.length;
  log("Extração encerrada. " + resultContacts.length + " contatos únicos." + (errors.length ? "\nAvisos:\n" + errors.slice(0, 12).join("\n") : ""));
}
function escapeVCard(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function exportVcf() {
  const vcf = resultContacts.map((c, i) => [
    "BEGIN:VCARD", "VERSION:3.0", "N:" + escapeVCard(c.name) + ";;;;",
    "FN:" + escapeVCard(c.name), "TEL;TYPE=CELL:" + c.phone,
    "NOTE:" + escapeVCard("Reino da Sorte | vendedor: " + c.seller + " | sorteio: " + c.draw),
    "UID:rds-" + i + "-" + c.phone.replace(/\D/g, ""), "END:VCARD"
  ].join("\r\n")).join("\r\n") + "\r\n";
  downloadBlob(vcf, "text/vcard;charset=utf-8", "contatos-reino-da-sorte.vcf");
}
function exportCsv() {
  const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const csv = "\uFEFFNome,Telefone,Vendedor,Sorteio\r\n" + resultContacts.map(c => [c.name,c.phone,c.seller,c.draw].map(esc).join(",")).join("\r\n");
  downloadBlob(csv, "text/csv;charset=utf-8", "relatorio-contatos-rds.csv");
}
$("connect").addEventListener("click", async () => {
  try { await getTokenFromOfficialTab(); setStatus("Sessão encontrada. Clique em “Carregar sorteios disponíveis”."); log("Painel encontrado: " + (await chrome.tabs.get(activeTabId)).url); }
  catch (e) { setStatus(e.message); log(e.message); }
});
$("load").addEventListener("click", async () => {
  $("load").disabled = true;
  try { await loadDraws(); }
  catch (e) { setStatus(e.message); log(e.message); }
  finally { $("load").disabled = false; }
});
$("extract").addEventListener("click", async () => {
  $("extract").disabled = true; $("export").disabled = true; $("csv").disabled = true;
  try { await extractSelected(); }
  catch (e) { log("Extração interrompida: " + e.message); }
  finally { $("extract").disabled = false; }
});
$("export").addEventListener("click", exportVcf);
$("csv").addEventListener("click", exportCsv);