(() => {
  const $ = (id) => document.getElementById(id);
  const EMAIL_THEMES = {
    circuit: { preset: "circuit", primary: "#24d7f0", accent: "#102a3d", page: "#050b14", card: "#0b1726", heading: "#f4f8ff", body: "#91a3ba" },
    ocean: { preset: "ocean", primary: "#1261a0", accent: "#e8f3fb", page: "#f2f7fb", card: "#ffffff", heading: "#12324b", body: "#445f72" },
    indigo: { preset: "indigo", primary: "#5b4bba", accent: "#efedff", page: "#f5f4fb", card: "#ffffff", heading: "#29234f", body: "#59546f" },
    sunset: { preset: "sunset", primary: "#c44d2d", accent: "#fff0e8", page: "#fff7f2", card: "#ffffff", heading: "#47251c", body: "#6d554e" },
    charcoal: { preset: "charcoal", primary: "#28323c", accent: "#edf0f2", page: "#eef1f3", card: "#ffffff", heading: "#171d22", body: "#4f5c66" }
  };
  const state = {
    data: null,
    campaignId: null,
    templateId: null,
    status: "DRAFT",
    blocks: [],
    theme: cloneTheme(EMAIL_THEMES.circuit),
    selectedEmails: new Set(),
    recipientMode: "SELECTED",
    siteId: "",
    recipientPreview: [],
    customerFilter: "",
    activeInput: null,
    previewTimer: null,
    loading: false
  };

  const elements = {};
  const elementIds = [
    "emailListView","emailEditorView","reloadEmailBtn","createEmailBtn","emailDraftMetric","emailScheduledMetric","emailSentMetric","emailListMetric","emailSuppressedMetric","emailContactAdder","emailContactInput","addEmailContactsBtn","emailContactMessage","emailContactRows","emailCampaignRows","emailTemplateList","emailSuppressionRows",
    "emailBackBtn","emailEditorTitle","emailEditorStatus","emailStepDesign","emailStepRecipients","emailStepReview","emailNameInput","emailSubjectInput","emailPreheaderInput","emailIncludeUnsubscribeInput","emailVariableSelect","insertEmailVariableBtn","emailBlockList","emailThemePresets","resetEmailThemeBtn","emailPrimaryColour","emailAccentColour","emailPageColour","emailCardColour","emailHeadingColour","emailBodyColour",
    "emailSampleCustomerSelect","emailPreviewFrameWrap","emailPreviewFrame","emailTestAddress","sendEmailTestBtn","emailTestMessage","saveEmailTemplateBtn","saveEmailDraftBtn","emailDesignNextBtn",
    "emailSiteTargetWrap","emailSiteTargetSelect","emailSelectedTargetWrap","emailCustomerFilter","emailSelectVisibleBtn","emailClearSelectedBtn","emailCustomerList","emailRecipientCount","emailRecipientSummary","emailRecipientPreviewList","refreshEmailRecipientsBtn","emailRecipientMessage","saveEmailDraftRecipientsBtn","emailRecipientsNextBtn",
    "emailReviewSubject","emailReviewName","emailReviewRecipients","emailReviewAudience","emailReviewSender","emailReviewUnsubscribe","emailReviewFrame","emailScheduleInput","emailApprovalCheck","openEmailSendReviewBtn","emailSendMessage","saveEmailDraftReviewBtn",
    "emailSendOverlay","closeEmailSendConfirmBtn","cancelEmailSendConfirmBtn","emailConfirmSubject","emailConfirmRecipients","emailConfirmAudience","emailConfirmSender","emailConfirmDelivery","emailConfirmFrame","confirmEmailSendBtn","emailConfirmMessage"
  ];
  elementIds.forEach((id) => { elements[id] = $(id); });

  window.loadEmailCenter = loadEmailCenter;

  async function emailApi(action, payload = {}) {
    if (typeof api !== "function") throw new Error("Admin API unavailable.");
    return api(action, payload);
  }

  async function loadEmailCenter(force = false) {
    if (state.loading) return;
    state.loading = true;
    setListLoading();
    try {
      if (!state.data || force) state.data = await emailApi("email_data");
      renderEmailCenter();
    } catch (error) {
      elements.emailCampaignRows.innerHTML = `<tr><td colspan="8" class="muted">${escapeText(error.message)}</td></tr>`;
    } finally { state.loading = false; }
  }

  function setListLoading() {
    if (elements.emailCampaignRows) elements.emailCampaignRows.innerHTML = '<tr><td colspan="8" class="muted">Loading emails...</td></tr>';
  }

  function renderEmailCenter() {
    const summary = state.data?.summary || {};
    elements.emailDraftMetric.textContent = formatCount(summary.drafts);
    elements.emailScheduledMetric.textContent = formatCount(summary.scheduled);
    elements.emailSentMetric.textContent = formatCount(summary.sentThirtyDays);
    elements.emailListMetric.textContent = formatCount(summary.contacts);
    elements.emailSuppressedMetric.textContent = formatCount(summary.suppressed);
    renderContacts();
    renderCampaigns();
    renderTemplates();
    renderSuppressions();
    populateVariables();
    populateSampleCustomers();
    populateSiteSegments();
  }

  function renderContacts() {
    const contacts = state.data?.contacts || [];
    elements.emailContactRows.innerHTML = "";
    if (!contacts.length) {
      elements.emailContactRows.innerHTML = '<tr><td colspan="4" class="muted">No admin-added contacts yet.</td></tr>';
      return;
    }
    contacts.forEach((contact) => {
      const row = document.createElement("tr");
      appendTextCell(row, contact.email);
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `pill ${contact.suppressed ? "cancelled" : "sent"}`;
      status.textContent = contact.suppressed ? "Suppressed" : "Eligible";
      statusCell.appendChild(status); row.appendChild(statusCell);
      appendTextCell(row, formatDateTimeLocal(contact.createdAt));
      const actionCell = document.createElement("td");
      actionCell.append(makeButton("Remove", () => removeContact(contact), "danger"));
      row.appendChild(actionCell); elements.emailContactRows.appendChild(row);
    });
  }

  function renderCampaigns() {
    const campaigns = state.data?.campaigns || [];
    elements.emailCampaignRows.innerHTML = "";
    if (!campaigns.length) {
      elements.emailCampaignRows.innerHTML = '<tr><td colspan="8" class="muted">No customer emails yet.</td></tr>';
      return;
    }
    campaigns.forEach((campaign) => {
      const row = document.createElement("tr");
      if (typeof window.markTimedOutput === "function") window.markTimedOutput(row, campaign.createdAt);
      appendTextCell(row, campaign.name);
      appendTextCell(row, campaign.subject || "No subject");
      const statusCell = document.createElement("td");
      const pill = document.createElement("span"); pill.className = `pill ${campaign.status.toLowerCase()}`; pill.textContent = titleCase(campaign.status); statusCell.appendChild(pill); row.appendChild(statusCell);
      appendTextCell(row, campaign.creator || "Administrator");
      appendTextCell(row, formatDateTimeLocal(campaign.createdAt));
      appendTextCell(row, campaign.scheduledFor ? `Scheduled ${formatDateTimeLocal(campaign.scheduledFor)}` : formatDateTimeLocal(campaign.sentAt));
      appendTextCell(row, formatCount(campaign.recipientCount));
      const actionsCell = document.createElement("td"); const actions = document.createElement("div"); actions.className = "row-actions";
      if (["DRAFT","FAILED","CANCELLED"].includes(campaign.status)) actions.append(makeButton("Edit", () => openCampaign(campaign)));
      if (campaign.status === "SCHEDULED") actions.append(makeButton("Cancel schedule", () => cancelScheduled(campaign), "danger"));
      if (["DRAFT","FAILED","CANCELLED"].includes(campaign.status)) actions.append(makeButton("Delete", () => deleteDraft(campaign), "danger"));
      actionsCell.appendChild(actions); row.appendChild(actionsCell); elements.emailCampaignRows.appendChild(row);
    });
  }

  function renderTemplates() {
    elements.emailTemplateList.innerHTML = "";
    const items = [
      ...(state.data?.starters || []).map((item) => ({ ...item, starter: true, status: "STARTER" })),
      ...(state.data?.templates || [])
    ];
    if (!items.length) return elements.emailTemplateList.innerHTML = '<div class="muted">No templates yet.</div>';
    items.forEach((template) => {
      const card = document.createElement("article"); card.className = "email-template-card";
      const copy = document.createElement("div"); copy.innerHTML = `<span>${template.starter ? "Starter" : escapeText(titleCase(template.status))}</span><strong>${escapeText(template.name)}</strong><small>${escapeText(template.subject || "No subject")}</small>`;
      const actions = document.createElement("div"); actions.className = "row-actions";
      actions.append(makeButton("Use", () => createFromTemplate(template), "primary"));
      if (!template.starter) {
        actions.append(makeButton("Edit", () => openTemplateEditor(template)));
        actions.append(makeButton("Duplicate", () => duplicateTemplate(template)));
        actions.append(makeButton(template.status === "ARCHIVED" ? "Restore" : "Archive", () => setTemplateStatus(template, template.status !== "ARCHIVED")));
        actions.append(makeButton("Delete", () => deleteTemplate(template), "danger"));
      }
      card.append(copy, actions); elements.emailTemplateList.appendChild(card);
    });
  }

  function renderSuppressions() {
    elements.emailSuppressionRows.innerHTML = "";
    const suppressions = state.data?.suppressions || [];
    if (!suppressions.length) return elements.emailSuppressionRows.innerHTML = '<tr><td colspan="5" class="muted">No suppressed customers.</td></tr>';
    suppressions.forEach((item) => {
      const row = document.createElement("tr");
      appendTextCell(row, item.email); appendTextCell(row, item.reason); appendTextCell(row, titleCase(item.source)); appendTextCell(row, formatDateTimeLocal(item.createdAt));
      const cell = document.createElement("td"); cell.append(makeButton("Restore", () => restoreSuppression(item), "danger")); row.appendChild(cell); elements.emailSuppressionRows.appendChild(row);
    });
  }

  function openNewEmail() {
    state.campaignId = null; state.templateId = null; state.status = "DRAFT"; state.blocks = [newBlock("heading"), newBlock("paragraph")]; state.theme = cloneTheme(EMAIL_THEMES.circuit); state.selectedEmails.clear(); state.recipientMode = "SELECTED"; state.siteId = ""; state.recipientPreview = [];
    elements.emailNameInput.value = ""; elements.emailSubjectInput.value = ""; elements.emailPreheaderInput.value = ""; elements.emailIncludeUnsubscribeInput.checked = true; elements.emailEditorTitle.textContent = "New customer email"; elements.emailEditorStatus.textContent = "Unsaved draft";
    elements.saveEmailTemplateBtn.textContent = "Save as template";
    openEditor(); setStep("design"); syncThemeControls(); renderBlocks(); renderCustomers(); schedulePreview();
  }

  function openCampaign(campaign) {
    state.campaignId = campaign.id; state.status = campaign.status; state.blocks = clone(campaign.blocks || []); state.theme = cloneTheme(campaign.theme || EMAIL_THEMES.circuit); state.selectedEmails = new Set((campaign.recipientSnapshot || []).map((item) => item.email.toLowerCase())); state.recipientMode = campaign.recipientMode || "SELECTED"; state.siteId = campaign.recipientFilter?.siteId || ""; state.recipientPreview = campaign.recipientSnapshot || [];
    elements.emailNameInput.value = campaign.name || ""; elements.emailSubjectInput.value = campaign.subject || ""; elements.emailPreheaderInput.value = campaign.preheader || ""; elements.emailIncludeUnsubscribeInput.checked = campaign.includeUnsubscribe !== false; elements.emailEditorTitle.textContent = campaign.name || "Customer email"; elements.emailEditorStatus.textContent = `${titleCase(campaign.status)} · Updated ${formatDateTimeLocal(campaign.updatedAt)}`;
    openEditor(); setStep("design"); syncRecipientMode(); syncThemeControls(); renderBlocks(); renderCustomers(); updateRecipientPreviewUi(); schedulePreview();
  }

  function createFromTemplate(template) {
    openNewEmail(); state.blocks = clone(template.blocks || []); state.theme = cloneTheme(template.theme || EMAIL_THEMES.circuit); elements.emailNameInput.value = `${template.name} email`; elements.emailSubjectInput.value = template.subject || ""; elements.emailPreheaderInput.value = template.preheader || ""; elements.emailIncludeUnsubscribeInput.checked = template.includeUnsubscribe !== false; syncThemeControls(); renderBlocks(); schedulePreview();
  }

  function openTemplateEditor(template) {
    openNewEmail(); state.templateId = template.id; state.blocks = clone(template.blocks || []); state.theme = cloneTheme(template.theme || EMAIL_THEMES.circuit); elements.emailNameInput.value = template.name; elements.emailSubjectInput.value = template.subject || ""; elements.emailPreheaderInput.value = template.preheader || ""; elements.emailIncludeUnsubscribeInput.checked = template.includeUnsubscribe !== false; elements.emailEditorTitle.textContent = `Edit template · ${template.name}`; elements.emailEditorStatus.textContent = "Template editing mode"; elements.saveEmailTemplateBtn.textContent = "Update template"; syncThemeControls(); renderBlocks(); schedulePreview();
  }

  function openEditor() { elements.emailListView.classList.add("hidden"); elements.emailEditorView.classList.remove("hidden"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function closeEditor() { elements.emailEditorView.classList.add("hidden"); elements.emailListView.classList.remove("hidden"); state.data = null; loadEmailCenter(true); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function setStep(step) {
    document.querySelectorAll("[data-email-step]").forEach((button) => button.classList.toggle("active", button.dataset.emailStep === step));
    elements.emailStepDesign.classList.toggle("hidden", step !== "design"); elements.emailStepRecipients.classList.toggle("hidden", step !== "recipients"); elements.emailStepReview.classList.toggle("hidden", step !== "review");
    if (step === "recipients") { syncRecipientMode(); renderCustomers(); previewRecipients(); }
    if (step === "review") prepareReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function currentPayload() { return { campaignId: state.campaignId, name: elements.emailNameInput.value.trim(), subject: elements.emailSubjectInput.value.trim(), preheader: elements.emailPreheaderInput.value.trim(), includeUnsubscribe: elements.emailIncludeUnsubscribeInput.checked, theme: state.theme, blocks: state.blocks }; }

  function cloneTheme(theme) {
    if (!theme || theme.preset === "circuit") return { ...EMAIL_THEMES.circuit };
    return { ...EMAIL_THEMES.circuit, ...(theme || {}) };
  }

  function applyThemePreset(name) {
    if (!EMAIL_THEMES[name]) return;
    state.theme = cloneTheme(EMAIL_THEMES[name]);
    syncThemeControls(); schedulePreview();
  }

  function syncThemeControls() {
    const fields = {
      primary: elements.emailPrimaryColour,
      accent: elements.emailAccentColour,
      page: elements.emailPageColour,
      card: elements.emailCardColour,
      heading: elements.emailHeadingColour,
      body: elements.emailBodyColour
    };
    Object.entries(fields).forEach(([key, input]) => { if (input) input.value = state.theme[key] || EMAIL_THEMES.circuit[key]; });
    document.querySelectorAll("[data-email-theme]").forEach((button) => button.classList.toggle("active", button.dataset.emailTheme === state.theme.preset));
  }

  function updateCustomTheme(key, value) {
    state.theme = { ...state.theme, preset: "custom", [key]: value };
    syncThemeControls(); schedulePreview();
  }

  async function saveDraft(showSuccess = true) {
    if (!elements.emailNameInput.value.trim()) { setMessage(elements.emailTestMessage, "Add an internal email name first.", "bad"); elements.emailNameInput.focus(); return null; }
    const buttons = [elements.saveEmailDraftBtn,elements.saveEmailDraftRecipientsBtn,elements.saveEmailDraftReviewBtn].filter(Boolean); buttons.forEach((button) => button.disabled = true);
    try {
      const result = await emailApi("email_save_draft", currentPayload()); state.campaignId = result.campaign.id; state.status = result.campaign.status; elements.emailEditorTitle.textContent = result.campaign.name; elements.emailEditorStatus.textContent = `Draft saved · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      if (showSuccess) setMessage(elements.emailTestMessage, "Draft saved.", "ok"); return result.campaign;
    } catch (error) { setMessage(elements.emailTestMessage, error.message, "bad"); return null; }
    finally { buttons.forEach((button) => button.disabled = false); }
  }

  function renderBlocks() {
    elements.emailBlockList.innerHTML = "";
    if (!state.blocks.length) elements.emailBlockList.innerHTML = '<div class="email-block-empty">Add a block to begin the message.</div>';
    state.blocks.forEach((block, index) => {
      const item = document.createElement("article"); item.className = "email-block-item"; item.dataset.blockId = block.id;
      const head = document.createElement("div"); head.className = "email-block-head"; head.innerHTML = `<strong>${escapeText(titleCase(block.type))}</strong><span>${index + 1}</span>`;
      const actions = document.createElement("div"); actions.className = "row-actions";
      actions.append(makeButton("↑", () => moveBlock(index, -1)), makeButton("↓", () => moveBlock(index, 1)), makeButton("Duplicate", () => duplicateBlock(index)), makeButton("Remove", () => removeBlock(index), "danger")); head.appendChild(actions);
      const fields = document.createElement("div"); fields.className = "email-block-fields"; fields.append(...blockFields(block, index)); item.append(head, fields); elements.emailBlockList.appendChild(item);
    });
  }

  function blockFields(block, index) {
    if (block.type === "heading") return [field("Text", "input", block.text, (value) => block.text = value), field("Level", "select", block.level, (value) => block.level = Number(value), [{value:1,label:"Primary heading"},{value:2,label:"Secondary heading"}])];
    if (["paragraph","footer"].includes(block.type)) return [field("Text", "textarea", block.text, (value) => block.text = value)];
    if (block.type === "image") return [field("Image URL", "input", block.url, (value) => block.url = value), field("Alt text", "input", block.alt, (value) => block.alt = value), field("Optional link", "input", block.link, (value) => block.link = value)];
    if (block.type === "button" || block.type === "link") return [field(block.type === "link" ? "Link label" : "Button label", "input", block.text, (value) => block.text = value), field("Destination URL", "input", block.url, (value) => block.url = value)];
    if (block.type === "list") return [field("List items (one per line)", "textarea", (block.items || []).join("\n"), (value) => block.items = value.split("\n"))];
    if (block.type === "callout") return [field("Callout title", "input", block.title, (value) => block.title = value), field("Callout text", "textarea", block.text, (value) => block.text = value)];
    if (block.type === "spacer") return [field("Height", "select", block.size, (value) => block.size = Number(value), [{value:12,label:"Small"},{value:24,label:"Medium"},{value:40,label:"Large"}])];
    return [];
  }

  function field(label, type, value, change, options = []) {
    const wrap = document.createElement("label"); wrap.className = "field"; const caption = document.createElement("span"); caption.textContent = label; let control;
    if (type === "textarea") control = document.createElement("textarea"); else if (type === "select") { control = document.createElement("select"); options.forEach((option) => { const el = document.createElement("option"); el.value = option.value; el.textContent = option.label; control.appendChild(el); }); } else { control = document.createElement("input"); control.type = "text"; }
    control.value = value ?? ""; control.addEventListener("focus", () => state.activeInput = control); control.addEventListener("input", () => { change(control.value); schedulePreview(); }); control.addEventListener("change", () => { change(control.value); schedulePreview(); }); wrap.append(caption, control); return wrap;
  }

  function newBlock(type) {
    const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2,6)}`;
    const defaults = { heading:{text:"Your heading",level:1}, paragraph:{text:"Add your message here."}, image:{url:"",alt:"",link:""}, button:{text:"Learn more",url:"https://circuitwash.com"}, link:{text:"Read more",url:"https://circuitwash.com"}, list:{items:["First point","Second point"]}, callout:{title:"Important information",text:"Add the key details here."}, divider:{}, spacer:{size:24}, footer:{text:"Additional information or terms."} };
    return { id, type, ...(defaults[type] || {}) };
  }

  function addBlock(type) { state.blocks.push(newBlock(type)); renderBlocks(); schedulePreview(); }
  function moveBlock(index, delta) { const target = index + delta; if (target < 0 || target >= state.blocks.length) return; [state.blocks[index],state.blocks[target]]=[state.blocks[target],state.blocks[index]]; renderBlocks(); schedulePreview(); }
  function duplicateBlock(index) { const block = clone(state.blocks[index]); block.id = `${block.type}-${Date.now()}`; state.blocks.splice(index + 1, 0, block); renderBlocks(); schedulePreview(); }
  function removeBlock(index) { state.blocks.splice(index,1); renderBlocks(); schedulePreview(); }

  function populateVariables() { elements.emailVariableSelect.innerHTML = (state.data?.variables || []).map((item) => `<option value="{{${escapeText(item.key)}}}">${escapeText(item.label)} · {{${escapeText(item.key)}}}</option>`).join(""); }
  function insertVariable() { const value = elements.emailVariableSelect.value; const input = state.activeInput && document.contains(state.activeInput) ? state.activeInput : elements.emailSubjectInput; const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start; input.value = input.value.slice(0,start) + value + input.value.slice(end); input.dispatchEvent(new Event("input", { bubbles:true })); input.focus(); input.setSelectionRange(start+value.length,start+value.length); }

  function schedulePreview() { clearTimeout(state.previewTimer); state.previewTimer = setTimeout(renderPreview, 260); }
  async function renderPreview() {
    try { const result = await emailApi("email_render_preview", { ...currentPayload(), sampleEmail: elements.emailSampleCustomerSelect.value }); writeFrame(elements.emailPreviewFrame, result.html); if (!elements.emailStepReview.classList.contains("hidden")) writeFrame(elements.emailReviewFrame, result.html); }
    catch (error) { writeFrame(elements.emailPreviewFrame, `<p style="font-family:Arial;padding:20px;color:#a33434">${escapeText(error.message)}</p>`); }
  }

  function writeFrame(frame, html) { if (!frame) return; frame.srcdoc = html; }

  async function sendTest() {
    const email = elements.emailTestAddress.value.trim(); if (!email) return setMessage(elements.emailTestMessage, "Enter a test email address.", "bad"); elements.sendEmailTestBtn.disabled = true; setMessage(elements.emailTestMessage, "Sending test...", "");
    try { await emailApi("email_send_test", { ...currentPayload(), email, sampleEmail: elements.emailSampleCustomerSelect.value }); setMessage(elements.emailTestMessage, `Test sent to ${email}.`, "ok"); }
    catch (error) { setMessage(elements.emailTestMessage, error.message, "bad"); } finally { elements.sendEmailTestBtn.disabled = false; }
  }

  function populateSampleCustomers() { const customers = (state.data?.customers || []).filter((item) => !item.suppressed); elements.emailSampleCustomerSelect.innerHTML = customers.length ? customers.slice(0,300).map((item) => `<option value="${escapeText(item.email)}">${escapeText(item.email)} · ${escapeText(item.siteName)}</option>`).join("") : '<option value="customer@example.com">Sample customer</option>'; }
  function populateSiteSegments() { const sites = new Map(); (state.data?.customers || []).filter((item) => !item.suppressed).forEach((item) => sites.set(item.siteId,item.siteName)); elements.emailSiteTargetSelect.innerHTML = '<option value="">Choose a site</option>' + [...sites].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>`<option value="${escapeText(id)}">${escapeText(name)}</option>`).join(""); }

  function syncRecipientMode() {
    document.querySelectorAll('input[name="emailRecipientMode"]').forEach((input) => input.checked = input.value === state.recipientMode);
    elements.emailSiteTargetWrap.classList.toggle("hidden", state.recipientMode !== "SITE"); elements.emailSelectedTargetWrap.classList.toggle("hidden", state.recipientMode !== "SELECTED"); elements.emailSiteTargetSelect.value = state.siteId;
  }

  function visibleCustomers() { const term = state.customerFilter.trim().toLowerCase(); return (state.data?.customers || []).filter((item) => !item.suppressed && (!term || `${item.email} ${item.siteName} ${item.orderId} ${item.source}`.toLowerCase().includes(term))); }
  function renderCustomers() {
    const customers = visibleCustomers(); elements.emailCustomerList.innerHTML = "";
    if (!customers.length) return elements.emailCustomerList.innerHTML = '<div class="muted" style="padding:12px">No matching eligible customers.</div>';
    customers.slice(0,500).forEach((customer) => {
      const row = document.createElement("label"); row.className = "recipient-row"; const checkbox = document.createElement("input"); checkbox.type="checkbox"; checkbox.checked=state.selectedEmails.has(customer.email.toLowerCase()); checkbox.addEventListener("change",()=>{if(checkbox.checked)state.selectedEmails.add(customer.email.toLowerCase());else state.selectedEmails.delete(customer.email.toLowerCase());previewRecipients();});
      const main = document.createElement("div"); main.className="recipient-main"; const meta = customer.source === "EMAIL_LIST" ? "Email list contact" : `${escapeText(customer.siteName)} · ${formatCount(customer.purchaseCount)} purchase${customer.purchaseCount===1?"":"s"}`; main.innerHTML=`<div class="recipient-email">${escapeText(customer.email)}</div><div class="recipient-meta">${meta}</div>`; const status=document.createElement("div");status.className="recipient-status";status.textContent=formatDateTimeLocal(customer.purchasedAt || customer.createdAt);row.append(checkbox,main,status);elements.emailCustomerList.appendChild(row);
    });
  }

  function targetingPayload() { return { recipientMode: state.recipientMode, emails: [...state.selectedEmails], siteId: state.siteId }; }
  async function previewRecipients() {
    setMessage(elements.emailRecipientMessage, "Checking eligibility...", "");
    try { const result = await emailApi("email_recipient_preview", targetingPayload()); state.recipientPreview = result.recipients || []; updateRecipientPreviewUi(result); }
    catch (error) { state.recipientPreview=[]; updateRecipientPreviewUi(); setMessage(elements.emailRecipientMessage,error.message,"bad"); }
  }

  function updateRecipientPreviewUi(result = {}) {
    const count = state.recipientPreview.length; elements.emailRecipientCount.textContent = formatCount(count); elements.emailRecipientSummary.textContent = count ? `${audienceLabel()} · ${formatCount(result.suppressedExcluded || 0)} suppressed excluded` : "No eligible recipients selected.";
    elements.emailRecipientPreviewList.innerHTML = state.recipientPreview.map((item)=>`<div><strong>${escapeText(item.email)}</strong><span>${escapeText(item.source === "EMAIL_LIST" ? "Email list contact" : item.siteName)}</span></div>`).join(""); setMessage(elements.emailRecipientMessage,"","");
  }

  async function prepareReview() {
    await previewRecipients(); const rendered = await emailApi("email_render_preview", { ...currentPayload(), sampleEmail: state.recipientPreview[0]?.email || elements.emailSampleCustomerSelect.value });
    elements.emailReviewSubject.textContent = rendered.subject; elements.emailReviewName.textContent = elements.emailNameInput.value || "Unnamed email"; elements.emailReviewRecipients.textContent = formatCount(state.recipientPreview.length); elements.emailReviewAudience.textContent = audienceLabel(); elements.emailReviewSender.textContent = state.data?.sender || "CircuitWash"; elements.emailReviewUnsubscribe.textContent = elements.emailIncludeUnsubscribeInput.checked ? "Included" : "Not included";
    writeFrame(elements.emailReviewFrame,rendered.html); elements.emailApprovalCheck.checked=false; elements.openEmailSendReviewBtn.disabled=true;
  }

  function audienceLabel() { if(state.recipientMode==="ALL")return"All eligible customers";if(state.recipientMode==="SITE")return elements.emailSiteTargetSelect.selectedOptions[0]?.textContent||"Site segment";return"Selected customers"; }
  function usedVariables() { const text=[elements.emailSubjectInput.value,elements.emailPreheaderInput.value,JSON.stringify(state.blocks)].join(" ");return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((match)=>`{{${match[1].toLowerCase()}}}`))]; }

  async function openFinalConfirmation() {
    if (!state.recipientPreview.length) return setMessage(elements.emailSendMessage,"No eligible recipients selected.","bad");
    const draft = await saveDraft(false); if (!draft) return setMessage(elements.emailSendMessage,"Save the draft before continuing.","bad");
    const scheduled = elements.emailScheduleInput.value ? new Date(elements.emailScheduleInput.value) : null;
    const rendered = await emailApi("email_render_preview", { ...currentPayload(), sampleEmail: state.recipientPreview[0]?.email || elements.emailSampleCustomerSelect.value }); elements.emailConfirmSubject.textContent = rendered.subject; elements.emailConfirmRecipients.textContent = formatCount(state.recipientPreview.length); elements.emailConfirmAudience.textContent = audienceLabel(); elements.emailConfirmSender.textContent = state.data?.sender || "CircuitWash"; elements.emailConfirmDelivery.textContent = scheduled ? `Scheduled for ${scheduled.toLocaleString()} · Europe/London` : "Send immediately"; elements.confirmEmailSendBtn.textContent = scheduled ? "Schedule email" : "Send email"; writeFrame(elements.emailConfirmFrame, rendered.html); elements.emailSendOverlay.classList.remove("hidden");
  }

  function closeFinalConfirmation() { elements.emailSendOverlay.classList.add("hidden"); setMessage(elements.emailConfirmMessage,"",""); }

  async function confirmSend() {
    elements.confirmEmailSendBtn.disabled=true; setMessage(elements.emailConfirmMessage,"Submitting to email provider...","");
    try { const result=await emailApi("email_send",{campaignId:state.campaignId,...targetingPayload(),scheduledFor:elements.emailScheduleInput.value?new Date(elements.emailScheduleInput.value).toISOString():""});setMessage(elements.emailConfirmMessage,result.status==="SCHEDULED"?`Scheduled for ${formatDateTimeLocal(result.scheduledFor)}.`:`Sent to ${formatCount(result.accepted)} recipients.`,result.failed?"bad":"ok");setTimeout(()=>{closeFinalConfirmation();closeEditor();},900); }
    catch(error){setMessage(elements.emailConfirmMessage,error.message,"bad");}finally{elements.confirmEmailSendBtn.disabled=false;}
  }

  async function saveTemplate() { const name=window.prompt(state.templateId?"Rename template":"Template name",elements.emailNameInput.value||"Customer email template");if(!name)return;try{const result=await emailApi("email_save_template",{templateId:state.templateId,name,subject:elements.emailSubjectInput.value,preheader:elements.emailPreheaderInput.value,includeUnsubscribe:elements.emailIncludeUnsubscribeInput.checked,theme:state.theme,blocks:state.blocks});state.templateId=result.template.id;elements.saveEmailTemplateBtn.textContent="Update template";setMessage(elements.emailTestMessage,"Template saved.","ok");state.data=null;}catch(error){setMessage(elements.emailTestMessage,error.message,"bad");} }
  async function duplicateTemplate(template){try{await emailApi("email_duplicate_template",{templateId:template.id});state.data=null;await loadEmailCenter(true);}catch(error){alert(error.message);} }
  async function setTemplateStatus(template,archived){try{await emailApi("email_template_status",{templateId:template.id,archived});state.data=null;await loadEmailCenter(true);}catch(error){alert(error.message);} }
  async function deleteTemplate(template){if(!window.confirm(`Delete template "${template.name}"? Existing emails are not affected.`))return;try{await emailApi("email_template_status",{templateId:template.id,delete:true});state.data=null;await loadEmailCenter(true);}catch(error){alert(error.message);} }
  async function deleteDraft(campaign){if(!window.confirm(`Delete draft "${campaign.name}"? This cannot be undone.`))return;try{await emailApi("email_delete_draft",{campaignId:campaign.id});state.data=null;await loadEmailCenter(true);}catch(error){alert(error.message);} }
  async function cancelScheduled(campaign){if(!window.confirm(`Cancel every scheduled delivery for "${campaign.name}"? The email will remain available as a cancelled draft.`))return;try{await emailApi("email_cancel_scheduled",{campaignId:campaign.id});state.data=null;await loadEmailCenter(true);}catch(error){alert(error.message);} }
  async function restoreSuppression(item){if(!window.confirm(`Restore custom-email eligibility for ${item.email}? Only continue if the customer explicitly opted back in.`))return;try{await emailApi("email_restore_suppression",{email:item.email});state.data=null;await loadEmailCenter(true);}catch(error){alert(error.message);} }

  async function addContacts() {
    const emails = elements.emailContactInput.value.trim();
    if (!emails) return setMessage(elements.emailContactMessage, "Enter at least one email address.", "bad");
    elements.addEmailContactsBtn.disabled = true;
    setMessage(elements.emailContactMessage, "Adding contacts...", "");
    try {
      const result = await emailApi("email_add_contacts", { emails });
      elements.emailContactInput.value = "";
      elements.emailContactAdder.open = false;
      setMessage(elements.emailContactMessage, `${formatCount(result.added)} contact${result.added === 1 ? "" : "s"} added to the email list.`, "ok");
      state.data = null; await loadEmailCenter(true);
    } catch (error) { setMessage(elements.emailContactMessage, error.message, "bad"); }
    finally { elements.addEmailContactsBtn.disabled = false; }
  }

  async function removeContact(contact) {
    if (!window.confirm(`Remove ${contact.email} from the email list?`)) return;
    try { await emailApi("email_remove_contact", { email: contact.email }); state.data = null; await loadEmailCenter(true); }
    catch (error) { setMessage(elements.emailContactMessage, error.message, "bad"); }
  }

  function makeButton(text,handler,tone=""){const button=document.createElement("button");button.type="button";button.className=`button small ${tone}`.trim();button.textContent=text;button.addEventListener("click",handler);return button;}
  function appendTextCell(row,value){const cell=document.createElement("td");cell.textContent=value||"-";row.appendChild(cell);}
  function titleCase(value){return String(value||"").toLowerCase().replace(/(^|[_\s-])\w/g,(char)=>char.toUpperCase()).replace(/_/g," ");}
  function formatCount(value){return new Intl.NumberFormat("en-GB").format(Number(value)||0);}
  function formatDateTimeLocal(value){if(!value)return"-";return new Date(value).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});}
  function setMessage(element,text,tone){element.textContent=text;element.className=`message ${tone||""}`.trim();}
  function escapeText(value){return String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);}
  function clone(value){return JSON.parse(JSON.stringify(value));}

  elements.reloadEmailBtn.addEventListener("click",()=>{state.data=null;loadEmailCenter(true);});
  elements.addEmailContactsBtn.addEventListener("click", addContacts);
  elements.createEmailBtn.addEventListener("click",openNewEmail); elements.emailBackBtn.addEventListener("click",closeEditor);
  [elements.emailNameInput,elements.emailSubjectInput,elements.emailPreheaderInput].forEach((input)=>{input.addEventListener("focus",()=>state.activeInput=input);input.addEventListener("input",schedulePreview);});
  elements.emailIncludeUnsubscribeInput.addEventListener("change", schedulePreview);
  document.querySelectorAll("[data-email-theme]").forEach((button) => button.addEventListener("click", () => applyThemePreset(button.dataset.emailTheme)));
  elements.resetEmailThemeBtn.addEventListener("click", () => applyThemePreset("circuit"));
  [["primary",elements.emailPrimaryColour],["accent",elements.emailAccentColour],["page",elements.emailPageColour],["card",elements.emailCardColour],["heading",elements.emailHeadingColour],["body",elements.emailBodyColour]].forEach(([key,input]) => input.addEventListener("input", () => updateCustomTheme(key, input.value)));
  elements.insertEmailVariableBtn.addEventListener("click",insertVariable); document.querySelectorAll("[data-add-email-block]").forEach((button)=>button.addEventListener("click",()=>addBlock(button.dataset.addEmailBlock)));
  document.querySelectorAll("[data-email-preview-size]").forEach((button)=>button.addEventListener("click",()=>{document.querySelectorAll("[data-email-preview-size]").forEach((item)=>item.classList.toggle("active",item===button));elements.emailPreviewFrameWrap.classList.toggle("mobile",button.dataset.emailPreviewSize==="mobile");}));
  elements.emailSampleCustomerSelect.addEventListener("change",schedulePreview);elements.sendEmailTestBtn.addEventListener("click",sendTest);elements.saveEmailTemplateBtn.addEventListener("click",saveTemplate);
  [elements.saveEmailDraftBtn,elements.saveEmailDraftRecipientsBtn,elements.saveEmailDraftReviewBtn].forEach((button)=>button.addEventListener("click",()=>saveDraft(true)));
  elements.emailDesignNextBtn.addEventListener("click",()=>setStep("recipients"));elements.emailRecipientsNextBtn.addEventListener("click",()=>{if(state.recipientPreview.length)setStep("review");else setMessage(elements.emailRecipientMessage,"Choose at least one eligible recipient.","bad");});document.querySelectorAll("[data-email-step-go]").forEach((button)=>button.addEventListener("click",()=>setStep(button.dataset.emailStepGo)));
  document.querySelectorAll('input[name="emailRecipientMode"]').forEach((input)=>input.addEventListener("change",()=>{if(!input.checked)return;state.recipientMode=input.value;syncRecipientMode();previewRecipients();}));elements.emailSiteTargetSelect.addEventListener("change",()=>{state.siteId=elements.emailSiteTargetSelect.value;previewRecipients();});elements.emailCustomerFilter.addEventListener("input",()=>{state.customerFilter=elements.emailCustomerFilter.value;renderCustomers();});elements.emailSelectVisibleBtn.addEventListener("click",()=>{visibleCustomers().forEach((item)=>state.selectedEmails.add(item.email.toLowerCase()));renderCustomers();previewRecipients();});elements.emailClearSelectedBtn.addEventListener("click",()=>{state.selectedEmails.clear();renderCustomers();previewRecipients();});elements.refreshEmailRecipientsBtn.addEventListener("click",previewRecipients);
  elements.emailApprovalCheck.addEventListener("change",()=>elements.openEmailSendReviewBtn.disabled=!elements.emailApprovalCheck.checked);elements.openEmailSendReviewBtn.addEventListener("click",openFinalConfirmation);elements.closeEmailSendConfirmBtn.addEventListener("click",closeFinalConfirmation);elements.cancelEmailSendConfirmBtn.addEventListener("click",closeFinalConfirmation);elements.emailSendOverlay.addEventListener("click",(event)=>{if(event.target===elements.emailSendOverlay)closeFinalConfirmation();});elements.confirmEmailSendBtn.addEventListener("click",confirmSend);
  if (!$("tab-email").classList.contains("hidden")) loadEmailCenter();
})();
