(() => {
  const store = window.CircuitWash;
  const byId = (id) => document.getElementById(id);
  const picker = byId("machinePicker");
  const connectButton = byId("connectBtn");
  const cycleButtons = byId("machineButtons");
  const capturedSecureTest = new URLSearchParams(location.search).get("secureReplay") === "1";
  let site, machine, busy = false, diagnosticAttempt = null;
  const controller = window.createLaundryBluetooth({
    bluetooth: navigator.bluetooth,
    replayCapturedSecure: capturedSecureTest,
    onDiagnostic: (event) => {
      if (diagnosticAttempt && diagnosticAttempt.events.length < 100) diagnosticAttempt.events.push(event);
    },
    onDisconnect: () => {
      if (!busy) setState("ready", "Connection ended");
      updateControls();
    }
  });

  function setState(state, title, hint = "") {
    byId("connectionPanel").dataset.state = state;
    byId("connectionTitle").textContent = title;
    byId("connectionHint").textContent = hint;
    byId("connectionHint").hidden = !hint;
    updateControls();
  }

  function updateControls() {
    const connected = controller.isConnected();
    connectButton.disabled = busy || !machine;
    connectButton.hidden = connected && !busy;
    connectButton.textContent = busy ? "Please wait…" : "Connect →";
    byId("machinePickerTrigger").disabled = busy;
    byId("connectionDot").classList.toggle("connected", connected);
    cycleButtons.querySelectorAll("button").forEach((button) => { button.disabled = busy || !connected; });
  }

  function selectMachine(next) {
    if (busy) return;
    controller.disconnect();
    machine = next;
    if (picker.open) picker.close();
    byId("machineName").textContent = machine.name;
    byId("machineId").textContent = machine.bluetoothName;
    byId("machineIcon").src = `assets/${machine.type === "dryer" ? "dryer" : "washer"}.svg`;
    cycleButtons.replaceChildren();
    machine.cycles.forEach((cycle) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cycle-button";
      const label = document.createElement("strong");
      label.textContent = cycle.label;
      const arrow = document.createElement("span");
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      button.append(label, arrow);
      button.setAttribute("aria-label", `Start ${cycle.label} on ${machine.name}`);
      button.addEventListener("click", () => startCycle(cycle));
      cycleButtons.append(button);
    });
    setState("ready", "Ready to connect", capturedSecureTest && machine.bluetoothName === "AW88T7FE96R1"
      ? "Captured secure test: Washer 2 Standard Eco only. The packet is sent only if the sequence is still 115."
      : "");
  }

  function openPicker() {
    if (busy || !site) return;
    const list = byId("machinePickerList");
    list.replaceChildren();
    site.machines.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "machine-option";
      button.setAttribute("aria-pressed", String(entry === machine));
      const icon = document.createElement("img");
      icon.src = `assets/${entry.type === "dryer" ? "dryer" : "washer"}.svg`;
      icon.alt = "";
      const name = document.createElement("strong");
      name.textContent = entry.name;
      button.append(icon, name);
      button.addEventListener("click", () => selectMachine(entry));
      list.append(button);
    });
    picker.showModal();
  }

  async function connect() {
    if (busy || !machine) return;
    if (!window.isSecureContext) {
      setState("error", "HTTPS required", "Open this page over HTTPS to connect.");
      return;
    }
    if (!navigator.bluetooth) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      byId("bluefyLink").hidden = !ios;
      setState("error", "Bluetooth unavailable", ios
        ? "Open this page in Bluefy."
        : "Use Chrome or Edge on a Bluetooth-compatible device.");
      return;
    }
    busy = true;
    setState("connecting", `Connecting to ${machine.name}…`);
    try {
      const result = await controller.connect(machine);
      if (result.occupied) setState("warning", `${machine.name} is in use`, "Choose another machine or wait.");
      else setState("connected", `Connected to ${machine.name}`, capturedSecureTest && machine.bluetoothName === "AW88T7FE96R1"
        ? "Captured secure test is ready for Standard Eco only."
        : "");
    } catch (error) {
      const cancelled = error.name === "NotFoundError";
      setState(cancelled ? "ready" : "error", cancelled ? "Ready to connect" : "Couldn’t connect", cancelled
        ? "" : "Check Bluetooth is on and the machine is nearby.");
    } finally { busy = false; updateControls(); }
  }

  async function startCycle(cycle) {
    if (busy || !controller.isConnected()) return;
    busy = true;
    diagnosticAttempt = capturedSecureTest && machine.bluetoothName === "AW88T7FE96R1" && cycle.key === "standardEco"
      ? { id: crypto.randomUUID(), siteId: site.id, machineId: machine.id, bluetoothName: machine.bluetoothName,
        cycleKey: cycle.key, startedAt: new Date().toISOString(), events: [] }
      : null;
    setState("starting", `Starting ${machine.name}…`);
    try {
      const result = await controller.start(cycle.key);
      if (diagnosticAttempt) diagnosticAttempt.outcome = result.acknowledged ? "acknowledged" : "unconfirmed";
      if (result.captureReplay) {
        setState("warning", "Secure packet acknowledged", "Check the washer to confirm Standard Eco actually started.");
      } else {
        setState("complete", result.acknowledged ? `${machine.name} started` : "Start command sent", result.acknowledged
          ? "" : "Check the machine to confirm it started.");
      }
    } catch (error) {
      if (diagnosticAttempt) {
        diagnosticAttempt.outcome = "error";
        diagnosticAttempt.errorMessage = String(error.message || error).slice(0, 500);
      }
      setState("error", "Couldn’t confirm the start", error.message || "Check the machine before reconnecting.");
    } finally {
      if (diagnosticAttempt) {
        diagnosticAttempt.finishedAt = new Date().toISOString();
        const note = await saveDiagnostic(diagnosticAttempt);
        const hint = byId("connectionHint");
        hint.textContent = [hint.textContent, note].filter(Boolean).join(" ");
        hint.hidden = false;
        diagnosticAttempt = null;
      }
      busy = false;
      updateControls();
    }
  }

  async function saveDiagnostic(attempt) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch("/.netlify/functions/ble-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attempt), signal: abort.signal, keepalive: true
      });
      return response.status === 201 ? "Diagnostic saved to database." : "Diagnostic was not saved to database.";
    } catch { return "Diagnostic was not saved to database."; }
    finally { clearTimeout(timeout); }
  }

  async function init() {
    byId("retrySite").hidden = true;
    byId("pageStatus").hidden = false;
    byId("pageStatus").textContent = "Loading machines…";
    const queryId = new URLSearchParams(location.search).get("site");
    const id = queryId || store.savedSiteId();
    if (!id) { location.replace("index.html?change=1"); return; }
    try {
      site = await store.loadSite(id);
      if (!site) { location.replace("index.html?change=1"); return; }
      store.rememberSite(site.id);
      // Keep the site in the URL so refresh also works when storage is blocked.
      history.replaceState(null, "", `${store.activationUrl(site.id)}${capturedSecureTest ? "&secureReplay=1" : ""}`);
      byId("siteTitle").textContent = site.name;
      document.title = site.name;
      byId("pageStatus").hidden = site.machines.length > 0;
      byId("pageStatus").textContent = "No machines available. Choose another site.";
      byId("machineControls").hidden = !site.machines.length;
      if (site.machines.length) selectMachine(site.machines[0]);
    } catch {
      byId("siteTitle").textContent = "Couldn’t load your site";
      byId("pageStatus").textContent = "Check your connection and try again.";
      byId("retrySite").hidden = false;
    }
  }

  byId("machinePickerTrigger").addEventListener("click", openPicker);
  byId("closeMachinePicker").addEventListener("click", () => picker.close());
  picker.addEventListener("click", (event) => { if (event.target === picker) {
    const rect = picker.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) picker.close();
  } });
  connectButton.addEventListener("click", connect);
  byId("retrySite").addEventListener("click", init);
  window.addEventListener("pagehide", () => controller.disconnect());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && machine) setState("ready", "Ready to connect");
  });
  init();
})();
