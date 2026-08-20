import { Component } from '@theme/component';
import { ThemeEvents, QuantitySelectorUpdateEvent, CartAddEvent, CartErrorEvent } from '@theme/events';
import { morph } from '@theme/morph';
import { onAnimationEnd } from '@theme/utilities';

/**
 * @typedef {Object} ProductVariant
 * @property {string|number} [id] - Variant ID
 * @property {string} [title] - Variant title
 * @property {string} [name] - Variant name
 * @property {boolean} [available] - Whether variant is available
 * @property {Object} [featured_media] - Featured media object
 * @property {Object} [featured_media.preview_image] - Preview image data
 * @property {string} [featured_media.preview_image.src] - Image source URL
 * @property {string} [featured_media.alt] - Alt text for the image
 */

/**
 * @typedef {HTMLElement & {
 *   source: Element,
 *   destination: Element,
 *   useSourceSize: string | boolean
 * }} FlyToCart
 */

/**
 * @typedef {Object} StickyAddToCartRefs
 * @property {HTMLElement} stickyBar - The floating bar container
 * @property {HTMLButtonElement} addToCartButton - Sticky bar's button
 * @property {HTMLElement} quantityDisplay - Quantity display container
 * @property {HTMLElement} quantityNumber - Quantity number element
 * @property {HTMLImageElement} productImage - Product image element
 */

/**
 * A custom element that manages a sticky add-to-cart bar.
 * Shows when the main buy buttons scroll out of view.
 *
 * @extends {Component<StickyAddToCartRefs>}
 */
class StickyAddToCartComponent extends Component {
  requiredRefs = ['stickyBar', 'addToCartButton', 'quantityDisplay', 'quantityNumber'];

  /** @type {IntersectionObserver | null} */
  #buyButtonsIntersectionObserver = null;

  /** @type {IntersectionObserver | null} */
  #mainBottomObserver = null;

  /** @type {number | undefined} */
  #resetTimeout;

  /** @type {boolean} */
  #isStuck = false;

  /** @type {number | null} */
  #animationTimeout = null;

  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {HTMLButtonElement | null} */
  #targetAddToCartButton = null;

  /** @type {number} */
  #currentQuantity = 1;

  /** @type {boolean} */
  #hiddenByBottom = false;

  connectedCallback() {
    super.connectedCallback();

    this.#setupIntersectionObserver();

    const { signal } = this.#abortController;
    const target = this.closest('.shopify-section');
    target?.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate, { signal });
    target?.addEventListener(ThemeEvents.variantSelected, this.#handleVariantSelected, { signal });
    target?.addEventListener('kauffman:open-notify-me', this.#handleNotifyOpenRequest, { signal });

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.cartError, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate, { signal });
    document.addEventListener('keyup', this.#handleKeyUp, { signal });

    this.#getInitialQuantity();
    this.#openNotifyPanelAfterSubmission();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#mainBottomObserver?.disconnect();
    this.#abortController.abort();
    if (this.#animationTimeout) {
      clearTimeout(this.#animationTimeout);
    }
  }

  /**
   * Sets up the IntersectionObserver to watch the buy buttons visibility
   */
  #setupIntersectionObserver() {
    const productForm = this.#getProductForm();
    if (!productForm) return;

    const buyButtonsBlock = productForm.closest('.buy-buttons-block');
    if (!buyButtonsBlock) return;

    // In themes migrated from 2.0, the footer element doesn't exist
    const footer = document.querySelector('footer') ?? document.querySelector('[class*="footer-group"]');
    if (!footer) return;

    // Observer for buy buttons visibility
    this.#buyButtonsIntersectionObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      // Only show sticky bar if buy buttons have been scrolled past (above viewport)
      if (!entry.isIntersecting && !this.#isStuck) {
        // Check if the element is above the viewport (scrolled past) or below (not yet reached)
        const rect = entry.target.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top < 0) {
          // Element is above viewport - show sticky bar
          this.#showStickyBar();
        }
        // If rect.top >= 0, element is below viewport - don't show sticky bar yet
      } else if (entry.isIntersecting && this.#isStuck) {
        this.#hiddenByBottom = false;
        this.#hideStickyBar();
      }
    });

    // Observer for footer visibility - hides sticky bar at page bottom
    this.#mainBottomObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) return;

        if (entry.isIntersecting && this.#isStuck) {
          this.#hiddenByBottom = true;
          this.#hideStickyBar();
        } else if (!entry.isIntersecting && this.#hiddenByBottom) {
          // Footer out of view - check if we should show sticky bar again
          const rect = buyButtonsBlock.getBoundingClientRect();
          // Only show if buy buttons are above the viewport (scrolled past)
          if (rect.bottom < 0 || rect.top < 0) {
            this.#hiddenByBottom = false;
            this.#showStickyBar();
          }
        }
      },
      {
        rootMargin: '200px 0px 0px 0px',
      }
    );

    this.#buyButtonsIntersectionObserver.observe(buyButtonsBlock);
    this.#mainBottomObserver.observe(footer);
    this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]');
  }

  // Public action handlers
  /**
   * Handles the add to cart button click in the sticky bar
   */
  handleAddToCartClick = async () => {
    if (this.dataset.variantAvailable !== 'true') {
      this.openNotifyPanel();
      return;
    }

    let cartAddStarted = true;

    if (this.#targetAddToCartButton) {
      this.#targetAddToCartButton.dataset.puppet = 'true';
      this.#targetAddToCartButton.click();
    } else {
      cartAddStarted = await this.#addCurrentVariantToCart();
    }

    if (!cartAddStarted) return;

    const cartIcon = document.querySelector('.header-actions__cart-icon');

    if (this.refs.addToCartButton.dataset.added !== 'true') {
      this.refs.addToCartButton.dataset.added = 'true';
    }

    if (this.#resetTimeout) clearTimeout(this.#resetTimeout);
    this.#resetTimeout = setTimeout(() => {
      this.refs.addToCartButton.removeAttribute('data-added');
    }, 800);

    if (!cartIcon || !this.refs.addToCartButton || !this.refs.productImage) return;

    const flyToCartElement = /** @type {FlyToCart} */ (document.createElement('fly-to-cart'));

    flyToCartElement.classList.add('fly-to-cart--sticky');
    flyToCartElement.style.setProperty('background-image', `url(${this.refs.productImage.src})`);
    flyToCartElement.useSourceSize = 'true';
    flyToCartElement.source = this.refs.productImage;
    flyToCartElement.destination = cartIcon;

    document.body.appendChild(flyToCartElement);

    await onAnimationEnd([this.refs.addToCartButton, flyToCartElement]);
  };

  /**
   * Opens the notify-me panel.
   * @param {{ focus?: boolean }} [options]
   */
  openNotifyPanel = (options = {}) => {
    const panel = this.querySelector('[ref="notifyPanel"]');
    const button = this.querySelector('[ref="addToCartButton"]');
    const emailInput = this.querySelector('[ref="notifyEmail"]');

    if (!(panel instanceof HTMLElement)) return;

    panel.hidden = false;
    button?.setAttribute('aria-expanded', 'true');

    if (options.focus !== false && emailInput instanceof HTMLInputElement) {
      requestAnimationFrame(() => emailInput.focus());
    }
  };

  /**
   * Closes the notify-me panel.
   */
  closeNotifyPanel = () => {
    const panel = this.querySelector('[ref="notifyPanel"]');
    const button = this.querySelector('[ref="addToCartButton"]');

    if (!(panel instanceof HTMLElement)) return;

    panel.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  };

  /**
   * Toggles the notify-me panel.
   */
  toggleNotifyPanel = () => {
    const panel = this.querySelector('[ref="notifyPanel"]');

    if (!(panel instanceof HTMLElement)) return;

    if (panel.hidden) {
      this.openNotifyPanel();
    } else {
      this.closeNotifyPanel();
    }
  };

  /**
   * Opens this component's notify panel when another in-section trigger requests it.
   * @param {CustomEvent<{ productId?: string | number }>} event
   */
  #handleNotifyOpenRequest = (event) => {
    const productId = event.detail?.productId;
    if (productId && String(productId) !== String(this.dataset.productId)) return;
    if (this.dataset.variantAvailable === 'true') return;

    this.openNotifyPanel();
  };

  /**
   * Handles variant update events
   * @param {CustomEvent} event - The variant update event
   */
  #handleVariantUpdate = (event) => {
    if (event.detail.data.productId !== this.dataset.productId) return;

    const variant = event.detail.resource;

    // Get the new sticky add to cart HTML from the server response
    const newStickyAddToCart = event.detail.data.html.querySelector('sticky-add-to-cart');
    if (!newStickyAddToCart) return;

    const newStickyBar = newStickyAddToCart.querySelector('[ref="stickyBar"]');
    if (!newStickyBar) return;

    // Store current visibility state before morphing
    const currentStickyBar = this.querySelector('[ref="stickyBar"]');
    const currentStuck = currentStickyBar?.getAttribute('data-stuck') || 'false';
    const notifyWasOpen = this.querySelector('[ref="notifyPanel"]')?.hasAttribute('hidden') === false;
    const variantAvailable = newStickyAddToCart.dataset.variantAvailable;

    // Morph the entire sticky bar content
    morph(this, newStickyAddToCart, { childrenOnly: true });

    // Restore visibility state after morphing
    const stickyBar = this.querySelector('[ref="stickyBar"]');
    stickyBar?.setAttribute('data-stuck', currentStuck);
    this.dataset.variantAvailable = variantAvailable;
    this.#syncNotifyPanelState(variantAvailable === 'true', notifyWasOpen);

    // Update the dataset attributes with new variant info
    if (variant && variant.id) {
      this.dataset.currentVariantId = variant.id;
    }

    // Re-cache the target add to cart button after morphing
    const productForm = this.#getProductForm();
    if (productForm) {
      this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]');
    }

    if (variant == null) {
      this.#handleVariantUnavailable();
    }
    // Restore the current quantity display if needed
    this.#updateButtonText();
  };

  /**
   * Handles variant selected events
   * @param {CustomEvent} event - The variant selected event
   */
  #handleVariantSelected = (event) => {
    // The variant update event will follow and handle all updates via morph
    // We just update the dataset here for tracking
    const variantId = event.detail.resource?.id;
    if (!variantId) return;
    this.dataset.currentVariantId = variantId;
  };

  /**
   * Updates the variant title based on selected options when the variant is unavailable
   */
  #handleVariantUnavailable = () => {
    this.dataset.currentVariantId = '';
    const variantTitleElement = this.querySelector('.sticky-add-to-cart__variant');
    const productId = this.dataset.productId;
    const variantPicker = document.querySelector(`variant-picker[data-product-id="${productId}"]`);
    if (!variantTitleElement || !variantPicker) return;

    const selectedOptions = Array.from(variantPicker.querySelectorAll('input:checked'))
      .map((option) => /** @type {HTMLInputElement} */ (option).value)
      .filter((value) => value !== '')
      .join(' / ');
    if (!selectedOptions) return;
    variantTitleElement.textContent = selectedOptions;
  };

  /**
   * Handles cart add complete (success or error) - resets puppet flag
   * @param {CustomEvent} _event - The cart event (unused)
   */
  #handleCartAddComplete = (_event) => {
    // Reset the puppet flag after cart operation
    if (this.#targetAddToCartButton) {
      this.#targetAddToCartButton.dataset.puppet = 'false';
    }
  };

  /**
   * Closes the notify panel with Escape.
   * @param {KeyboardEvent} event
   */
  #handleKeyUp = (event) => {
    if (event.key !== 'Escape') return;

    const panel = this.querySelector('[ref="notifyPanel"]');
    if (panel instanceof HTMLElement && !panel.hidden) {
      this.closeNotifyPanel();
      this.querySelector('[ref="addToCartButton"]')?.focus();
    }
  };

  /**
   * Handles quantity selector update events
   * @param {QuantitySelectorUpdateEvent} event - The quantity update event
   */
  #handleQuantityUpdate = (event) => {
    // Only respond to product page quantity selector updates, not cart drawer
    if (event.detail.cartLine) return;

    this.#currentQuantity = event.detail.quantity;
    this.#updateButtonText();
  };

  /**
   * Shows the sticky bar with animation
   */
  #showStickyBar() {
    const stickyBar = this.querySelector('[ref="stickyBar"]');
    if (!(stickyBar instanceof HTMLElement)) return;

    this.#isStuck = true;
    stickyBar.dataset.stuck = 'true';
  }

  /**
   * Hides the sticky bar with animation
   */
  #hideStickyBar() {
    const stickyBar = this.querySelector('[ref="stickyBar"]');
    if (!(stickyBar instanceof HTMLElement)) return;

    this.#isStuck = false;
    stickyBar.dataset.stuck = 'false';
  }

  // Helper methods
  /**
   * Gets the product form element
   * @returns {HTMLElement | null}
   */
  #getProductForm() {
    const productId = this.dataset.productId;
    if (!productId) return null;

    const sectionElement = this.closest('.shopify-section');
    if (!sectionElement) return null;

    const sectionId = sectionElement.id.replace('shopify-section-', '');
    return document.querySelector(
      `#shopify-section-${sectionId} product-form-component[data-product-id="${productId}"]`
    );
  }

  /**
   * Gets the initial quantity from the data attribute
   */
  #getInitialQuantity() {
    this.#currentQuantity = parseInt(this.dataset.initialQuantity || '1') || 1;
    this.#updateButtonText();
  }

  /**
   * Reopens the panel after Shopify returns customer form success or validation messages.
   */
  #openNotifyPanelAfterSubmission() {
    const panel = this.querySelector('[ref="notifyPanel"]');
    if (!(panel instanceof HTMLElement)) return;

    if (panel.querySelector('.sticky-add-to-cart__notify-message')) {
      this.openNotifyPanel({ focus: false });
    }
  }

  /**
   * Updates the button text to include quantity
   */
  #updateButtonText() {
    const addToCartButton = this.querySelector('[ref="addToCartButton"]');
    const quantityDisplay = this.querySelector('[ref="quantityDisplay"]');
    const quantityNumber = this.querySelector('[ref="quantityNumber"]');

    if (!(addToCartButton instanceof HTMLButtonElement) || !(quantityDisplay instanceof HTMLElement) || !quantityNumber) {
      return;
    }

    const available = this.dataset.variantAvailable === 'true' && !addToCartButton.disabled;

    // Update the quantity number
    quantityNumber.textContent = this.#currentQuantity.toString();

    // Show/hide the quantity display based on availability and quantity
    if (available && this.#currentQuantity > 1) {
      quantityDisplay.style.display = 'inline';
    } else {
      quantityDisplay.style.display = 'none';
    }
  }

  /**
   * Keeps notify UI closed for purchasable variants and optionally open after unavailable variant morphs.
   * @param {boolean} isAvailable
   * @param {boolean} notifyWasOpen
   */
  #syncNotifyPanelState(isAvailable, notifyWasOpen) {
    if (isAvailable) {
      this.closeNotifyPanel();
      return;
    }

    if (notifyWasOpen) {
      this.openNotifyPanel();
    } else {
      this.closeNotifyPanel();
    }
  }

  /**
   * Adds the current sticky variant directly when the main product form is not rendered.
   * @returns {Promise<boolean>}
   */
  async #addCurrentVariantToCart() {
    const variantId = this.dataset.currentVariantId;
    if (!variantId) return false;

    const formData = new FormData();
    formData.set('id', variantId);
    formData.set('quantity', this.#currentQuantity.toString());

    const sectionElement = this.closest('.shopify-section');
    const propertyInputs = sectionElement?.querySelectorAll('input[name^="properties["], textarea[name^="properties["], select[name^="properties["]');
    propertyInputs?.forEach((input) => {
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
      if (!input.name || input.value === '') return;
      formData.set(input.name, input.value);
    });

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionIds = [];
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        sectionIds.push(item.dataset.sectionId);
      }
    });

    if (sectionIds.length) {
      formData.append('sections', sectionIds.join(','));
    }

    try {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      });
      const data = await response.json();

      if (data.status) {
        this.dispatchEvent(new CartErrorEvent('sticky-add-to-cart', data.message, data.description, data.errors));
        return false;
      }

      const cart = await fetch('/cart.js').then((cartResponse) => cartResponse.json());
      this.dispatchEvent(
        new CartAddEvent(cart, variantId, {
          source: 'sticky-add-to-cart',
          itemCount: this.#currentQuantity,
          productId: this.dataset.productId,
          variantId,
          sections: data.sections,
        })
      );
      return true;
    } catch (error) {
      console.error(error);
      this.dispatchEvent(new CartErrorEvent('sticky-add-to-cart', 'Cart update failed', error, error));
      return false;
    }
  }
}

if (!customElements.get('sticky-add-to-cart')) {
  customElements.define('sticky-add-to-cart', StickyAddToCartComponent);
}
