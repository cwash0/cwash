(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createLaundryBluetooth = factory;
})(typeof window !== "undefined" ? window : globalThis, function createLaundryBluetooth({ bluetooth, onDisconnect = () => {}, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const SERVICE = "569a1101-b87f-490c-92cb-11ba5ea5167c";
  const RX = "569a2000-b87f-490c-92cb-11ba5ea5167c";
  const TX = "569a2001-b87f-490c-92cb-11ba5ea5167c";
  const OCCUPANCY = "00002a37-0000-1000-8000-00805f9b34fb";
  const HEART_RATE = "0000180d-0000-1000-8000-00805f9b34fb";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let active = null, generation = 0, busy = false;

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
        session.response = (session.response + decoder.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))).slice(-4096);
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
