(() => {
  const store = window.CircuitWash;
  const input = document.getElementById("siteSearch");
  const results = document.getElementById("siteResults");
  const status = document.getElementById("searchStatus");
  const retry = document.getElementById("retrySites");
  const savedLink = document.getElementById("savedSite");
  const savedName = document.getElementById("savedSiteName");
  const clearButton = document.getElementById("clearSearch");
  let sites = [], matches = [], activeIndex = -1;

  function select(site) {
    if (!site) return;
    store.rememberSite(site.id);
    location.assign(store.activationUrl(site.id));
  }

  function setActive(index) {
    activeIndex = index;
    Array.from(results.children).forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === index));
      if (i === index) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
    if (index < 0) input.removeAttribute("aria-activedescendant");
  }

  function render() {
    clearButton.hidden = !input.value;
    const allMatches = store.search(sites, input.value);
    matches = allMatches.slice(0, 40);
    results.replaceChildren();
    setActive(-1);
    results.hidden = !matches.length;
    input.setAttribute("aria-expanded", String(matches.length > 0));
    const hasQuery = input.value.trim().length >= 2;
    status.classList.toggle("visually-hidden", !hasQuery || (matches.length > 0 && allMatches.length <= 40));
    status.textContent = !hasQuery ? "Enter at least 2 characters."
      : !matches.length ? "No matching sites."
      : allMatches.length > 40 ? `Showing 40 of ${allMatches.length} sites. Keep typing to narrow the results.`
      : `${matches.length} ${matches.length === 1 ? "site" : "sites"} found.`;
    matches.forEach((site, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "site-result";
      option.id = `site-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = site.name;
      copy.append(name);
      if (site.address) {
        const address = document.createElement("small");
        address.textContent = site.address;
        copy.append(address);
      }
      const arrow = document.createElement("span");
      arrow.className = "result-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      option.append(copy, arrow);
      option.addEventListener("click", () => select(site));
      results.append(option);
    });
  }

  input.addEventListener("input", render);
  clearButton.addEventListener("click", () => {
    input.value = "";
    render();
    input.focus();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      setActive(-1);
    } else if (matches.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
      setActive(event.key === "ArrowDown" ? Math.min(activeIndex + 1, matches.length - 1) : Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter" && !results.hidden) {
      event.preventDefault();
      if (activeIndex >= 0) select(matches[activeIndex]);
      else if (matches.length === 1) select(matches[0]);
    }
  });

  async function init() {
    retry.hidden = true;
    status.classList.remove("visually-hidden");
    status.textContent = "Loading sites…";
    try {
      sites = await store.loadCatalog();
      const saved = sites.find((site) => site.id === store.savedSiteId());
      if (saved && new URLSearchParams(location.search).get("change") !== "1") {
        location.replace(store.activationUrl(saved.id));
        return;
      }
      if (saved) {
        savedName.textContent = saved.name;
        savedLink.href = store.activationUrl(saved.id);
        savedLink.hidden = false;
      }
      input.disabled = false;
      render();
    } catch {
      status.textContent = "Couldn’t load sites.";
      retry.hidden = false;
    }
  }
  retry.addEventListener("click", init);
  window.addEventListener("pageshow", (event) => { if (event.persisted) init(); });
  init();
})();
