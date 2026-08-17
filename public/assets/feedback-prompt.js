(function () {
  const STORAGE_PREFIX = "laundryFeedbackPromptHandled:";
  const DISMISS_PREFIX = "laundryFeedbackPromptDismissed:";
  const SESSION_PREFIX = "laundryFeedbackPromptSession:";
  const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_DISMISSALS = 2;
  let promptUrl = "";
  let previewMode = false;
  let requestInFlight = false;
  let getAccessCode = () => "";

  const els = {
    prompt: null,
    close: null,
    title: null,
    stars: [],
    commentsWrap: null,
    comments: null,
    submit: null,
    skip: null,
    message: null,
  };
  let selectedRating = 0;
  let ratingSubmitted = false;
  let submitInFlight = false;

  function ensurePrompt() {
    if (els.prompt) return true;

    document.body.insertAdjacentHTML("afterbegin", `
      <div id="feedbackPrompt" class="feedback-prompt-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="feedbackPromptTitle">
        <div class="feedback-prompt-card">
          <button id="feedbackPromptClose" class="feedback-prompt-close" type="button" aria-label="Close">&times;</button>
          <h2 id="feedbackPromptTitle" class="feedback-prompt-title">How would you rate your experience?</h2>
          <div id="feedbackPromptStars" class="feedback-prompt-stars" role="radiogroup" aria-label="Rate your experience">
            <button class="feedback-prompt-star" type="button" data-rating="1" role="radio" aria-checked="false" aria-label="1 star">★</button>
            <button class="feedback-prompt-star" type="button" data-rating="2" role="radio" aria-checked="false" aria-label="2 stars">★</button>
            <button class="feedback-prompt-star" type="button" data-rating="3" role="radio" aria-checked="false" aria-label="3 stars">★</button>
            <button class="feedback-prompt-star" type="button" data-rating="4" role="radio" aria-checked="false" aria-label="4 stars">★</button>
            <button class="feedback-prompt-star" type="button" data-rating="5" role="radio" aria-checked="false" aria-label="5 stars">★</button>
          </div>
          <div id="feedbackPromptCommentsWrap" class="feedback-prompt-comments hidden">
            <textarea id="feedbackPromptComments" rows="3" maxlength="4000" placeholder="Anything you'd like to change?"></textarea>
            <div class="feedback-prompt-comment-actions">
              <button id="feedbackPromptSubmit" class="btn-primary" type="button">Send comment</button>
              <button id="feedbackPromptSkip" class="feedback-prompt-skip" type="button">Skip</button>
            </div>
          </div>
          <p id="feedbackPromptMessage" class="feedback-prompt-message" aria-live="polite"></p>
        </div>
      </div>
    `);

    els.prompt = document.getElementById("feedbackPrompt");
    els.close = document.getElementById("feedbackPromptClose");
    els.title = document.getElementById("feedbackPromptTitle");
    els.stars = Array.from(document.querySelectorAll("#feedbackPromptStars [data-rating]"));
    els.commentsWrap = document.getElementById("feedbackPromptCommentsWrap");
    els.comments = document.getElementById("feedbackPromptComments");
    els.submit = document.getElementById("feedbackPromptSubmit");
    els.skip = document.getElementById("feedbackPromptSkip");
    els.message = document.getElementById("feedbackPromptMessage");

    return Boolean(els.prompt && els.close && els.title && els.stars.length && els.commentsWrap && els.comments && els.submit && els.skip && els.message);
  }

  function storageKey(code) {
    const value = String(code || "");
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${STORAGE_PREFIX}${(hash >>> 0).toString(36)}`;
  }

  function dismissKey(code) {
    return storageKey(code).replace(STORAGE_PREFIX, DISMISS_PREFIX);
  }

  function sessionKey(code) {
    return storageKey(code).replace(STORAGE_PREFIX, SESSION_PREFIX);
  }

  function hasHandled(code) {
    if (!code) return true;
    try {
      if (localStorage.getItem(storageKey(code)) === "1") return true;
      if (sessionStorage.getItem(sessionKey(code)) === "1") return true;
      const dismissed = JSON.parse(localStorage.getItem(dismissKey(code)) || "{}");
      if (Number(dismissed.count || 0) >= MAX_DISMISSALS) return true;
      if (Number(dismissed.until || 0) > Date.now()) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function markHandled(code) {
    if (!code) return;
    try { localStorage.setItem(storageKey(code), "1"); } catch (_) {}
  }

  function markShownThisSession(code) {
    if (!code) return;
    try { sessionStorage.setItem(sessionKey(code), "1"); } catch (_) {}
  }

  function markDismissed(code) {
    if (!code) return;
    try {
      const current = JSON.parse(localStorage.getItem(dismissKey(code)) || "{}");
      const count = Math.min(MAX_DISMISSALS, Number(current.count || 0) + 1);
      localStorage.setItem(dismissKey(code), JSON.stringify({
        count,
        until: Date.now() + DISMISS_COOLDOWN_MS
      }));
    } catch (_) {}
  }

  function isPreviewUrl(url) {
    try {
      return new URL(String(url || ""), window.location.href).searchParams.get("preview") === "1";
    } catch (_) {
      return false;
    }
  }

  function show(url, { preview = false } = {}) {
    if (!ensurePrompt()) return;
    promptUrl = String(url || "");
    previewMode = Boolean(preview) || isPreviewUrl(promptUrl);
    resetForm();
    if (!previewMode) markShownThisSession(getAccessCode());
    els.prompt.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    setTimeout(() => els.close.focus(), 0);
  }

  function hide() {
    if (!els.prompt) return;
    els.prompt.classList.add("hidden");
    document.body.style.overflow = "";
    promptUrl = "";
    previewMode = false;
  }

  async function dismiss() {
    const code = getAccessCode();
    const isPreview = previewMode || isPreviewUrl(promptUrl);
    if (ratingSubmitted) {
      hide();
      return;
    }
    if (!isPreview) markDismissed(code);
    hide();
    if (!code || isPreview) return;
    try {
      await fetch("/.netlify/functions/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_prompt", code })
      });
    } catch (_) {
      // Local storage already prevents the prompt repeating on this device.
    }
  }

  function resetForm() {
    selectedRating = 0;
    ratingSubmitted = false;
    submitInFlight = false;
    els.title.textContent = "How would you rate your experience?";
    els.comments.value = "";
    els.commentsWrap.classList.add("hidden");
    els.submit.disabled = false;
    els.skip.disabled = false;
    els.submit.textContent = "Send comment";
    els.message.textContent = "";
    els.message.className = "feedback-prompt-message";
    setStars(0);
  }

  function setStars(value) {
    selectedRating = Number(value) || 0;
    els.stars.forEach((button) => {
      const active = Number(button.dataset.rating) <= selectedRating;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-checked", String(Number(button.dataset.rating) === selectedRating));
    });
  }

  function commentPromptForRating(value) {
    if (value <= 2) return "What went wrong?";
    if (value === 3) return "What could we improve?";
    return "What worked well?";
  }

  async function chooseRating(value) {
    if (submitInFlight) return;
    const previousRating = selectedRating;
    setStars(value);
    els.title.textContent = "Thanks. Anything else you'd like us to know?";
    els.comments.placeholder = commentPromptForRating(selectedRating);
    els.commentsWrap.classList.remove("hidden");
    setMessage("");

    submitInFlight = true;
    els.submit.disabled = true;
    els.skip.disabled = true;
    try {
      const code = getAccessCode();
      if (!(previewMode || isPreviewUrl(promptUrl))) {
        const token = getTokenFromPromptUrl();
        if (!token) throw new Error("Feedback is unavailable right now.");
        const res = await fetch("/.netlify/functions/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: ratingSubmitted ? "update_rating" : "submit",
            token,
            rating: selectedRating,
            recommend: recommendationForRating(selectedRating),
            comments: ""
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) throw new Error(data?.message || "Could not save rating.");
        markHandled(code);
      }
      ratingSubmitted = true;
      setTimeout(() => els.comments.focus(), 0);
    } catch (error) {
      setStars(previousRating);
      if (!previousRating) els.commentsWrap.classList.add("hidden");
      else els.comments.placeholder = commentPromptForRating(previousRating);
      setMessage(error?.message || "Could not save rating.", "bad");
    } finally {
      submitInFlight = false;
      els.submit.disabled = false;
      els.skip.disabled = false;
    }
  }

  function recommendationForRating(value) {
    if (value >= 4) return "YES";
    if (value === 3) return "MAYBE";
    return "NO";
  }

  function getTokenFromPromptUrl() {
    try {
      const url = new URL(promptUrl, window.location.href);
      return String(url.searchParams.get("token") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function setMessage(text, tone = "") {
    els.message.textContent = text;
    els.message.className = `feedback-prompt-message${tone ? ` ${tone}` : ""}`;
  }

  async function maybeShow() {
    const code = getAccessCode();
    if (!code || requestInFlight || hasHandled(code)) return;
    requestInFlight = true;
    try {
      const res = await fetch("/.netlify/functions/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_prompt", code })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok !== false && data?.eligible === true && data?.url) {
        show(data.url);
      } else if (["dismissed", "responded", "prompted"].includes(data?.reason)) {
        markHandled(code);
      }
    } catch (_) {
      // Feedback must never interfere with starting a machine.
    } finally {
      requestInFlight = false;
    }
  }

  async function submitComment() {
    if (submitInFlight) return;
    if (!selectedRating) {
      setMessage("Choose a star rating.", "bad");
      return;
    }
    if (!ratingSubmitted) {
      setMessage("Just a moment.", "bad");
      return;
    }

    submitInFlight = true;
    els.submit.disabled = true;
    els.skip.disabled = true;
    els.submit.textContent = "Sending...";
    setMessage("");

    try {
      if (!(previewMode || isPreviewUrl(promptUrl))) {
        const token = getTokenFromPromptUrl();
        if (!token) throw new Error("Feedback is unavailable right now.");
        const res = await fetch("/.netlify/functions/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_comment",
            token,
            comments: els.comments.value
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) throw new Error(data?.message || "Could not send comment.");
      }
      finishFeedback("Thanks - feedback sent.");
    } catch (error) {
      setMessage(error?.message || "Could not send comment.", "bad");
      els.submit.disabled = false;
      els.skip.disabled = false;
      els.submit.textContent = "Send comment";
      submitInFlight = false;
    }
  }

  function finishFeedback(message = "Thanks.") {
    if (!ratingSubmitted) {
      setMessage("Choose a star rating.", "bad");
      return;
    }
    els.title.textContent = "Thank you";
    els.commentsWrap.classList.add("hidden");
    setMessage(message, "ok");
    setTimeout(hide, 1200);
  }

  function init(options = {}) {
    if (typeof options.getAccessCode === "function") getAccessCode = options.getAccessCode;
    if (!ensurePrompt()) return;

    els.close.addEventListener("click", dismiss);
    els.skip.addEventListener("click", () => finishFeedback());
    els.submit.addEventListener("click", submitComment);
    els.stars.forEach((button) => {
      button.addEventListener("click", () => chooseRating(Number(button.dataset.rating)));
    });
    els.prompt.addEventListener("click", (event) => {
      if (event.target === els.prompt) dismiss();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.prompt.classList.contains("hidden")) dismiss();
    });
  }

  window.LaundryFeedbackPrompt = {
    init,
    show,
    hide,
    maybeShow,
    hasHandled,
    markHandled,
  };
})();
