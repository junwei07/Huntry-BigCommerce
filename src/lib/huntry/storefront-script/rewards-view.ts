import { MyRewardsResult } from "./api";
import { listingUrl } from "./cards-view";
import { HUNTRY_CARDS_CSS } from "./styles.generated";
import { StorefrontReward } from "./types";

// The "My rewards" page (BC-HUN-046), ported from the plugin's My Account tab
// (huntry/includes/claims/my-account.php, assets/js/huntry-my-rewards.js). Same
// rule as the other views: API text goes in via textContent only.
export const REWARDS_STRINGS = {
  title: "My Rewards",
  intro: "Here are the rewards you've claimed during the hunt!",
  empty: "You haven't claimed any rewards yet. Get out there and find some eggs!",
  guest: "Log in to see your rewards.",
  logIn: "Log In",
  error: "Couldn't load your rewards right now. Please try again later.",
  copy: "Copy",
  copied: "Copied!",
  claimedAt: "Claimed at:",
  expired: "Expired",
  validOn: "Valid on:",
  back: "Back to all hunts",
} as const;

function injectStyles(): void {
  if (document.querySelector("style[data-huntry-cards-css]")) return;

  const style = document.createElement("style");

  style.dataset.huntryCardsCss = "";
  style.textContent = HUNTRY_CARDS_CSS;
  document.head.appendChild(style);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

// navigator.clipboard needs a secure context; the textarea fallback covers
// plain-http dev stores, like the plugin's copy button.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);

      return true;
    }
  } catch {
    // fall through to the textarea path
  }

  const area = document.createElement("textarea");

  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function formatClaimedAt(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

// Plugin card layout (my-account.php L110-175): headline, reward name, then a
// code pill with Copy while the reward is open, or an "Expired" pill (and no
// product links) once it is not.
function buildCard(reward: StorefrontReward): HTMLElement {
  const expired = reward.expired === true;
  const card = element("div", expired ? "huntry-reward-card huntry-reward-card--expired" : "huntry-reward-card");
  const code = element("div", "huntry-reward-card__code");
  const when = formatClaimedAt(reward.claimedAt);

  card.append(element("h3", "huntry-reward-card__name", (!expired && reward.headline) || reward.rewardName));

  if (!expired && reward.headline) card.append(element("p", "huntry-reward-card__subtext", reward.rewardName));

  if (expired) {
    code.append(element("span", "huntry-reward-card__expired", REWARDS_STRINGS.expired));
  } else {
    const copy = element("button", "huntry-reward-card__copy", REWARDS_STRINGS.copy);

    copy.type = "button";
    copy.addEventListener("click", () => {
      void copyText(reward.couponCode).then((ok) => {
        if (!ok) return;

        copy.textContent = REWARDS_STRINGS.copied;
        window.setTimeout(() => {
          copy.textContent = REWARDS_STRINGS.copy;
        }, 1500);
      });
    });
    code.append(element("span", "", reward.couponCode), copy);
  }

  card.append(code);

  if (when) card.append(element("p", "huntry-reward-card__meta", `${REWARDS_STRINGS.claimedAt} ${when}`));

  if (!expired && reward.products?.length) {
    const valid = element("p", "huntry-reward-card__meta", `${REWARDS_STRINGS.validOn} `);

    // The server only sends same-origin paths; re-checked here since an href
    // from the API would otherwise be a script-injection sink.
    reward.products
      .filter((product) => /^\/(?!\/)/.test(product.url))
      .forEach((product, index) => {
        const link = element("a", "", product.name);

        link.href = product.url;

        if (index > 0) valid.append(", ");

        valid.append(link);
      });
    card.append(valid);
  }

  return card;
}

export function renderRewards(container: HTMLElement, result: MyRewardsResult): void {
  injectStyles();
  container.textContent = "";
  container.appendChild(element("h2", "huntry-rewards-title", REWARDS_STRINGS.title));

  if (result.kind === "guest") {
    const message = element("p", "huntry-cards-message", `${REWARDS_STRINGS.guest} `);
    const login = element("a", "", REWARDS_STRINGS.logIn);

    login.href = "/login.php";
    message.appendChild(login);
    container.appendChild(message);

    return;
  }

  if (result.kind === "error") {
    container.appendChild(element("p", "huntry-cards-message", REWARDS_STRINGS.error));

    return;
  }

  container.appendChild(element("p", "huntry-cards-message", REWARDS_STRINGS.intro));

  if (result.rewards.length === 0) {
    container.appendChild(element("p", "huntry-cards-message", REWARDS_STRINGS.empty));
  } else {
    const grid = element("div", "huntry-rewards");

    for (const reward of result.rewards) grid.appendChild(buildCard(reward));

    container.appendChild(grid);
  }

  const back = element("a", "", REWARDS_STRINGS.back);

  back.href = listingUrl();
  container.appendChild(back);
}
