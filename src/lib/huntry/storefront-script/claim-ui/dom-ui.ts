import { safeColor } from "../map/chrome";
import { loginUrl } from "../page-mode";
import type { BlockedView, ClaimedView, ClaimUi, FoundView } from "./controller";
import { STRINGS } from "./outcomes";
import { CLAIM_UI_CSS } from "../styles.generated";

// The DOM half of the claim flow. Everything here is built with createElement +
// textContent only, never parsed as markup: reward names and coupon codes are
// admin-authored and this runs on the merchant's origin.
const SVG_NS = "http://www.w3.org/2000/svg";
const BELL_PATH =
  "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

function button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", `huntry-claim-dialog__button huntry-claim-dialog__button--${variant}`, label);

  node.type = "button";
  node.addEventListener("click", onClick);

  return node;
}

function injectStyles(): void {
  if (document.querySelector("style[data-huntry-claim-css]")) return;

  const style = document.createElement("style");

  style.dataset.huntryClaimCss = "";
  style.textContent = CLAIM_UI_CSS;
  document.head.appendChild(style);
}

// The guest gate for a live event's map (legacy: showLoginPrompt in
// huntry-frontend-map.js). A modal with no dismiss: the map is never loaded for
// a guest; it sits over the fullscreen shell, whose ← link is the way back.
export function showJoinPrompt(successColor: string | null = null): void {
  injectStyles();

  const overlay = el("div", "huntry-claim-overlay");
  const card = el("div", "huntry-claim-dialog");
  const wrap = el("div", "huntry-claim-dialog__content");
  const login = el("a", "huntry-claim-dialog__button huntry-claim-dialog__button--claim", STRINGS.logIn);
  const color = safeColor(successColor);

  if (color) overlay.style.setProperty("--huntry-claim-success", color);

  login.href = loginUrl();
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  wrap.append(el("p", "huntry-claim-dialog__message", STRINGS.joinHunt), login);
  card.appendChild(wrap);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// The player-cap gate for a live event's map: a new customer arriving at a full
// hunt gets this instead of the map. Same no-dismiss modal as showJoinPrompt,
// with a way back to the hunts list.
export function showHuntFullPrompt(backHref: string, successColor: string | null = null): void {
  injectStyles();

  const overlay = el("div", "huntry-claim-overlay");
  const card = el("div", "huntry-claim-dialog");
  const wrap = el("div", "huntry-claim-dialog__content");
  const back = el("a", "huntry-claim-dialog__button huntry-claim-dialog__button--claim", STRINGS.backToEvents);
  const color = safeColor(successColor);

  if (color) overlay.style.setProperty("--huntry-claim-success", color);

  back.href = backHref;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  wrap.append(
    el("div", "huntry-claim-dialog__icon", "🙁"),
    el("h2", "huntry-claim-dialog__title", STRINGS.huntFullTitle),
    el("p", "huntry-claim-dialog__message", STRINGS.huntFull),
    back,
  );
  card.appendChild(wrap);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

export interface DomUiOptions {
  container: HTMLElement;
  successColor: string | null;
  backHref: string;
  // The "My rewards" page (BC-HUN-046).
  rewardsHref: string;
  onBellClick: () => void;
  // The map's top-right control stack; null until the map has mounted.
  addMapControl: (element: HTMLElement) => void;
}

export interface DomUi extends ClaimUi {
  mountBell: () => void;
}

export function createDomUi(options: DomUiOptions): DomUi {
  injectStyles();

  const color = safeColor(options.successColor);
  const overlay = el("div", "huntry-claim-overlay");
  const card = el("div", "huntry-claim-dialog");
  let open = false;
  let limit: HTMLElement | null = null;

  overlay.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  overlay.appendChild(card);

  if (color) overlay.style.setProperty("--huntry-claim-success", color);

  document.body.appendChild(overlay);

  const show = (content: HTMLElement) => {
    card.textContent = "";
    card.appendChild(content);
    overlay.hidden = false;
    open = true;
  };
  const hide = () => {
    overlay.hidden = true;
    card.textContent = "";
    open = false;
  };
  const content = () => el("div", "huntry-claim-dialog__content");
  const icon = (symbol: string) => el("div", "huntry-claim-dialog__icon", symbol);
  const title = (text: string) => el("h2", "huntry-claim-dialog__title", text);
  const message = (text: string) => el("p", "huntry-claim-dialog__message", text);
  const fullButton = (label: string, onClick: () => void) => {
    const node = button(label, "claim", onClick);

    node.classList.add("huntry-claim-dialog__button--full");

    return node;
  };

  let badge: HTMLElement | null = null;
  let bellMounted = false;
  let rewardsLink: HTMLAnchorElement | null = null;

  return {
    isOpen: () => open,

    setRewardsLink(visible) {
      if (!rewardsLink) {
        if (!visible) return;

        rewardsLink = el("a", "huntry-view-rewards", STRINGS.myRewards);
        rewardsLink.href = options.rewardsHref;

        if (color) rewardsLink.style.setProperty("--huntry-claim-success", color);

        document.body.appendChild(rewardsLink);
      }

      rewardsLink.hidden = !visible;
    },

    showFound(view: FoundView) {
      const wrap = content();
      const note = el("p", "huntry-claim-dialog__status");
      const skip = button(STRINGS.skip, "skip", () => {
        hide();
        view.onSkip();
      });
      const claim = button(STRINGS.claim, "claim", () => {
        view.onClaim({
          setBusy: (busy) => {
            claim.disabled = busy;
            skip.disabled = busy;
            claim.textContent = busy ? STRINGS.claiming : STRINGS.claim;
          },
          setMessage: (text) => {
            note.textContent = text;
          },
        });
      });
      const actions = el("div", "huntry-claim-dialog__actions");

      actions.append(skip, claim);
      wrap.append(
        icon("⭐"),
        title(STRINGS.foundTitle),
        message(STRINGS.foundMessage(Math.round(view.distanceMeters))),
        note,
        actions,
      );
      show(wrap);
    },

    showClaimed(view: ClaimedView) {
      const wrap = content();
      const card2 = el("div", "huntry-claim-dialog__card");
      const code = el("p", "huntry-claim-dialog__code");
      const codeText = document.createElement("strong");
      const cartStatus = el("p", "huntry-claim-dialog__cart-status");

      codeText.textContent = view.couponCode;
      code.append(`${STRINGS.useCode} `, codeText, ` ${STRINGS.atCheckout}`);
      card2.append(el("strong", "", STRINGS.newReward));

      if (view.rewardName) card2.append(el("p", "huntry-claim-dialog__reward-title", view.rewardName));

      card2.append(code, el("p", "huntry-claim-dialog__message", STRINGS.savedToRewards));

      const apply = fullButton(STRINGS.applyToCart, () => {
        apply.disabled = true;
        apply.textContent = STRINGS.applying;
        cartStatus.textContent = "";

        void view.applyToCart().then((result) => {
          apply.textContent = STRINGS.applyToCart;

          switch (result.kind) {
            case "applied": {
              const link = el("a", "", STRINGS.viewCart);

              link.href = "/cart.php";
              cartStatus.textContent = "Applied to your cart. ";
              cartStatus.append(link);
              apply.hidden = true;
              return;
            }
            case "no-cart":
              cartStatus.textContent = "Add something to your cart first, then tap Apply again.";
              break;
            case "rejected":
              cartStatus.textContent = result.message;
              break;
            case "error":
              cartStatus.textContent = "Couldn't reach your cart. Please try again.";
              break;
          }

          apply.disabled = false;
        });
      });
      const keep = fullButton(STRINGS.keepHunting, () => {
        hide();
        view.onKeepHunting();
      });

      keep.classList.remove("huntry-claim-dialog__button--claim");
      keep.classList.add("huntry-claim-dialog__button--skip");
      wrap.append(icon("🎉"), title(STRINGS.claimedTitle), card2, apply, cartStatus, keep);
      show(wrap);
    },

    showBlocked(view: BlockedView) {
      const wrap = content();

      wrap.append(
        icon(view.icon),
        title(view.title),
        message(view.message),
        fullButton(STRINGS.keepHunting, () => {
          hide();
          view.onDismiss();
        }),
      );
      show(wrap);
    },

    showLogin(onBack) {
      const wrap = content();
      const login = el("a", "huntry-claim-dialog__button huntry-claim-dialog__button--claim", STRINGS.logIn);

      // BigCommerce's own login page, not a Google flow.
      login.href = loginUrl();
      wrap.append(
        message(STRINGS.logInToClaim),
        login,
        button(STRINGS.back, "skip", () => {
          hide();
          onBack();
        }),
      );
      show(wrap);
    },

    showLimit() {
      hide();

      if (!limit) {
        limit = el("div", "huntry-claim-limit");

        const inner = el("div", "huntry-claim-limit__content");
        const back = el("a", "huntry-claim-limit__button", STRINGS.backToHunts);
        const rewards = el("a", "huntry-claim-limit__button", STRINGS.viewRewards);

        back.href = options.backHref;
        rewards.href = options.rewardsHref;
        inner.append(
          el("h2", "huntry-claim-limit__title", STRINGS.limitTitle),
          el("p", "huntry-claim-limit__message", STRINGS.limitMessage),
          rewards,
          back,
        );
        limit.appendChild(inner);

        const successColor = safeColor(options.successColor);

        if (successColor) limit.style.setProperty("--huntry-claim-success", successColor);

        options.container.appendChild(limit);
      }

      limit.hidden = false;
    },

    setBadge(visible) {
      if (badge) badge.hidden = !visible;
    },

    mountBell() {
      if (bellMounted) return;

      bellMounted = true;

      const wrap = el("div", "maplibregl-ctrl maplibregl-ctrl-group huntry-notification-ctrl");
      const bell = el("button", "huntry-notification-button");
      const svg = document.createElementNS(SVG_NS, "svg");
      const path = document.createElementNS(SVG_NS, "path");

      bell.type = "button";
      bell.setAttribute("aria-label", STRINGS.skippedItems);
      svg.setAttribute("class", "huntry-notification-icon");
      svg.setAttribute("viewBox", "0 0 24 24");
      path.setAttribute("d", BELL_PATH);
      svg.appendChild(path);
      badge = el("span", "huntry-notification-badge");
      badge.hidden = true;
      bell.append(svg, badge);
      bell.addEventListener("click", options.onBellClick);
      wrap.appendChild(bell);
      options.addMapControl(wrap);
    },
  };
}
