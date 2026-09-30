(() => {
  const store = window.CircuitWash;
  const byId = (id) => document.getElementById(id);
  const picker = byId("machinePicker");
  const connectButton = byId("connectBtn");
  const cycleButtons = byId("machineButtons");
  let site, machine, busy = false;
  const controller = window.createLaundryBluetooth({
    bluetooth: navigator.bluetooth,
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
    setState("ready", "Ready to connect");
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
      else setState("connected", `Connected to ${machine.name}`);
    } catch (error) {
      const cancelled = error.name === "NotFoundError";
      setState(cancelled ? "ready" : "error", cancelled ? "Ready to connect" : "Couldn’t connect", cancelled
        ? "" : "Check Bluetooth is on and the machine is nearby.");
    } finally { busy = false; updateControls(); }
  }

  async function startCycle(cycle) {
    if (busy || !controller.isConnected()) return;
    busy = true;
    setState("starting", `Starting ${machine.name}…`);
    try {
      const result = await controller.start(cycle.key);
      setState("complete", result.acknowledged ? `${machine.name} started` : "Start command sent", result.acknowledged
        ? "" : "Check the machine to confirm it started.");
    } catch (error) {
      setState("error", "Couldn’t confirm the start", error.message || "Check the machine before reconnecting.");
    } finally { busy = false; updateControls(); }
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
      history.replaceState(null, "", store.activationUrl(site.id));
      byId("siteTitle").textContent = site.name;
      byId("siteAddress").textContent = site.address;
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
