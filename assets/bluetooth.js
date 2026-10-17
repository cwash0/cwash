(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createLaundryBluetooth = factory;
})(typeof window !== "undefined" ? window : globalThis, function createLaundryBluetooth({ bluetooth, onDisconnect = () => {}, onDiagnostic = () => {}, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), replayCapturedSecure = false }) {
  const SERVICE = "569a1101-b87f-490c-92cb-11ba5ea5167c";
  const RX = "569a2000-b87f-490c-92cb-11ba5ea5167c";
  const TX = "569a2001-b87f-490c-92cb-11ba5ea5167c";
  const OCCUPANCY = "00002a37-0000-1000-8000-00805f9b34fb";
  const HEART_RATE = "0000180d-0000-1000-8000-00805f9b34fb";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // One captured Boulevard B Washer 2 Standard Eco packet. It is sequence-bound,
  // so this experiment must never send it when the controller's counter differs.
  const capturedSecureReplay = Object.freeze({
    bluetoothName: "AW88T7FE96R1",
    cycleKey: "standardEco",
    firmwareVersion: "[VERSION:2.0.0]",
    currentSequence: 115,
    chunks: [
      "aa00000074415738385437464539365231010300",
      "01000000320000000000000000eaa1273977628e",
      "06d2110d33231c5275279f31ca68234c123e05c9",
      "4c3e8f12da2038bbf8dec8c2edb756f38ea8fbf0",
      "317016c9b3823306d733dc978fa5bb5e0b"
    ]
  });
  let active = null, generation = 0, busy = false, capturedSecureAttempted = false;

  function diagnostic(event) {
    try { onDiagnostic({ at: new Date().toISOString(), ...event }); } catch { /* Logging must never interrupt Bluetooth. */ }
  }

  function isConnected() { return Boolean(active?.device.gatt?.connected && active.tx); }

  function release(session) {
    if (!session) return;
    session.device.removeEventListener("gattserverdisconnected", session.disconnected);
    session.rx?.removeEventListener("characteristicvaluechanged", session.notify);
    if (session.device.gatt?.connected) session.device.gatt.disconnect();
  }

  function disconnect() {
    generation++;
    const previous = active;
    active = null;
    release(previous);
  }

  function ensureCurrent(session, version) {
    if (version !== generation || active !== session || !session.device.gatt.connected) {
      throw new Error("Connection ended. Reconnect to your machine.");
    }
  }

  async function occupied(session) {
    try {
      let characteristic;
      try { characteristic = await session.service.getCharacteristic(OCCUPANCY); }
      catch { characteristic = await (await session.server.getPrimaryService(HEART_RATE)).getCharacteristic(OCCUPANCY); }
      const value = await characteristic.readValue();
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const text = decoder.decode(bytes).replace(/\0/g, "").trim();
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return text === "1120" || hex === "1120";
    } catch {
      // Older controllers do not expose an occupancy characteristic.
      return false;
    }
  }

  async function connect(machine) {
    if (busy) throw new Error("A Bluetooth operation is already in progress.");
    if (!bluetooth) throw new Error("Bluetooth is unavailable in this browser.");
    disconnect();
    const version = generation;
    busy = true;
    let session;
    try {
      const device = await bluetooth.requestDevice({ filters: [{ name: machine.bluetoothName }], optionalServices: [SERVICE, HEART_RATE] });
      if (version !== generation) throw new Error("Connection cancelled.");
      if (String(device.name || "").trim().toUpperCase() !== machine.bluetoothName.trim().toUpperCase()) {
        throw new Error("Choose the Bluetooth device for the selected machine.");
      }
      session = { device, machine, response: "", tx: null, rx: null };
      session.disconnected = () => {
        if (active !== session) return;
        disconnect();
        onDisconnect();
      };
      session.notify = (event) => {
        const value = event.target.value;
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        const message = decoder.decode(bytes);
        session.response = (session.response + message).slice(-4096);
        if (replayCapturedSecure && session.machine.bluetoothName === capturedSecureReplay.bluetoothName) {
          diagnostic({ type: "rx", text: message, hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") });
        }
      };
      active = session;
      device.addEventListener("gattserverdisconnected", session.disconnected);
      session.server = await device.gatt.connect();
      ensureCurrent(session, version);
      session.service = await session.server.getPrimaryService(SERVICE);
      ensureCurrent(session, version);
      session.tx = await session.service.getCharacteristic(TX);
      const inUse = await occupied(session);
      ensureCurrent(session, version);
      if (inUse) disconnect();
      return { occupied: inUse };
    } catch (error) {
      if (active === session) disconnect();
      else release(session);
      throw error;
    } finally { busy = false; }
  }

  async function write(session, text) {
    const bytes = encoder.encode(text);
    if (typeof session.tx.writeValueWithoutResponse === "function") await session.tx.writeValueWithoutResponse(bytes);
    else if (typeof session.tx.writeValueWithResponse === "function") await session.tx.writeValueWithResponse(bytes);
    else await session.tx.writeValue(bytes);
  }

  async function requireCapturedReply(session, version, command, expected) {
    ensureCurrent(session, version);
    session.response = "";
    diagnostic({ type: "tx", text: command });
    await write(session, command);
    await pause(1000);
    ensureCurrent(session, version);
    const response = session.response.toUpperCase();
    diagnostic({ type: "reply", text: session.response });
    if (response.includes("ERROR")) throw new Error(`Washer rejected ${command}. No secure packet was sent.`);
    if (!response.includes(expected)) throw new Error(`No ${expected} reply from the washer. No secure packet was sent.`);
    return response;
  }

  async function startCapturedSecure(session, version) {
    if (!session.rx) throw new Error("Notifications are required for the captured secure test. No packet was sent.");
    if (typeof session.tx.writeValueWithoutResponse !== "function") {
      throw new Error("This browser cannot send the captured write-command format. No packet was sent.");
    }
    await requireCapturedReply(session, version, "[VERSION]", capturedSecureReplay.firmwareVersion);
    const reply = await requireCapturedReply(session, version, "[GET:SEQ]", "[ACK:SEQ:");
    const match = reply.match(/\[ACK:SEQ:(\d+)\]/);
    if (!match) throw new Error("The washer did not return a valid sequence. No secure packet was sent.");
    const currentSequence = Number(match[1]);
    if (currentSequence !== capturedSecureReplay.currentSequence) {
      throw new Error(`Captured packet requires sequence ${capturedSecureReplay.currentSequence}; washer returned ${currentSequence}. No secure packet was sent.`);
    }
    if (capturedSecureAttempted) {
      throw new Error("This captured packet was already sent in this page. Check the washer before any further test.");
    }

    session.response = "";
    capturedSecureAttempted = true;
    for (const hex of capturedSecureReplay.chunks) {
      ensureCurrent(session, version);
      const bytes = Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16));
      await session.tx.writeValueWithoutResponse(bytes);
    }
    diagnostic({ type: "secure_packet_sent", text: "Five captured chunks sent; payload omitted from diagnostics" });
    await pause(1000);
    ensureCurrent(session, version);
    const response = session.response.toUpperCase();
    diagnostic({ type: "reply", text: session.response });
    if (response.includes("ERROR")) throw new Error("The washer rejected the captured secure packet.");
    if (!response.includes("[ACK:SEC]")) throw new Error("No secure acknowledgement. Check the washer before trying anything else.");
    return { acknowledged: true, captureReplay: true };
  }

  async function start(cycleKey) {
    if (busy) throw new Error("A Bluetooth operation is already in progress.");
    if (!isConnected()) throw new Error("Connect to the machine first.");
    const session = active;
    const cycle = session.machine.cycles.find((entry) => entry.key === cycleKey);
    if (!cycle?.command) throw new Error("This cycle is unavailable.");
    const version = generation;
    busy = true;
    try {
      if (await occupied(session)) throw new Error("This machine is in use. Choose another machine or wait for it to finish.");
      ensureCurrent(session, version);
      try {
        session.rx = await session.service.getCharacteristic(RX);
        session.rx.addEventListener("characteristicvaluechanged", session.notify);
        await session.rx.startNotifications();
      } catch {
        session.rx?.removeEventListener("characteristicvaluechanged", session.notify);
        session.rx = null;
      }
      if (replayCapturedSecure && session.machine.bluetoothName === capturedSecureReplay.bluetoothName && cycleKey === capturedSecureReplay.cycleKey) {
        return await startCapturedSecure(session, version);
      }
      let acknowledged = false;
      // Preserve the controller's established handshake and timing.
      for (const [command, waitMs, ack] of [
        ["[HANDSHAKE:ENABLE]", 1000, "[ACK:HANDSHAKE]"],
        [cycle.command, 1000, "[ACK:ACTIVATE]"],
        ["[EXEC]", 2000, "[ACK:EXEC]"]
      ]) {
        ensureCurrent(session, version);
        session.response = "";
        await write(session, command);
        await pause(waitMs);
        const response = session.response.toUpperCase();
        if (response.includes("ERROR")) throw new Error("The machine could not accept the cycle. Check the machine before trying again.");
        acknowledged = response.includes(ack);
      }
      return { acknowledged };
    } finally {
      disconnect();
      busy = false;
    }
  }

  return Object.freeze({ connect, disconnect, start, isConnected, isBusy: () => busy });
});
