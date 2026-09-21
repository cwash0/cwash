const AC_DETECT_LABELS = Object.freeze({
  0: "NONE",
  1: "OCCUPIED_HIGH",
  2: "END_HIGH_PULSE",
  3: "OCCUPIED_HIGH"
});

const WASHER_CYCLE_PULSES = Object.freeze({
  standardEco: 1,
  extraWash: 2,
  extraWashRinse: 3,
  standard: 1,
  extra: 2,
  extraRinse: 3,
  full: 3
});

const DEFAULT_WASHER_CYCLES = Object.freeze({
  standardEco: "Standard Eco",
  extraWash: "Extra Wash",
  extraWashRinse: "Extra Wash + Rinse"
});

function hex(value, width) {
  return Math.trunc(Number(value)).toString(16).toUpperCase().padStart(width, "0");
}

function machineNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function getMachineCycles(machine) {
  const cycles = machine?.cycles && typeof machine.cycles === "object" && !Array.isArray(machine.cycles)
    ? machine.cycles
    : {};
  if (
    String(machine?.type || "").toLowerCase().trim() === "washer" &&
    Object.keys(cycles).length === 1 &&
    cycles.full
  ) {
    return DEFAULT_WASHER_CYCLES;
  }
  return cycles;
}

function constructBleCommand({ secret, pulses, onMs = 50, offMs = 50, detectMode = 3, relay = 1 }) {
  const password = String(secret || "").trim();
  if (!password) return "";
  const mode = machineNumber(detectMode, 3);
  const feedback = AC_DETECT_LABELS[mode] || "NONE";
  return [
    "[ACTIVATE",
    hex(machineNumber(relay, 1), 2),
    "PULSE",
    feedback,
    hex(0, 8),
    hex(machineNumber(onMs, 50), 8),
    hex(machineNumber(offMs, 50), 8),
    hex(machineNumber(pulses, 0), 4),
    `${password}]`
  ].join(":");
}

function getActivateCommand(machine, cycleKey) {
  const type = String(machine?.type || "").toLowerCase().trim();
  const key = String(cycleKey || "").trim();
  if (!Object.prototype.hasOwnProperty.call(getMachineCycles(machine), key)) return "";

  let pulses = 0;
  if (type === "washer") pulses = WASHER_CYCLE_PULSES[key] || 0;
  else if (type === "dryer" && key === "full") pulses = 4;
  else if (type === "dryer" && key === "min15") pulses = 1;
  if (!pulses) return "";

  return constructBleCommand({
    secret: machine?.password,
    pulses,
    onMs: machineNumber(machine?.pulse_duration, 50),
    offMs: machineNumber(machine?.pulse_pause, 50),
    detectMode: machineNumber(machine?.ac_detect_mode, 3)
  });
}

module.exports = {
  AC_DETECT_LABELS,
  constructBleCommand,
  getActivateCommand
};
