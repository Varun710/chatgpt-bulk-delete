/**
 * ChatGPT Multi-Delete Extension
 */

(function () {
  console.log("ChatGPT Multi-Delete: Content script loaded.");

  // --- Constants & Config ---
  const SELECTORS = {
    // Sidebar usually has a nav element or specific aria-label
    sidebarCandidates: [
      'nav[aria-label="Chat history"]',
      'nav[aria-label="History"]',
      "nav", // Fallback, but might be too broad
      'div[class*="sidebar"]',
    ],
    // Chat items are usually anchor tags in the sidebar
    chatItemCandidates: [
      'a[href^="/c/"]',
      'a[href^="/chat/"]',
      "li > a", // Fallback
    ],
    // Menu button (the "..." or similar)
    menuButton:
      'button[aria-label*="options" i], button[aria-label*="setting" i], button[aria-haspopup="menu"]',
    // Delete menu item
    menuItemDelete: '[role="menuitem"]', // We'll filter by text content "Delete"
    // Confirm dialog button
    confirmButton: 'button.btn-danger, button[class*="danger"]', // Heuristic
  };

  const UI_CLASSES = {
    toolbar: "cgpt-multi-toolbar",
    checkbox: "cgpt-multi-checkbox",
    checkboxWrapper: "cgpt-checkbox-wrapper",
  };

  // --- State ---
  let state = {
    isMultiSelectOn: false,
    selectedChatIds: new Set(), // Stores hrefs or unique IDs
    isDeleting: false,
    observer: null,
  };

  // --- DOM Discovery ---

  function getSidebar() {
    for (const selector of SELECTORS.sidebarCandidates) {
      const el = document.querySelector(selector);
      // specific check to ensure it looks like the history sidebar (e.g. contains chat links)
      if (el && el.querySelector('a[href^="/c/"]')) {
        return el;
      }
    }
    return null;
  }

  function findChatItems() {
    const sidebar = getSidebar();
    if (!sidebar) return [];

    // Try to find all chat links
    const links = Array.from(sidebar.querySelectorAll('a[href^="/c/"]'));

    return links.map((link) => {
      // The "root" for our purposes might be the link itself or its parent li
      // We'll attach the checkbox to the link or a wrapper inside it.
      // Usually the link contains the title.
      return {
        element: link,
        id: link.getAttribute("href"), // Use href as ID
        title: link.textContent.trim(),
      };
    });
  }

  // --- UI Injection ---

  function createToolbar() {
    if (document.querySelector(`.${UI_CLASSES.toolbar}`)) return;

    const sidebar = getSidebar();
    if (!sidebar) return;

    const toolbar = document.createElement("div");
    toolbar.className = UI_CLASSES.toolbar;
    toolbar.innerHTML = `
      <div class="cgpt-multi-left">
        <button class="cgpt-multi-toggle" aria-pressed="false" type="button">Select</button>
      </div>
      <span class="cgpt-multi-count">0 selected</span>
      <div class="cgpt-multi-right">
        <button class="cgpt-multi-delete" disabled type="button">Delete</button>
      </div>
    `;

    // Insert at the top of the sidebar
    sidebar.prepend(toolbar);

    // Event Listeners
    toolbar
      .querySelector(".cgpt-multi-toggle")
      .addEventListener("click", toggleMultiSelect);
    toolbar
      .querySelector(".cgpt-multi-delete")
      .addEventListener("click", handleDeleteClick);
  }

  function updateToolbar() {
    const toolbar = document.querySelector(`.${UI_CLASSES.toolbar}`);
    if (!toolbar) return;

    const toggleBtn = toolbar.querySelector(".cgpt-multi-toggle");
    const countSpan = toolbar.querySelector(".cgpt-multi-count");
    const deleteBtn = toolbar.querySelector(".cgpt-multi-delete");

    toggleBtn.setAttribute("aria-pressed", state.isMultiSelectOn);
    toggleBtn.textContent = state.isMultiSelectOn ? "Cancel" : "Select";

    const count = state.selectedChatIds.size;
    countSpan.textContent =
      count === 0 ? "0 selected" : `${count} ${count === 1 ? "chat" : "chats"}`;

    deleteBtn.disabled = state.selectedChatIds.size === 0 || state.isDeleting;
    deleteBtn.textContent = state.isDeleting ? "Deleting" : "Delete";
  }

  function injectCheckboxes() {
    if (!state.isMultiSelectOn) return;

    const items = findChatItems();
    items.forEach((item) => {
      // Check if checkbox already exists
      if (item.element.querySelector(`.${UI_CLASSES.checkbox}`)) return;

      // Create checkbox
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = UI_CLASSES.checkbox;
      checkbox.checked = state.selectedChatIds.has(item.id);

      // Stop propagation so clicking checkbox doesn't open the chat
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSelection(item.id, checkbox.checked);
      });

      // Insert checkbox at the beginning of the link content
      // We might need a wrapper to keep formatting nice
      const wrapper = document.createElement("span");
      wrapper.className = UI_CLASSES.checkboxWrapper;
      wrapper.appendChild(checkbox);

      item.element.prepend(wrapper);
    });
  }

  function removeCheckboxes() {
    const checkboxes = document.querySelectorAll(`.${UI_CLASSES.checkbox}`);
    checkboxes.forEach((cb) => {
      const wrapper = cb.closest(`.${UI_CLASSES.checkboxWrapper}`);
      if (wrapper) wrapper.remove();
      else cb.remove();
    });
  }

  // --- Modal Functions ---

  /**
   * Show a confirmation modal
   * @param {string} title - Modal title
   * @param {string} message - Modal message
   * @param {string} iconType - 'warning' or 'danger'
   * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
   */
  function showConfirmModal(title, message, iconType = "warning") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "cgpt-modal-overlay";

      const iconSvg =
        iconType === "danger"
          ? '<svg class="cgpt-modal-icon cgpt-modal-icon-danger" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'
          : '<svg class="cgpt-modal-icon cgpt-modal-icon-warning" viewBox="0 0 24 24"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';

      overlay.innerHTML = `
                <div class="cgpt-modal">
                    <div class="cgpt-modal-header">
                        <div style="display: flex; align-items: flex-start; gap: 12px; flex: 1;">
                            ${iconSvg}
                            <h3 class="cgpt-modal-title">${title}</h3>
                        </div>
                        <button class="cgpt-modal-close" aria-label="Close">
                            <svg class="cgpt-modal-close-icon" viewBox="0 0 24 24">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="cgpt-modal-body">${message}</div>
                    <div class="cgpt-modal-footer">
                        <button class="cgpt-modal-btn cgpt-modal-btn-cancel">Cancel</button>
                        <button class="cgpt-modal-btn cgpt-modal-btn-danger">Delete</button>
                    </div>
                </div>
            `;

      document.body.appendChild(overlay);

      const handleClose = (confirmed) => {
        overlay.style.animation = "fadeOutOverlay 0.2s ease-out";
        const modal = overlay.querySelector(".cgpt-modal");
        modal.style.animation =
          "scaleOutModal 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
        setTimeout(() => {
          overlay.remove();
          resolve(confirmed);
        }, 200);
      };

      overlay
        .querySelector(".cgpt-modal-btn-danger")
        .addEventListener("click", () => handleClose(true));
      overlay
        .querySelector(".cgpt-modal-btn-cancel")
        .addEventListener("click", () => handleClose(false));
      overlay
        .querySelector(".cgpt-modal-close")
        .addEventListener("click", () => handleClose(false));

      // Close on overlay click (but not on modal click)
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          handleClose(false);
        }
      });

      // Close on Escape key
      const handleEscape = (e) => {
        if (e.key === "Escape") {
          handleClose(false);
          document.removeEventListener("keydown", handleEscape);
        }
      };
      document.addEventListener("keydown", handleEscape);

      // Focus the cancel button for accessibility
      overlay.querySelector(".cgpt-modal-btn-cancel").focus();
    });
  }

  /**
   * Show a notification/alert modal
   * @param {string} title - Modal title
   * @param {string} message - Modal message
   * @param {string} type - 'success', 'error', or 'info'
   */
  function showAlertModal(title, message, type = "info") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "cgpt-modal-overlay";

      let iconSvg = "";
      let iconClass = "";
      if (type === "success") {
        iconSvg =
          '<svg class="cgpt-modal-icon cgpt-modal-icon-success" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        iconClass = "cgpt-modal-icon-success";
      } else if (type === "error") {
        iconSvg =
          '<svg class="cgpt-modal-icon cgpt-modal-icon-danger" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
        iconClass = "cgpt-modal-icon-danger";
      } else {
        iconSvg =
          '<svg class="cgpt-modal-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
      }

      const buttonClass =
        type === "error" ? "cgpt-modal-btn-danger" : "cgpt-modal-btn-primary";
      const buttonText = "OK";

      overlay.innerHTML = `
                <div class="cgpt-modal">
                    <div class="cgpt-modal-header">
                        <div style="display: flex; align-items: flex-start; gap: 12px; flex: 1;">
                            ${iconSvg}
                            <h3 class="cgpt-modal-title">${title}</h3>
                        </div>
                        <button class="cgpt-modal-close" aria-label="Close">
                            <svg class="cgpt-modal-close-icon" viewBox="0 0 24 24">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="cgpt-modal-body">${message}</div>
                    <div class="cgpt-modal-footer">
                        <button class="cgpt-modal-btn ${buttonClass}">${buttonText}</button>
                    </div>
                </div>
            `;

      document.body.appendChild(overlay);

      const handleClose = () => {
        overlay.style.animation = "fadeOutOverlay 0.2s ease-out";
        const modal = overlay.querySelector(".cgpt-modal");
        modal.style.animation =
          "scaleOutModal 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
        setTimeout(() => {
          overlay.remove();
          resolve();
        }, 200);
      };

      overlay
        .querySelector(`.cgpt-modal-btn`)
        .addEventListener("click", handleClose);
      overlay
        .querySelector(".cgpt-modal-close")
        .addEventListener("click", handleClose);

      // Close on overlay click
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          handleClose();
        }
      });

      // Close on Escape key
      const handleEscape = (e) => {
        if (e.key === "Escape") {
          handleClose();
          document.removeEventListener("keydown", handleEscape);
        }
      };
      document.addEventListener("keydown", handleEscape);

      // Focus the OK button for accessibility
      overlay.querySelector(".cgpt-modal-btn").focus();
    });
  }

  // Add fade out animations
  const style = document.createElement("style");
  style.textContent = `
        @keyframes fadeOutOverlay {
            from { opacity: 1; }
            to { opacity: 0; }
        }
        @keyframes scaleOutModal {
            from { opacity: 1; transform: scale(1) translateY(0); }
            to { opacity: 0; transform: scale(0.95) translateY(10px); }
        }
    `;
  document.head.appendChild(style);

  // --- Actions ---

  function toggleMultiSelect() {
    state.isMultiSelectOn = !state.isMultiSelectOn;
    if (!state.isMultiSelectOn) {
      state.selectedChatIds.clear();
      removeCheckboxes();
    } else {
      injectCheckboxes();
    }
    updateToolbar();
  }

  function toggleSelection(id, isSelected) {
    if (isSelected) {
      state.selectedChatIds.add(id);
    } else {
      state.selectedChatIds.delete(id);
    }
    updateToolbar();
  }

  async function handleDeleteClick() {
    if (state.selectedChatIds.size === 0) return;

    const count = state.selectedChatIds.size;
    const chatText = count === 1 ? "chat" : "chats";
    const confirmed = await showConfirmModal(
      "Delete Chats?",
      `Are you sure you want to delete ${count} ${chatText}? This action cannot be undone.`,
      "danger"
    );
    if (!confirmed) return;

    state.isDeleting = true;
    updateToolbar();

    // Get the items to delete with their current positions
    const itemsToDelete = Array.from(state.selectedChatIds);

    // Find all current chat items and match them to selected IDs
    // This ensures we're deleting the right chats even if order changes
    const allCurrentItems = findChatItems();
    const itemsToDeleteWithElements = itemsToDelete
      .map((id) => {
        const item = allCurrentItems.find((i) => i.id === id);
        if (!item) {
          console.warn(`Selected chat ${id} not found in current DOM`);
          return null;
        }
        return {
          id,
          element: item.element,
          index: allCurrentItems.indexOf(item),
        };
      })
      .filter((item) => item !== null)
      .sort((a, b) => b.index - a.index); // Sort by index descending (delete from bottom to top)

    console.log(
      `Deleting ${itemsToDeleteWithElements.length} chats in order:`,
      itemsToDeleteWithElements.map((i) => ({ id: i.id, index: i.index }))
    );

    let deletedCount = 0;
    let failedCount = 0;

    for (const { id, element } of itemsToDeleteWithElements) {
      try {
        // Verify the element still exists before deleting
        if (!document.contains(element)) {
          console.warn(
            `Chat element for ${id} no longer exists in DOM, skipping`
          );
          state.selectedChatIds.delete(id);
          continue;
        }

        await deleteSingleChat(id);
        deletedCount++;
        state.selectedChatIds.delete(id);
        updateToolbar(); // Update counter as we go

        // Wait a bit longer after deletion to ensure DOM updates
        await wait(500);
      } catch (err) {
        console.error(`Failed to delete chat ${id}:`, err);
        failedCount++;
      }
    }

    state.isDeleting = false;

    // Show completion modal
    if (failedCount === 0) {
      await showAlertModal(
        "Deletion Complete",
        `Successfully deleted ${deletedCount} ${
          deletedCount === 1 ? "chat" : "chats"
        }.`,
        "success"
      );
    } else {
      await showAlertModal(
        "Deletion Complete",
        `Deleted: ${deletedCount} ${
          deletedCount === 1 ? "chat" : "chats"
        }<br>Failed: ${failedCount} ${failedCount === 1 ? "chat" : "chats"}`,
        "error"
      );
    }

    // Refresh UI
    state.selectedChatIds.clear();
    removeCheckboxes(); // Force refresh of checkboxes/list
    injectCheckboxes();
    updateToolbar();
  }

  /**
   * Helper function to check if an element is visible
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0
    );
  }

  /**
   * Find the menu button associated with a chat item
   * Must be in the same parent container to ensure we get the right one
   */
  function findMenuButton(chatElement) {
    // ChatGPT structure: The chat link itself may be the container (has data-sidebar-item="true")
    // The menu button is typically inside a "trailing-pair" div within the chat link

    // Strategy 1: Look inside the chat link itself first (most common case)
    // The menu button is usually in a "trailing-pair" div
    const trailingPair = chatElement.querySelector(
      '.trailing-pair, div[class*="trailing"]'
    );
    if (trailingPair) {
      const buttonsInTrailing = trailingPair.querySelectorAll(
        'button[aria-haspopup="menu"], button[data-testid*="options"]'
      );
      for (const btn of buttonsInTrailing) {
        if (isElementVisible(btn)) {
          console.log("Found menu button in trailing-pair div");
          return btn;
        }
      }
    }

    // Strategy 2: Look for any button inside the chat link
    const buttonsInLink = chatElement.querySelectorAll(
      'button[aria-haspopup="menu"], button[data-testid*="options"]'
    );
    for (const btn of buttonsInLink) {
      if (isElementVisible(btn)) {
        console.log("Found menu button inside chat link");
        return btn;
      }
    }

    // Strategy 3: Find the chat container (could be the element itself or a parent)
    let chatContainer = chatElement;
    // Check if the element itself is the container
    if (
      chatElement.hasAttribute("data-sidebar-item") ||
      chatElement.classList.contains("__menu-item") ||
      chatElement.classList.contains("menu-item")
    ) {
      chatContainer = chatElement;
    } else {
      // Look for parent container
      chatContainer = chatElement.closest(
        'li, div[data-sidebar-item], div[class*="menu-item"], div[class*="__menu-item"]'
      );
    }

    if (!chatContainer) {
      // Fallback: use parent element
      chatContainer = chatElement.parentElement;
    }

    if (chatContainer && chatContainer !== chatElement) {
      // Look for button as a sibling of the chat link
      const parent = chatElement.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        for (const sibling of siblings) {
          if (sibling === chatElement) continue;

          if (sibling.tagName === "BUTTON") {
            if (
              sibling.getAttribute("aria-haspopup") === "menu" ||
              sibling.getAttribute("data-testid")?.includes("options")
            ) {
              if (isElementVisible(sibling)) {
                console.log("Found menu button as direct sibling");
                return sibling;
              }
            }
          }

          // Check inside sibling containers
          const buttonsInSibling = sibling.querySelectorAll(
            'button[aria-haspopup="menu"], button[data-testid*="options"]'
          );
          for (const btn of buttonsInSibling) {
            if (isElementVisible(btn)) {
              console.log("Found menu button in sibling container");
              return btn;
            }
          }
        }
      }

      // Look within the chat container
      const buttonsInContainer = chatContainer.querySelectorAll(
        'button[aria-haspopup="menu"], button[data-testid*="options"]'
      );
      for (const btn of buttonsInContainer) {
        // Skip if inside the chat link (already checked)
        if (chatElement.contains(btn)) continue;

        if (isElementVisible(btn)) {
          // Verify it's in the same row
          const chatRect = chatElement.getBoundingClientRect();
          const btnRect = btn.getBoundingClientRect();
          const verticalOverlap = !(
            btnRect.bottom < chatRect.top || btnRect.top > chatRect.bottom
          );

          if (verticalOverlap) {
            console.log("Found menu button in chat container");
            return btn;
          }
        }
      }
    }

    // Strategy 4: Look for button near the chat link (within same row) as last resort
    const chatRect = chatElement.getBoundingClientRect();
    const allButtons = document.querySelectorAll(
      'button[aria-haspopup="menu"], button[data-testid*="options"]'
    );
    for (const btn of allButtons) {
      if (!isElementVisible(btn)) continue;
      if (btn.classList.contains("cgpt-multi-delete")) continue;

      const btnRect = btn.getBoundingClientRect();
      // Must be in the same row (vertical overlap) and close horizontally
      const verticalOverlap = !(
        btnRect.bottom < chatRect.top || btnRect.top > chatRect.bottom
      );
      const horizontalDistance = Math.abs(btnRect.left - chatRect.right);

      if (verticalOverlap && horizontalDistance < 100) {
        // Verify it's not for a different chat by checking if it's in the same container hierarchy
        const btnContainer = btn.closest(
          'div[data-sidebar-item], li, div[class*="menu-item"]'
        );
        const chatContainerCheck = chatElement.closest(
          'div[data-sidebar-item], li, div[class*="menu-item"]'
        );

        if (
          !btnContainer ||
          !chatContainerCheck ||
          btnContainer === chatContainerCheck
        ) {
          console.log("Found menu button by proximity");
          return btn;
        }
      }
    }

    console.warn("Could not find menu button for chat element:", chatElement);
    return null;
  }

  /**
   * Find the delete menu item in an open menu
   */
  function findDeleteMenuItem() {
    // The menu might be in a portal/overlay, so search the entire document
    // Try multiple strategies to find the menu

    // Helper to check if text matches "delete"
    function matchesDelete(text) {
      if (!text) return false;
      const normalized = text.trim().toLowerCase();
      return (
        normalized === "delete" ||
        normalized === "delete chat" ||
        normalized === "delete conversation" ||
        normalized.includes("delete") ||
        normalized === "🗑️" || // Trash emoji
        normalized.includes("🗑")
      );
    }

    // Strategy 0: Look specifically for Radix UI menu items first
    const radixMenuItems = document.querySelectorAll(
      '[data-radix-menu-item], [role="menuitem"]'
    );
    for (const item of radixMenuItems) {
      if (!isElementVisible(item)) continue;
      const text = item.textContent.trim();
      const ariaLabel = item.getAttribute("aria-label");

      if (matchesDelete(text) || (ariaLabel && matchesDelete(ariaLabel))) {
        console.log("Found delete item via Radix UI menu:", item);
        return item;
      }
    }

    // Strategy 1: Look for role="menuitem" with "Delete" text
    const menuItems = document.querySelectorAll('[role="menuitem"]');
    for (const item of menuItems) {
      if (!isElementVisible(item)) continue;
      const text = item.textContent.trim();
      if (matchesDelete(text)) {
        return item;
      }
      // Also check aria-label
      const ariaLabel = item.getAttribute("aria-label");
      if (ariaLabel && matchesDelete(ariaLabel)) {
        return item;
      }
    }

    // Strategy 2: Look for menu containers and search within them (prioritize Radix UI)
    const menuSelectors = [
      "[data-radix-menu-content]", // Radix UI menu content (highest priority)
      "[data-radix-popper-content-wrapper]", // Radix UI popover wrapper
      "[data-radix-portal]", // Radix UI portal
      '[role="menu"]',
      '[role="listbox"]',
      'div[class*="Menu"]',
      'div[class*="menu"]',
      'div[class*="Dropdown"]',
      'div[class*="dropdown"]',
      'div[class*="Popover"]',
      'div[class*="popover"]',
      'div[class*="ContextMenu"]',
      'div[class*="context-menu"]',
    ];

    const menuContainers = document.querySelectorAll(menuSelectors.join(", "));
    for (const container of menuContainers) {
      if (!isElementVisible(container)) continue;

      // Look for buttons or divs with "Delete" text
      // Prioritize Radix UI menu items
      const itemSelectors = [
        "[data-radix-menu-item]", // Radix UI menu item
        'button[role="menuitem"]',
        'div[role="menuitem"]',
        'a[role="menuitem"]',
        "button",
        "div",
        "span",
        "a",
      ];

      const items = container.querySelectorAll(itemSelectors.join(", "));
      for (const item of items) {
        if (!isElementVisible(item)) continue;
        if (item.classList.contains("cgpt-multi-delete")) continue; // Skip our toolbar button

        const text = item.textContent.trim();
        const ariaLabel = item.getAttribute("aria-label");

        if (matchesDelete(text) || (ariaLabel && matchesDelete(ariaLabel))) {
          // Make sure it's clickable (has cursor pointer or is a button)
          const style = window.getComputedStyle(item);
          if (
            item.tagName === "BUTTON" ||
            item.tagName === "A" ||
            item.hasAttribute("data-radix-menu-item") ||
            style.cursor === "pointer" ||
            item.getAttribute("role") === "menuitem" ||
            item.onclick !== null
          ) {
            console.log("Found delete item in menu container:", {
              item,
              text,
              ariaLabel,
              tag: item.tagName,
              classes: item.className,
            });
            return item;
          }
        }
      }
    }

    // Strategy 3: Look for any clickable element with "Delete" text that's in a menu-like context
    // This is more aggressive - check all visible elements
    const allClickable = document.querySelectorAll("button, a, div, span, li");
    for (const el of allClickable) {
      if (!isElementVisible(el)) continue;
      if (el.classList.contains("cgpt-multi-delete")) continue;

      // Check if it's in a menu-like container or overlay
      const hasMenuParent = el.closest(
        '[role="menu"], [role="listbox"], div[class*="Menu"], div[class*="menu"], div[class*="Dropdown"], div[class*="dropdown"], div[class*="Popover"], [data-radix-popper-content-wrapper]'
      );
      if (!hasMenuParent) continue;

      const text = el.textContent.trim();
      const ariaLabel = el.getAttribute("aria-label");

      if (
        (matchesDelete(text) || (ariaLabel && matchesDelete(ariaLabel))) &&
        el.offsetWidth > 0 &&
        el.offsetHeight > 0
      ) {
        return el;
      }
    }

    // Strategy 4: Look for elements with specific data attributes or IDs that might indicate delete
    const deleteByAttribute = document.querySelectorAll(
      '[data-action*="delete" i], [id*="delete" i], [class*="delete" i]'
    );
    for (const el of deleteByAttribute) {
      if (!isElementVisible(el)) continue;
      if (el.classList.contains("cgpt-multi-delete")) continue;

      // Check if it's in a menu context
      const hasMenuParent = el.closest(
        '[role="menu"], [role="listbox"], div[class*="Menu"], div[class*="menu"]'
      );
      if (hasMenuParent && el.offsetWidth > 0 && el.offsetHeight > 0) {
        return el;
      }
    }

    return null;
  }

  async function deleteSingleChat(id) {
    // 1. Find the element again (DOM might have changed)
    // Use a more robust search - find by href directly in the sidebar
    const sidebar = getSidebar();
    if (!sidebar) throw new Error("Sidebar not found");

    // Find the chat link by its href attribute directly
    const chatLink = sidebar.querySelector(`a[href="${id}"]`);

    let item;
    if (!chatLink) {
      // If not found, try finding all items and matching
      const items = findChatItems();
      const foundItem = items.find((i) => i.id === id);
      if (!foundItem) {
        console.warn(
          `Chat item not found for ${id}. Available chats:`,
          items.map((i) => i.id)
        );
        throw new Error(`Chat item not found in DOM: ${id}`);
      }
      item = { element: foundItem.element, id: foundItem.id };
    } else {
      item = { element: chatLink, id: id };
    }

    console.log(`Deleting chat: ${id}`, item.element);

    // Verify this is the correct element by checking its href matches
    const actualHref = item.element.getAttribute("href");
    if (actualHref !== id) {
      throw new Error(`Mismatch: Expected href ${id}, but found ${actualHref}`);
    }

    // 2. Scroll into view
    item.element.scrollIntoView({ block: "center", behavior: "smooth" });
    await wait(300);

    // 3. Trigger hover to make menu button visible (if it's hidden until hover)
    // ChatGPT often hides the menu button until you hover over the chat item
    console.log("Triggering hover events to reveal menu button...");

    // Hover on the chat link itself
    item.element.dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: true, cancelable: true })
    );
    item.element.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, cancelable: true })
    );
    await wait(100);

    // Hover on parent elements (the list item container)
    let parent = item.element.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      parent.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, cancelable: true })
      );
      parent.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, cancelable: true })
      );
      parent = parent.parentElement;
      await wait(50);
    }

    await wait(300); // Give time for hover effects to show menu button

    // 4. Find and click the menu button (may need to wait for it to appear)
    let menuBtn = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      menuBtn = findMenuButton(item.element);
      if (menuBtn && isElementVisible(menuBtn)) {
        // Verify the menu button is associated with this chat item
        // They should share the same parent or be in the same row
        const chatParent = item.element.closest(
          'li, div[data-sidebar-item], div[class*="menu-item"]'
        );
        const btnParent = menuBtn.closest(
          'li, div[data-sidebar-item], div[class*="menu-item"]'
        );

        // Check if they're in the same parent container
        const sameParent = chatParent && btnParent && chatParent === btnParent;
        // Or check if button is a sibling/descendant of chat's parent
        const btnInChatParent = chatParent && chatParent.contains(menuBtn);
        // Or check if they're vertically aligned (same row)
        const chatRect = item.element.getBoundingClientRect();
        const btnRect = menuBtn.getBoundingClientRect();
        const sameRow =
          !(btnRect.bottom < chatRect.top || btnRect.top > chatRect.bottom) &&
          Math.abs(btnRect.left - chatRect.right) < 150;

        if (sameParent || btnInChatParent || sameRow) {
          console.log("Menu button found and verified for chat:", {
            menuBtn,
            sameParent,
            btnInChatParent,
            sameRow,
            chatHref: item.element.getAttribute("href"),
            btnTestId: menuBtn.getAttribute("data-testid"),
          });
          break;
        } else {
          console.warn("Menu button found but may not be for this chat:", {
            chatHref: item.element.getAttribute("href"),
            btnTestId: menuBtn.getAttribute("data-testid"),
            chatParent: chatParent?.tagName,
            btnParent: btnParent?.tagName,
          });
          menuBtn = null; // Try again
        }
      }
      await wait(100);
    }

    if (!menuBtn) {
      // Debug: log the structure around the chat item
      console.warn("Menu button not found. Chat element structure:", {
        element: item.element,
        parent: item.element.parentElement,
        siblings: Array.from(item.element.parentElement?.children || []),
        nearbyButtons: Array.from(
          item.element.closest("li, div")?.querySelectorAll("button") || []
        ),
        allButtons: Array.from(document.querySelectorAll("button"))
          .filter((b) => {
            const rect = b.getBoundingClientRect();
            const itemRect = item.element.getBoundingClientRect();
            return (
              Math.abs(rect.top - itemRect.top) < 50 &&
              Math.abs(rect.left - itemRect.right) < 200
            );
          })
          .map((b) => ({
            element: b,
            text: b.textContent,
            ariaLabel: b.getAttribute("aria-label"),
            visible: isElementVisible(b),
          })),
      });
      throw new Error("Menu button not found near chat link");
    }

    // Ensure button is visible and clickable
    menuBtn.scrollIntoView({ block: "center", behavior: "smooth" });
    await wait(200);

    // Keep hovering while we interact with the button
    const keepHovering = setInterval(() => {
      item.element.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, cancelable: true })
      );
    }, 200);

    // Click the menu button - Radix UI menu
    console.log("Clicking menu button:", menuBtn);
    console.log("Menu button state before click:", {
      ariaExpanded: menuBtn.getAttribute("aria-expanded"),
      dataState: menuBtn.getAttribute("data-state"),
      id: menuBtn.id,
    });

    // Strategy 1: Focus first, then click (Radix UI often requires focus)
    menuBtn.focus();
    await wait(100);

    // Strategy 2: Use MutationObserver to detect when menu opens
    let menuOpened = false;
    const menuObserver = new MutationObserver((mutations) => {
      const ariaExpanded = menuBtn.getAttribute("aria-expanded");
      const dataState = menuBtn.getAttribute("data-state");
      if (ariaExpanded === "true" || dataState === "open") {
        menuOpened = true;
      }

      // Also check if menu content appeared in DOM
      const menuContent = document.querySelector(
        '[data-radix-menu-content], [role="menu"]'
      );
      if (menuContent && isElementVisible(menuContent)) {
        menuOpened = true;
      }
    });

    menuObserver.observe(menuBtn, {
      attributes: true,
      attributeFilter: ["aria-expanded", "data-state"],
    });

    // Also observe document body for menu content appearing
    const bodyObserver = new MutationObserver(() => {
      const menuContent = document.querySelector(
        '[data-radix-menu-content], [role="menu"]'
      );
      if (menuContent && isElementVisible(menuContent)) {
        menuOpened = true;
      }
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Try multiple click approaches
    console.log("Attempting to open menu...");

    // Method 1: Regular click
    menuBtn.click();
    await wait(300);

    // Method 2: Mouse events sequence
    if (!menuOpened) {
      console.log("Trying mouse events...");
      menuBtn.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
        })
      );
      await wait(50);
      menuBtn.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
        })
      );
      await wait(50);
      menuBtn.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
        })
      );
      await wait(300);
    }

    // Method 3: Keyboard events (Space or Enter)
    if (!menuOpened) {
      console.log("Trying keyboard events...");
      menuBtn.focus();
      await wait(100);

      // Try Space key
      menuBtn.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          keyCode: 32,
          bubbles: true,
          cancelable: true,
        })
      );
      await wait(50);
      menuBtn.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: " ",
          code: "Space",
          keyCode: 32,
          bubbles: true,
          cancelable: true,
        })
      );
      await wait(300);

      // Try Enter key
      if (!menuOpened) {
        menuBtn.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
            cancelable: true,
          })
        );
        await wait(50);
        menuBtn.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
            cancelable: true,
          })
        );
        await wait(300);
      }
    }

    // Wait for menu to open with observer
    for (let i = 0; i < 30; i++) {
      if (menuOpened) break;
      await wait(100);
    }

    // Clean up observers
    menuObserver.disconnect();
    bodyObserver.disconnect();

    // Final check
    clearInterval(keepHovering); // Stop the hover interval

    const ariaExpanded = menuBtn.getAttribute("aria-expanded");
    const dataState = menuBtn.getAttribute("data-state");
    const menuContent = document.querySelector(
      '[data-radix-menu-content], [role="menu"]'
    );

    if (
      ariaExpanded === "true" ||
      dataState === "open" ||
      (menuContent && isElementVisible(menuContent))
    ) {
      console.log("Menu opened! State:", {
        ariaExpanded,
        dataState,
        menuContentFound: !!menuContent,
      });
      menuOpened = true;
      await wait(300); // Give menu content time to render
    } else {
      console.warn("Menu did not open. Final state:", {
        ariaExpanded,
        dataState,
        menuContentFound: !!menuContent,
        menuContentVisible: menuContent ? isElementVisible(menuContent) : false,
      });

      // Last resort: Try to trigger Radix UI handlers directly
      console.log("Attempting to trigger Radix UI handlers directly...");
      try {
        // Check if there are any event listeners we can trigger
        const reactFiber =
          menuBtn[
            Object.keys(menuBtn).find((key) => key.startsWith("__reactFiber"))
          ];
        if (reactFiber) {
          console.log("Found React fiber, trying to trigger handlers...");
          // Try to find and call the onClick handler
          let node = reactFiber;
          for (let i = 0; i < 10 && node; i++) {
            if (node.memoizedProps && node.memoizedProps.onClick) {
              console.log("Found onClick handler, calling it...");
              node.memoizedProps.onClick(
                new MouseEvent("click", { bubbles: true })
              );
              await wait(500);
              break;
            }
            node = node.return;
          }
        }
      } catch (e) {
        console.log("Could not access React internals:", e);
      }
    }

    // 5. Wait for menu to appear and find delete item
    // Radix UI menus are often in portals, so search the entire document
    let deleteItem = null;
    for (let i = 0; i < 30; i++) {
      // Wait up to 6 seconds
      await wait(200);

      // Log what we're finding each iteration (only first few times)
      if (i < 3) {
        // Look for Radix UI menu content specifically
        const radixMenus = document.querySelectorAll(
          '[data-radix-menu-content], [data-radix-popper-content-wrapper], [role="menu"]'
        );
        const radixMenuItems = document.querySelectorAll(
          '[data-radix-menu-item], [role="menuitem"]'
        );
        console.log(
          `Attempt ${i + 1}: Found ${radixMenus.length} Radix menus, ${
            radixMenuItems.length
          } menu items`
        );

        // Log the actual content of visible menus
        radixMenus.forEach((menu, idx) => {
          if (isElementVisible(menu)) {
            console.log(`Menu ${idx + 1}:`, {
              role: menu.getAttribute("role"),
              classes: menu.className,
              text: menu.textContent.trim().substring(0, 200),
              children: Array.from(menu.children).map((c) => ({
                tag: c.tagName,
                text: c.textContent.trim().substring(0, 100),
                role: c.getAttribute("role"),
                classes: c.className,
              })),
            });
          }
        });
      }

      deleteItem = findDeleteMenuItem();
      if (deleteItem) {
        console.log("Found delete item:", deleteItem);
        break;
      }
    }

    if (!deleteItem) {
      // Comprehensive debugging - log EVERYTHING that might be a menu
      const allMenus = Array.from(
        document.querySelectorAll(
          '[role="menu"], [role="listbox"], div[class*="Menu"], div[class*="menu"], div[class*="dropdown"], div[class*="Dropdown"], div[class*="popover"], div[class*="Popover"]'
        )
      );
      const allMenuItems = Array.from(
        document.querySelectorAll('[role="menuitem"], button, div, a, span')
      );
      const allButtons = Array.from(document.querySelectorAll("button"));

      // Find all visible elements that might be menus
      const visibleMenus = allMenus.filter((m) => isElementVisible(m));
      const visibleButtons = allButtons.filter(
        (b) => isElementVisible(b) && !b.classList.contains("cgpt-multi-delete")
      );

      // Get all text content from potential menu items
      const potentialMenuItems = Array.from(
        document.querySelectorAll("div, button, a, span")
      )
        .filter((el) => {
          if (!isElementVisible(el)) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          // Check if it's in a menu-like container
          return el.closest(
            '[role="menu"], [role="listbox"], div[class*="Menu"], div[class*="menu"], div[class*="dropdown"]'
          );
        })
        .slice(0, 50); // Limit to first 50 to avoid too much output

      // Get detailed info about Radix UI menus specifically
      const radixMenus = Array.from(
        document.querySelectorAll(
          '[data-radix-menu-content], [data-radix-popper-content-wrapper], [role="menu"]'
        )
      ).filter((m) => isElementVisible(m));

      const radixMenuItems = Array.from(
        document.querySelectorAll('[data-radix-menu-item], [role="menuitem"]')
      ).filter((m) => isElementVisible(m));

      console.error('Could not find "Delete" menu item. Full debug info:', {
        visibleMenus: visibleMenus.length,
        radixMenus: radixMenus.length,
        radixMenuItems: radixMenuItems.length,
        visibleButtons: visibleButtons.length,
        menuButtonClicked: menuBtn,
        menuButtonText: menuBtn.textContent,
        menuButtonAriaLabel: menuBtn.getAttribute("aria-label"),
        menuButtonState: {
          ariaExpanded: menuBtn.getAttribute("aria-expanded"),
          dataState: menuBtn.getAttribute("data-state"),
        },
        radixMenusDetail: radixMenus.map((m) => ({
          role: m.getAttribute("role"),
          classes: m.className,
          dataAttrs: Array.from(m.attributes)
            .filter((a) => a.name.startsWith("data-"))
            .map((a) => `${a.name}="${a.value}"`),
          text: m.textContent.trim().substring(0, 200),
          children: Array.from(m.children).map((c) => ({
            tag: c.tagName,
            text: c.textContent.trim().substring(0, 100),
            role: c.getAttribute("role"),
            dataAttrs: Array.from(c.attributes)
              .filter((a) => a.name.startsWith("data-"))
              .map((a) => `${a.name}="${a.value}"`),
            classes: c.className,
            ariaLabel: c.getAttribute("aria-label"),
          })),
        })),
        radixMenuItemsDetail: radixMenuItems.map((item) => ({
          tag: item.tagName,
          text: item.textContent.trim(),
          ariaLabel: item.getAttribute("aria-label"),
          role: item.getAttribute("role"),
          dataAttrs: Array.from(item.attributes)
            .filter((a) => a.name.startsWith("data-"))
            .map((a) => `${a.name}="${a.value}"`),
          classes: item.className,
        })),
        allMenus: visibleMenus.map((m) => ({
          role: m.getAttribute("role"),
          classes: m.className,
          text: m.textContent.trim().substring(0, 200),
          children: Array.from(m.children).map((c) => ({
            tag: c.tagName,
            text: c.textContent.trim().substring(0, 100),
            classes: c.className,
            role: c.getAttribute("role"),
          })),
        })),
        potentialMenuItems: potentialMenuItems.map((el) => ({
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 100),
          classes: el.className,
          role: el.getAttribute("role"),
        })),
        allVisibleButtons: visibleButtons
          .map((b) => ({
            text: b.textContent.trim().substring(0, 100),
            ariaLabel: b.getAttribute("aria-label"),
            classes: b.className,
            dataTestId: b.getAttribute("data-testid"),
          }))
          .slice(0, 30),
      });

      // Try alternative: right-click context menu
      console.log("Trying right-click approach as fallback...");
      const rightClickEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      });
      item.element.dispatchEvent(rightClickEvent);
      await wait(500);

      // Check if context menu appeared
      deleteItem = findDeleteMenuItem();
      if (deleteItem) {
        console.log("Found delete item via right-click!");
      } else {
        throw new Error(
          "Delete menu item not found - menu may not be opening or uses different structure"
        );
      }
    }

    // Click the delete item
    deleteItem.scrollIntoView({ block: "center", behavior: "smooth" });
    await wait(100);
    deleteItem.click();
    await wait(300);

    // 6. Wait for confirmation dialog
    let confirmBtn = null;
    for (let i = 0; i < 20; i++) {
      // Wait up to 4 seconds
      await wait(200);

      // Look for confirmation dialog
      const dialogs = document.querySelectorAll(
        '[role="dialog"], div[class*="Dialog"], div[class*="Modal"]'
      );

      for (const dialog of dialogs) {
        if (!isElementVisible(dialog)) continue;

        // Find buttons in the dialog
        const buttons = dialog.querySelectorAll("button");
        for (const btn of buttons) {
          if (!isElementVisible(btn)) continue;

          const text = btn.textContent.trim().toLowerCase();
          // Look for delete/confirm buttons
          if (text === "delete" || text === "confirm" || text === "ok") {
            // Prefer "Delete" over "Confirm" or "OK"
            if (text === "delete") {
              confirmBtn = btn;
              break;
            } else if (!confirmBtn) {
              confirmBtn = btn;
            }
          }
        }
        if (confirmBtn) break;
      }

      if (confirmBtn) break;
    }

    if (!confirmBtn) {
      // Debug: log what dialogs we found
      const dialogs = document.querySelectorAll('[role="dialog"]');
      console.warn("Confirm button not found. Found dialogs:", dialogs.length);
      throw new Error("Confirm delete button not found");
    }

    confirmBtn.scrollIntoView({ block: "center", behavior: "smooth" });
    await wait(100);
    confirmBtn.click();

    // 7. Wait for deletion to process and verify it's gone
    // Wait for the chat item to be removed from DOM
    let deleted = false;
    for (let i = 0; i < 20; i++) {
      await wait(200);
      // Check if the element is still in the DOM
      if (!document.contains(item.element)) {
        console.log(`Chat ${id} successfully deleted (removed from DOM)`);
        deleted = true;
        break;
      }
      // Also check if href no longer exists
      const sidebar = getSidebar();
      if (sidebar && !sidebar.querySelector(`a[href="${id}"]`)) {
        console.log(`Chat ${id} successfully deleted (href no longer found)`);
        deleted = true;
        break;
      }
    }

    if (!deleted) {
      console.warn(
        `Chat ${id} may not have been deleted - element still in DOM`
      );
    }

    await wait(500); // Additional wait to ensure DOM is stable
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Initialization ---

  function init() {
    // Initial check
    if (getSidebar()) {
      createToolbar();
    }

    // Observer to handle dynamic loading/navigation
    state.observer = new MutationObserver((mutations) => {
      // If sidebar appears or changes
      if (getSidebar()) {
        createToolbar();
        if (state.isMultiSelectOn) {
          injectCheckboxes();
        }
      }
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Run init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
