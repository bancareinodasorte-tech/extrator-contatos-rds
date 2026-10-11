(() => {
  "use strict";
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "RDS_GET_SESSION") return;
    try {
      let deviceId = localStorage.getItem("deviceId");
      if (!deviceId) {
        deviceId = "web_" + Date.now();
        localStorage.setItem("deviceId", deviceId);
      }
      sendResponse({
        ok: Boolean(localStorage.getItem("accessToken")),
        token: localStorage.getItem("accessToken"),
        deviceId,
        url: location.href
      });
    } catch {
      sendResponse({ ok: false, error: "Não foi possível ler a sessão desta página." });
    }
    return true;
  });
})();