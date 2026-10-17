(function () {
  "use strict";

  const SERVICE = "569a1101-b87f-490c-92cb-11ba5ea5167c";
  const RX = "569a2000-b87f-490c-92cb-11ba5ea5167c";
  const TX = "569a2001-b87f-490c-92cb-11ba5ea5167c";
  const OCCUPANCY = "00002a37-0000-1000-8000-00805f9b34fb";
  const HEART_RATE = "0000180d-0000-1000-8000-00805f9b34fb";
  const decoder = new TextDecoder();
  const $ = (id) => document.getElementById(id);
  const state = { captures: [], device: null, server: null, service: null, tx: null, rx: null,
    response: "", pending: null, busy: false, attempted: false };

  function setStatus(message) { $("status").textContent = message; }
  function trace(message) {
    const line = `${new Date().toISOString()}  ${message}`;
    $("trace").textContent += `${line}\n`;
    $("trace").scrollTop = $("trace").scrollHeight;
    return line;
  }
  function traceIncoming(bytes, source) {
    const rawLine = trace(`RX ${source} ${BoulevardReplayCore.formatNotification(bytes)}`);
    console.debug(rawLine);
  }
  function selectedCapture() { return state.captures.find((item) => item.id === $("machine").value); }
  function updateButtons() {
    const ready = !!selectedCapture() && $("authorized").checked && !state.busy;
    const connected = !!state.device?.gatt?.connected && !!state.tx;
    $("machine").disabled = connected || state.busy || state.captures.length === 0;
    $("connect").disabled = !ready || connected || !navigator.bluetooth;
    $("disconnect").disabled = !connected || state.busy;
    $("exact").disabled = !ready || !connected || state.attempted;
    $("modified").disabled = !ready || !connected || state.attempted;
  }
  function showCapture() {
    const capture = selectedCapture();
    $("captured-sequence").textContent = capture?.capturedSequence ?? "—";
    $("packet-counter").textContent = capture?.packetCounter ?? "—";
    $("captured-at").textContent = capture?.capturedAt?.replace("T", " ").replace(".000Z", " Z") ?? "—";
    updateButtons();
  }
  function hexBytes(hex) {
    if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error("Invalid captured bytes.");
    return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
  }
  function rejectPending(error) {
    if (!state.pending) return;
    const pending = state.pending;
    state.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  function waitFor(pattern, timeoutMs = 5000) {
    if (state.pending) throw new Error("Another reply is still pending.");
    const promise = new Promise((resolve, reject) => {
      const pending = { pattern, resolve, reject, timer: null };
      pending.timer = setTimeout(() => {
        if (state.pending === pending) state.pending = null;
        reject(new Error(`No ${pattern.source} reply within ${timeoutMs / 1000} seconds. Check the machine.`));
      }, timeoutMs);
      state.pending = pending;
    });
    promise.catch(() => {});
    return promise;
  }
  function onNotification(event) {
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    traceIncoming(bytes, "notification");
    state.response = (state.response + decoder.decode(bytes)).slice(-2048);
    const messages = decoder.decode(bytes).match(/\[(?:VERSION:\d+(?:\.\d+)*|ACK:SEQ:\d+|ACK:SEC|ERROR)\]/g);
    if (messages) for (const message of messages) trace(`RX ${message.slice(0, 100)}`);
    const pending = state.pending;
    if (!pending) return;
    if (/\[ERROR/i.test(state.response)) { rejectPending(new Error("The controller reported an error. Check the machine.")); return; }
    const match = state.response.match(pending.pattern);
    if (match) {
      state.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(match);
    }
  }
  function clearConnection() {
    rejectPending(new Error("Bluetooth disconnected."));
    state.rx?.removeEventListener("characteristicvaluechanged", onNotification);
    state.device?.removeEventListener("gattserverdisconnected", onDisconnected);
    state.device = state.server = state.service = state.tx = state.rx = null;
    state.response = "";
    state.attempted = false;
    updateButtons();
  }
  function onDisconnected() {
    clearConnection();
    if (!state.busy) { trace("Connection ended."); setStatus("Disconnected."); }
  }
  function disconnect() {
    const device = state.device;
    clearConnection();
    if (device?.gatt?.connected) device.gatt.disconnect();
  }
  async function readOccupancy() {
    try {
      let characteristic;
      try { characteristic = await state.service.getCharacteristic(OCCUPANCY); }
      catch { characteristic = await (await state.server.getPrimaryService(HEART_RATE)).getCharacteristic(OCCUPANCY); }
      const value = await characteristic.readValue();
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      traceIncoming(bytes, "occupancy read");
      const text = decoder.decode(bytes).replace(/\0/g, "").trim();
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return text === "1120" || hex === "1120";
    } catch {
      trace("Occupancy characteristic unavailable; verify visually that the machine is idle.");
      return false;
    }
  }
  async function connect() {
    const capture = selectedCapture();
    if (!capture || !$("authorized").checked || state.busy) return;
    state.busy = true;
    updateButtons();
    try {
      setStatus(`Choose ${capture.name} in the Bluetooth picker…`);
      const device = await navigator.bluetooth.requestDevice({ filters: [{ name: capture.bluetoothName }], optionalServices: [SERVICE, HEART_RATE] });
      if (device.name?.toUpperCase() !== capture.bluetoothName.toUpperCase()) throw new Error("The selected Bluetooth device is not the captured machine.");
      state.device = device;
      device.addEventListener("gattserverdisconnected", onDisconnected);
      state.server = await device.gatt.connect();
      state.service = await state.server.getPrimaryService(SERVICE);
      state.tx = await state.service.getCharacteristic(TX);
      if (typeof state.tx.writeValueWithoutResponse !== "function") throw new Error("This browser cannot send the captured write-command format.");
      state.rx = await state.service.getCharacteristic(RX);
      state.rx.addEventListener("characteristicvaluechanged", onNotification);
      await state.rx.startNotifications();
      if (await readOccupancy()) throw new Error("The machine reports that it is occupied. No replay was sent.");
      trace(`Connected to ${capture.name} (${capture.cycleLabel}).`);
      setStatus("Connected. Choose one replay test.");
    } catch (error) {
      disconnect();
      trace(`Connection stopped: ${error.message}`);
      setStatus(error.message);
    } finally {
      state.busy = false;
      updateButtons();
    }
  }
  async function writeBytes(bytes, label) {
    if (!state.device?.gatt?.connected) throw new Error("Bluetooth connection ended.");
    await state.tx.writeValueWithoutResponse(bytes);
    trace(`TX ${label} (${bytes.length} bytes)`);
  }
  async function writeAndWait(bytes, label, pattern) {
    state.response = "";
    const reply = waitFor(pattern);
    try { await writeBytes(bytes, label); return await reply; }
    catch (error) { rejectPending(error); throw error; }
  }
  async function waitCapturedGap(delayMs) {
    if (!Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60000) {
      throw new Error("Captured prelude timing is missing or invalid. Refresh this page before testing.");
    }
    trace(`Waiting ${Math.round(delayMs / 1000)} seconds before the sequence request, as in the capture.`);
    const end = Date.now() + delayMs;
    while (Date.now() < end) {
      if (!state.device?.gatt?.connected || !state.tx) throw new Error("Bluetooth disconnected during the captured wait.");
      const remaining = end - Date.now();
      setStatus(`Captured prelude sent. Sequence request in ${Math.ceil(remaining / 1000)} seconds…`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining)));
    }
  }
  async function replay(mode) {
    const capture = selectedCapture();
    if (!capture || state.busy || state.attempted || !state.device?.gatt?.connected || !$("authorized").checked) return;
    state.busy = true;
    state.attempted = true;
    updateButtons();
    const modified = mode === "modified";
    try {
      const prelude = capture.prelude.map(hexBytes);
      if (prelude.length !== 3 || decoder.decode(prelude[0]) !== "[VERSION]" || decoder.decode(prelude[2]) !== "[GET:SEQ]") throw new Error("Captured prelude failed validation.");
      await writeAndWait(prelude[0], "captured version request", /\[VERSION:2\.0\.0\]/);
      await writeBytes(prelude[1], "captured 20-byte prelude");
      await waitCapturedGap(capture.preludeDelaysMs?.[2]);
      const sequenceReply = await writeAndWait(prelude[2], "captured sequence request", /\[ACK:SEQ:(\d+)\]/);
      const observedSequence = Number(sequenceReply[1]);
      const counterToSend = capture.packetCounter + (modified ? 1 : 0);
      setStatus(`Machine sequence ${observedSequence}; ${modified ? "modified" : "exact"} packet counter ${counterToSend}. Awaiting confirmation.`);
      trace(`Machine sequence ${observedSequence}; proposed packet counter ${counterToSend}.`);
      const mismatch = counterToSend !== observedSequence + 1;
      const question = `${capture.name} · ${capture.cycleLabel}\nMachine sequence: ${observedSequence}\nPacket counter to send: ${counterToSend}\n${mismatch ? "This counter does not follow the current machine sequence.\n" : ""}${modified ? "Only the counter bytes are changed; the proof remains captured and unchanged.\n" : "The binary packet is unchanged from the log.\n"}This could start the machine. Send the five captured writes now?`;
      if (!window.confirm(question)) { trace("Cancelled before binary packet."); setStatus("Cancelled. No binary packet sent."); return; }

      const originalChunks = capture.chunks.map(hexBytes);
      const total = originalChunks.reduce((n, bytes) => n + bytes.length, 0);
      if (total !== 97 || originalChunks.length !== 5) throw new Error("Captured packet failed length validation.");
      const packet = new Uint8Array(total);
      let offset = 0;
      for (const chunk of originalChunks) { packet.set(chunk, offset); offset += chunk.length; }
      if (packet[0] !== 0xaa || decoder.decode(packet.subarray(5, 17)) !== capture.bluetoothName) throw new Error("Captured packet does not identify this machine.");
      const capturedCounter = new DataView(packet.buffer).getUint32(1, false);
      if (capturedCounter !== capture.packetCounter) throw new Error("Captured counter failed validation.");
      let packetChunks = originalChunks;
      if (modified) {
        packetChunks = BoulevardReplayCore.incrementPacketCounter({ packet, chunks: originalChunks }).chunks;
      }

      state.response = "";
      const secureReply = waitFor(/\[ACK:SEC\]/, 6000);
      try {
        for (let index = 0; index < packetChunks.length; index++) {
          if (index && capture.interChunkMs[index] > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(50, capture.interChunkMs[index])));
          await writeBytes(packetChunks[index], `secure chunk ${index + 1}/5`);
        }
        await secureReply;
      } catch (error) { rejectPending(error); throw error; }
      trace(`Result: [ACK:SEC] for ${modified ? "counter +1" : "exact"} replay.`);
      setStatus("[ACK:SEC] received. Verify the physical machine state; this reply alone does not prove a cycle started.");
    } catch (error) {
      trace(`Test stopped: ${error.message}`);
      setStatus(error.message);
    } finally {
      disconnect();
      state.busy = false;
      updateButtons();
    }
  }
  async function loadCaptures() {
    try {
      const response = await fetch("boulevard-captures.json", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Local capture files could not be read.");
      state.captures = data.captures;
      $("machine").replaceChildren(...state.captures.map((capture) => {
        const option = document.createElement("option");
        option.value = capture.id;
        option.textContent = `${capture.name} · ${capture.cycleLabel}`;
        return option;
      }));
      showCapture();
      setStatus(navigator.bluetooth ? "Captures loaded. Confirm authorization, then connect." : "Captures loaded, but this browser does not support Web Bluetooth.");
      trace(`Loaded ${state.captures.length} Boulevard B Block captures. Incoming notification bytes are logged; outgoing secure payload bytes are not shown.`);
    } catch (error) {
      setStatus(error.message);
      trace(`Local capture load failed: ${error.message}`);
    }
  }

  $("machine").addEventListener("change", showCapture);
  $("authorized").addEventListener("change", updateButtons);
  $("connect").addEventListener("click", connect);
  $("disconnect").addEventListener("click", () => { disconnect(); setStatus("Disconnected."); });
  $("exact").addEventListener("click", () => replay("exact"));
  $("modified").addEventListener("click", () => replay("modified"));
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("trace").textContent); setStatus("Debug trace copied. It may contain sensitive machine replies."); }
    catch { setStatus("Clipboard unavailable. Select and copy the result text instead."); }
  });
  loadCaptures();
})();
