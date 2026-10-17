(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoulevardReplayCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const SNOOP_EPOCH_MICROS = 0x00dcddb30f2f8000n;

  function ascii(bytes) {
    return decoder.decode(bytes);
  }

  function parseBtsnoop(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 16 || ascii(bytes.subarray(0, 8)) !== "btsnoop\0" || view.getUint32(8) !== 1 || view.getUint32(12) !== 1002) {
      throw new Error("Choose an Android HCI btsnoop log (version 1, H4 format).");
    }

    const events = [];
    const fragments = new Map();
    let offset = 16;
    let recordIndex = 0;
    while (offset + 24 <= bytes.length) {
      const length = view.getUint32(offset + 4);
      if (length > bytes.length - offset - 24) throw new Error("Truncated btsnoop record.");
      const flags = view.getUint32(offset + 8);
      const rawTime = view.getBigUint64(offset + 16);
      const atMs = Number((rawTime - SNOOP_EPOCH_MICROS) / 1000n);
      const packet = bytes.subarray(offset + 24, offset + 24 + length);
      offset += 24 + length;
      recordIndex++;
      if (packet.length < 9 || packet[0] !== 2) continue;

      const aclHeader = packet[1] | (packet[2] << 8);
      const connectionHandle = aclHeader & 0x0fff;
      const boundary = aclHeader >>> 12 & 3;
      const aclLength = packet[3] | (packet[4] << 8);
      if (aclLength > packet.length - 5) continue;
      const payload = packet.subarray(5, 5 + aclLength);
      const direction = flags & 1 ? "in" : "out";
      const fragmentKey = `${direction}:${connectionHandle}`;

      function emitL2cap(frame, startRecord, startTime) {
        if (frame.length < 4) return;
        const l2Length = frame[0] | frame[1] << 8;
        const channel = frame[2] | frame[3] << 8;
        if (channel !== 4 || l2Length + 4 > frame.length) return;
        const att = frame.subarray(4, 4 + l2Length);
        const opcode = att[0];
        if (![0x12, 0x52, 0x1b, 0x1d, 0x0b].includes(opcode)) return;
        const hasHandle = opcode !== 0x0b;
        if (att.length < (hasHandle ? 3 : 1)) return;
        const attributeHandle = hasHandle ? att[1] | att[2] << 8 : null;
        events.push({ recordIndex: startRecord, atMs: startTime, direction, connectionHandle,
          opcode, attributeHandle, value: att.slice(hasHandle ? 3 : 1) });
      }

      if (boundary === 1) {
        const pending = fragments.get(fragmentKey);
        if (!pending) continue;
        pending.parts.push(payload);
        pending.size += payload.length;
        if (pending.size >= pending.expected) {
          const frame = new Uint8Array(pending.size);
          let at = 0;
          for (const part of pending.parts) { frame.set(part, at); at += part.length; }
          emitL2cap(frame, pending.recordIndex, pending.atMs);
          fragments.delete(fragmentKey);
        }
      } else if (payload.length >= 4) {
        const expected = 4 + (payload[0] | payload[1] << 8);
        if (expected > 65539) continue;
        if (payload.length >= expected) emitL2cap(payload, recordIndex, atMs);
        else fragments.set(fragmentKey, { expected, size: payload.length, parts: [payload], recordIndex, atMs });
      }
    }
    return events;
  }

  function findSecureCaptures(events) {
    const captures = [];
    for (let i = 0; i < events.length; i++) {
      const request = events[i];
      if (request.direction !== "out" || ascii(request.value) !== "[GET:SEQ]") continue;
      let ackIndex = -1;
      let currentSequence;
      for (let j = i + 1; j < Math.min(events.length, i + 80); j++) {
        const event = events[j];
        if (event.connectionHandle !== request.connectionHandle) continue;
        if (event.direction === "out" && ascii(event.value) === "[GET:SEQ]") break;
        const match = event.direction === "in" && ascii(event.value).match(/\[ACK:SEQ:(\d+)\]/);
        if (match) { ackIndex = j; currentSequence = Number(match[1]); break; }
      }
      if (ackIndex < 0) continue;

      const writes = [];
      let secureAck = false;
      for (let j = ackIndex + 1; j < Math.min(events.length, ackIndex + 80); j++) {
        const event = events[j];
        if (event.connectionHandle !== request.connectionHandle) continue;
        if (event.direction === "in" && ascii(event.value).includes("[ACK:SEC]")) { secureAck = true; break; }
        if (event.direction !== "out") continue;
        if (ascii(event.value) === "[GET:SEQ]") break;
        if (event.opcode === 0x52 || event.opcode === 0x12) writes.push(event);
      }
      if (!secureAck || writes.length === 0) continue;
      const totalLength = writes.reduce((n, e) => n + e.value.length, 0);
      if (totalLength !== 97) continue;
      const packet = new Uint8Array(totalLength);
      let at = 0;
      for (const write of writes) { packet.set(write.value, at); at += write.value.length; }
      if (packet[0] !== 0xaa) continue;
      const identifier = ascii(packet.subarray(5, 17));
      if (!/^AW[A-Z0-9]{10}$/.test(identifier)) continue;
      const packetSequence = new DataView(packet.buffer).getUint32(1, false);

      let preludeStart = i;
      for (let j = i - 1; j >= Math.max(0, i - 80); j--) {
        const event = events[j];
        if (event.connectionHandle !== request.connectionHandle || event.direction !== "out") continue;
        if (ascii(event.value) === "[VERSION]") { preludeStart = j; break; }
        if (ascii(event.value) === "[GET:SEQ]") break;
      }
      const prelude = events.slice(preludeStart, i + 1).filter(e =>
        e.connectionHandle === request.connectionHandle && e.direction === "out" &&
        (e.opcode === 0x52 || e.opcode === 0x12));
      captures.push({ identifier, currentSequence, packetSequence,
        prelude: prelude.map(e => e.value.slice()), preludeOpcodes: prelude.map(e => e.opcode),
        preludeDelaysMs: prelude.map((e, index) => index ? Math.max(0, e.atMs - prelude[index - 1].atMs) : 0),
        chunks: writes.map(e => e.value.slice()), writeOpcodes: writes.map(e => e.opcode),
        interChunkMs: writes.map((e, index) => index ? Math.max(0, e.atMs - writes[index - 1].atMs) : 0),
        atMs: writes[0].atMs, secureAck, packet });
    }
    return captures;
  }

  function incrementPacketCounter(capture) {
    const result = capture.packet.slice();
    const view = new DataView(result.buffer);
    const original = view.getUint32(1, false);
    if (original === 0xffffffff) throw new Error("Captured counter cannot be incremented.");
    view.setUint32(1, original + 1, false);
    const chunks = [];
    let at = 0;
    for (const chunk of capture.chunks) {
      chunks.push(result.slice(at, at + chunk.length));
      at += chunk.length;
    }
    return { packet: result, chunks, original, modified: original + 1 };
  }

  return { parseBtsnoop, findSecureCaptures, incrementPacketCounter, ascii, encoder };
});
