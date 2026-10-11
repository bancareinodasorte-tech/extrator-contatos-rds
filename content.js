(() => {
  "use strict";
  // Encaminha somente o estado de autenticação necessário à extensão; não envia dados para servidores externos.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "RDS_GET_SESSION") return;
    try {
      const token = localStorage.getItem("accessToken");
      sendResponse({ ok: Boolean(token), token: token || null, url: location.href });
    } catch (error) {
      sendResponse({ ok: false, error: "Não foi possível ler a sessão desta página." });
    }
    return true;
  });
})();