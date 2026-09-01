(function exposeSiteSelector() {
  function create(options = {}) {
    const input = options.input;
    const results = options.results;
    const spinner = options.spinner || null;
    if (!input || !results) throw new Error("Site selector requires input and results elements.");

    let sites = [];
    let highlightedIndex = -1;
    let requestId = 0;

    function hide() {
      results.classList.add("hidden");
      input.setAttribute("aria-expanded", "false");
      highlightedIndex = -1;
    }

    function reset() {
      requestId += 1;
      input.value = "";
      results.replaceChildren();
      hide();
      setLoading(false);
    }

    function render(nextSites, statusText = "") {
      sites = Array.isArray(nextSites) ? nextSites : [];
      highlightedIndex = -1;
      results.replaceChildren();

      if (statusText) {
        const status = document.createElement("div");
        status.className = "result-status";
        status.textContent = statusText;
        results.appendChild(status);
      } else {
        sites.forEach((site, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "result-button";
          button.setAttribute("role", "option");
          button.dataset.index = String(index);
          const selected = String(options.currentSiteId?.() || "") === String(site.id || "");
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-selected", String(selected));

          const name = document.createElement("span");
          name.className = "result-name";
          name.textContent = String(site.name || "Site");
          button.appendChild(name);

          const addressText = options.formatAddress ? options.formatAddress(site.address) : String(site.address || "").trim();
          if (addressText) {
            const address = document.createElement("span");
            address.className = "result-address";
            address.textContent = addressText;
            button.appendChild(address);
          }

          const end = document.createElement("span");
          end.className = "result-chevron";
          end.setAttribute("aria-hidden", "true");
          end.textContent = selected ? "✓" : "›";
          button.appendChild(end);
          button.addEventListener("click", () => options.onSelect?.(site, button, { selected }));
          results.appendChild(button);
        });
      }

      results.classList.remove("hidden");
      input.setAttribute("aria-expanded", "true");
    }

    function updateHighlight() {
      const buttons = [...results.querySelectorAll(".result-button")];
      buttons.forEach((button, index) => {
        const highlighted = index === highlightedIndex;
        button.classList.toggle("highlighted", highlighted);
        if (highlighted) button.scrollIntoView({ block: "nearest" });
      });
    }

    function handleKeydown(event) {
      if (results.classList.contains("hidden")) return false;
      if (event.key === "ArrowDown") highlightedIndex = Math.min(highlightedIndex + 1, sites.length - 1);
      else if (event.key === "ArrowUp") highlightedIndex = Math.max(highlightedIndex - 1, 0);
      else if (event.key === "Enter" && highlightedIndex >= 0) {
        event.preventDefault();
        options.onSelect?.(sites[highlightedIndex], results.querySelectorAll(".result-button")[highlightedIndex], { selected: String(options.currentSiteId?.() || "") === String(sites[highlightedIndex]?.id || "") });
        return true;
      } else if (event.key === "Escape") {
        hide();
        return true;
      } else return false;
      event.preventDefault();
      updateHighlight();
      return true;
    }

    async function search(queryValue = input.value) {
      const query = String(queryValue || "").trim();
      const activeRequest = ++requestId;
      if (query.length < 2) {
        hide();
        return [];
      }
      setLoading(true);
      try {
        const response = await fetch("/.netlify/functions/public-sites", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, mode: "all" })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.message || "Could not search sites");
        if (activeRequest !== requestId) return [];
        const matches = Array.isArray(data.sites) ? data.sites : [];
        render(matches, matches.length ? "" : "No matching sites");
        return matches;
      } catch (error) {
        if (activeRequest === requestId) render([], "Could not search sites. Try again.");
        return [];
      } finally {
        if (activeRequest === requestId) setLoading(false);
      }
    }

    function setLoading(loading) {
      spinner?.classList.toggle("hidden", !loading);
      input.setAttribute("aria-busy", String(Boolean(loading)));
    }

    return Object.freeze({ hide, reset, render, search, handleKeydown, updateHighlight });
  }

  window.CircuitWashSiteSelector = Object.freeze({ create });
})();
