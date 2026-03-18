(function localhostGuard(global) {
  const LOCALHOST_PORT = "8080";
  const WINDOWS_POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

  function isDirectFileAccess() {
    return String(global.location.protocol || "").toLowerCase() === "file:";
  }

  function getTargetFileName() {
    const rawPath = String(global.location.pathname || "");
    const segments = rawPath.split(/[\\/]/).filter(Boolean);
    const fileName = segments.length > 0 ? segments[segments.length - 1] : "index.html";
    return fileName.toLowerCase() === "login.html" ? "index.html" : fileName;
  }

  function getLocalhostUrl() {
    const targetFile = getTargetFileName() || "index.html";
    return `http://localhost:${LOCALHOST_PORT}/${targetFile}${global.location.search || ""}${global.location.hash || ""}`;
  }

  function renderLocalhostRequiredNotice() {
    if (!isDirectFileAccess()) return false;
    if (!global.document || !global.document.body) return false;

    const localhostUrl = getLocalhostUrl();
    global.document.title = "Use Localhost";
    global.document.body.innerHTML = `
      <header>
        <h1>DigiDat InfoSystems</h1>
        <p>Use Localhost To Keep One Data Store</p>
      </header>
      <main class="container auth-container">
        <section class="auth-card">
          <h2>Open Shaker On Localhost</h2>
          <p class="auth-note">This app stores data separately for <code>file:///</code> and <code>http://localhost</code>. Direct file access has been blocked to avoid split data.</p>
          <p class="auth-defaults"><strong>Recommended URL:</strong> <a href="${localhostUrl}" class="auth-app-link">${localhostUrl}</a></p>
          <p class="auth-note">Use the Shaker desktop shortcut if available, or start the local server from the project folder with:</p>
          <pre class="auth-defaults">${WINDOWS_POWERSHELL} -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\start-localhost.ps1 -Port ${LOCALHOST_PORT}</pre>
          <div class="auth-actions">
            <a href="${localhostUrl}" class="btn btn-primary auth-app-link">Open Localhost</a>
          </div>
        </section>
      </main>
    `;

    return true;
  }

  global.SHAKER_LOCALHOST_PORT = LOCALHOST_PORT;
  global.SHAKER_LOCALHOST_URL = getLocalhostUrl();
  global.SHAKER_POWERSHELL_PATH = WINDOWS_POWERSHELL;
  global.shouldBlockDirectFileAccess = isDirectFileAccess();
  global.renderLocalhostRequiredNotice = renderLocalhostRequiredNotice;
})(window);
