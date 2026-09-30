(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else {
    const scriptUrl = document.currentScript.src;
    root.CircuitWash = factory({
      storage: () => root.localStorage,
      loadJson: async (file) => {
        const response = await fetch(new URL(`data/${file}`, scriptUrl));
        if (!response.ok) throw new Error("Site data could not be loaded.");
        return response.json();
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis, function createSiteStore({ storage, loadJson }) {
  const storageKey = "circuitWash.selectedSite";
  let catalogPromise;
  const shards = new Map();

  function normalize(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function loadCatalog() {
    if (!catalogPromise) catalogPromise = loadJson("catalog.json").then((sites) => {
      if (!Array.isArray(sites)) throw new Error("Invalid site catalog.");
      return sites;
    }).catch((error) => { catalogPromise = null; throw error; });
    return catalogPromise;
  }

  function search(sites, query) {
    const term = normalize(query);
    if (term.length < 2) return [];
    const words = term.split(/\s+/);
    const compact = term.replace(/ /g, "");
    return sites.filter((site) => {
      const text = normalize(`${site.name} ${site.address} ${site.id}`);
      return words.every((word) => text.includes(word)) || text.replace(/ /g, "").includes(compact);
    }).sort((a, b) => Number(normalize(b.name).startsWith(term)) - Number(normalize(a.name).startsWith(term))
      || a.name.localeCompare(b.name));
  }

  function savedSiteId() {
    try { return String(storage().getItem(storageKey) || ""); } catch { return ""; }
  }

  function rememberSite(id) {
    try { storage().setItem(storageKey, id); return true; } catch { return false; }
  }

  async function loadSite(id) {
    const site = (await loadCatalog()).find((entry) => entry.id === id);
    if (!site) return null;
    if (!shards.has(site.file)) shards.set(site.file, loadJson(site.file).catch((error) => {
      shards.delete(site.file);
      throw error;
    }));
    const data = await shards.get(site.file);
    if (!Array.isArray(data[site.id])) throw new Error("Site machines could not be loaded.");
    return { ...site, machines: data[site.id] };
  }

  function activationUrl(id) { return `activate.html?site=${encodeURIComponent(id)}`; }

  return Object.freeze({ loadCatalog, search, savedSiteId, rememberSite, loadSite, activationUrl });
});
