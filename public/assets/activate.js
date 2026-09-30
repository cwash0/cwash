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
      if (!busy) setState("ready", "Connection ended", "Reconnect when you’re ready to start a cycle.");
      updateControls();
    }
  });

  function setState(state, title, hint) {
    byId("connectionPanel").dataset.state = state;
    byId("connectionTitle").textContent = title;
    byId("connectionHint").textContent = hint;
    updateControls();
  }

  function updateControls() {
    const connected = controller.isConnected();
    connectButton.disabled = busy || !machine;
    connectButton.hidden = connected && !busy;
    connectButton.textContent = busy ? "Please wait…" : "Connect →";
    byId("machinePickerTrigger").disabled = busy;
    byId("connectionDot").classList.toggle("connected", connected);
    byId("cycleHint").textContent = busy ? "Keep this page open while the machine connects or starts."
      : connected ? "Choose a cycle to start your machine." : "Connect to your machine to choose a cycle.";
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
    setState("ready", "Ready to connect", "Make sure you’re in the laundry room.");
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
      setState("error", "A secure connection is needed", "Open this website over HTTPS to use Bluetooth.");
      return;
    }
    if (!navigator.bluetooth) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      byId("bluefyLink").hidden = !ios;
      setState("error", "Bluetooth isn’t available here", ios
        ? "Open this page in Bluefy to connect to your machine."
        : "Open this page in a browser with Web Bluetooth, such as Chrome or Edge on a compatible device.");
      return;
    }
    busy = true;
    setState("connecting", `Connecting to ${machine.name}…`, "Choose your machine in the Bluetooth window.");
    try {
      const result = await controller.connect(machine);
      if (result.occupied) setState("warning", `${machine.name} is in use`, "Choose another machine or wait for this cycle to finish.");
      else setState("connected", `Connected to ${machine.name}`, "You’re ready to choose a cycle.");
    } catch (error) {
      const cancelled = error.name === "NotFoundError";
      setState(cancelled ? "ready" : "error", cancelled ? "Ready to connect" : "Couldn’t connect", cancelled
        ? "Make sure you’re near the machine, then try again." : "Check that the machine is nearby and Bluetooth is on, then try again.");
    } finally { busy = false; updateControls(); }
  }

  async function startCycle(cycle) {
    if (busy || !controller.isConnected()) return;
    busy = true;
    setState("starting", `Starting ${machine.name}…`, cycle.label);
    try {
      const result = await controller.start(cycle.key);
      setState("complete", result.acknowledged ? `${machine.name} started` : "Start command sent", result.acknowledged
        ? `${cycle.label}. You’re all set.` : "Check the machine to confirm the cycle has started.");
    } catch (error) {
      setState("error", "Couldn’t confirm the start", error.message || "Check your machine, then reconnect to try again.");
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
      document.title = `${site.name} | CircuitWash`;
      byId("pageStatus").hidden = site.machines.length > 0;
      byId("pageStatus").textContent = "No machines are available at this site. Choose another site to continue.";
      byId("machineControls").hidden = !site.machines.length;
      if (site.machines.length) selectMachine(site.machines[0]);
    } catch {
      byId("siteTitle").textContent = "Couldn’t load your site";
      byId("pageStatus").textContent = "Check your connection and try again, or choose another site.";
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
    if (event.persisted && machine) setState("ready", "Ready to connect", "Make sure you’re in the laundry room.");
  });
  init();
})();
