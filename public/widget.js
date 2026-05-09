/**
 * HotelEquip Chat Widget
 * Embed: <script src="https://ask.hotelequip.pt/widget.js"></script>
 *
 * Optional data attributes:
 *   data-color="#1a1a1a"
 *   data-position="right" | "left"
 *   data-greeting="Olá! Posso ajudar?"
 *   data-src="https://ask.hotelequip.pt"   (override iframe URL)
 */
(function () {
  if (window.__heWidgetLoaded) return;
  window.__heWidgetLoaded = true;

  var currentScript =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();

  var color = (currentScript && currentScript.getAttribute("data-color")) || "#1a1a1a";
  var position = (currentScript && currentScript.getAttribute("data-position")) || "right";
  var greeting = (currentScript && currentScript.getAttribute("data-greeting")) || "";
  var srcOverride = currentScript && currentScript.getAttribute("data-src");

  // Default iframe src: same origin as the script
  var scriptSrc = (currentScript && currentScript.src) || "";
  var defaultOrigin = "https://ask.hotelequip.pt";
  try {
    if (scriptSrc) defaultOrigin = new URL(scriptSrc).origin;
  } catch (e) {}
  var iframeSrc = srcOverride || defaultOrigin;

  var STORAGE_KEY = "he-widget-open";
  var posSide = position === "left" ? "left" : "right";

  // Host element + shadow DOM (no style conflicts)
  var host = document.createElement("div");
  host.id = "he-widget-host";
  host.style.cssText =
    "position:fixed;bottom:0;" + posSide + ":0;width:0;height:0;z-index:2147483647;";
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var style = document.createElement("style");
  style.textContent =
    ":host,*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
    ".he-btn{position:fixed;bottom:20px;" + posSide + ":20px;width:56px;height:56px;border-radius:50%;background:" + color + ";color:#fff;border:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;transition:transform .2s ease;z-index:2147483647}" +
    ".he-btn:hover{transform:scale(1.05)}" +
    ".he-btn svg{width:26px;height:26px;display:block}" +
    ".he-badge{position:absolute;top:-4px;" + (posSide === "right" ? "right" : "left") + ":-4px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#e11d48;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;line-height:1}" +
    ".he-badge.show{display:flex}" +
    ".he-greet{position:fixed;bottom:88px;" + posSide + ":20px;max-width:240px;background:#fff;color:#1a1a1a;padding:10px 14px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);font-size:14px;display:none}" +
    ".he-greet.show{display:block}" +
    ".he-panel{position:fixed;bottom:88px;" + posSide + ":20px;width:380px;height:600px;max-width:calc(100vw - 24px);max-height:calc(100vh - 100px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);overflow:hidden;display:flex;flex-direction:column;transform:translateY(20px) scale(.98);opacity:0;pointer-events:none;transition:transform .25s ease,opacity .25s ease}" +
    ".he-panel.open{transform:translateY(0) scale(1);opacity:1;pointer-events:auto}" +
    ".he-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:" + color + ";color:#fff}" +
    ".he-title{font-size:14px;font-weight:600}" +
    ".he-close{background:transparent;border:0;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:4px 8px;border-radius:6px}" +
    ".he-close:hover{background:rgba(255,255,255,.15)}" +
    ".he-frame{flex:1;width:100%;border:0;display:block}" +
    "@media (max-width:767px){.he-panel{width:100vw;height:100vh;max-width:100vw;max-height:100vh;bottom:0;" + posSide + ":0;border-radius:0}.he-greet{display:none!important}}";
  root.appendChild(style);

  // Greeting bubble
  var greet = null;
  if (greeting) {
    greet = document.createElement("div");
    greet.className = "he-greet";
    greet.textContent = greeting;
    root.appendChild(greet);
  }

  // Floating button
  var btn = document.createElement("button");
  btn.className = "he-btn";
  btn.setAttribute("aria-label", "Abrir chat");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
    '<span class="he-badge" id="he-badge">0</span>';
  root.appendChild(btn);

  // Panel
  var panel = document.createElement("div");
  panel.className = "he-panel";
  panel.innerHTML =
    '<div class="he-head"><span class="he-title">HotelEquip Assistente</span>' +
    '<button class="he-close" aria-label="Fechar">×</button></div>' +
    '<iframe class="he-frame" title="HotelEquip Assistente" allow="microphone; clipboard-write" src="about:blank"></iframe>';
  root.appendChild(panel);

  var iframe = panel.querySelector(".he-frame");
  var closeBtn = panel.querySelector(".he-close");
  var badge = root.getElementById ? root.getElementById("he-badge") : root.querySelector("#he-badge");
  var iframeLoaded = false;
  var unread = 0;

  function setUnread(n) {
    unread = Math.max(0, n | 0);
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.classList.add("show");
    } else {
      badge.classList.remove("show");
    }
  }

  function open() {
    if (!iframeLoaded) {
      iframe.src = iframeSrc;
      iframeLoaded = true;
    }
    panel.classList.add("open");
    btn.setAttribute("aria-label", "Fechar chat");
    if (greet) greet.classList.remove("show");
    try { sessionStorage.setItem(STORAGE_KEY, "1"); } catch (e) {}
    setUnread(0);
  }

  function close() {
    panel.classList.remove("open");
    btn.setAttribute("aria-label", "Abrir chat");
    try { sessionStorage.setItem(STORAGE_KEY, "0"); } catch (e) {}
  }

  function toggle() {
    if (panel.classList.contains("open")) close();
    else open();
  }

  btn.addEventListener("click", toggle);
  closeBtn.addEventListener("click", close);

  // Restore previous state
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === "1") open();
  } catch (e) {}

  // Show greeting after delay if never opened
  if (greet) {
    setTimeout(function () {
      if (!panel.classList.contains("open")) greet.classList.add("show");
    }, 1500);
  }

  // Listen for postMessage from chatbot iframe
  window.addEventListener("message", function (ev) {
    var data = ev && ev.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "he-unread") {
      if (!panel.classList.contains("open")) setUnread(data.count || 0);
    } else if (data.type === "he-open") {
      open();
    } else if (data.type === "he-close") {
      close();
    }
  });
})();
