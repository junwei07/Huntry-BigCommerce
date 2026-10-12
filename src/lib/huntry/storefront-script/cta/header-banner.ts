import { formatCountdown } from "../map-utils";
import { HUNTRY_CTA_CSS } from "../styles.generated";
import { StorefrontCtaData } from "../types";
import {
  BRAND_WORD,
  buildSlides,
  cssUrl,
  DEFAULT_BANNER_TEXT,
  HeaderSlide,
  slideState,
} from "./model";

// The storefront header banner (BC-HUN-038): a port of the WordPress plugin's
// header carousel (huntry/includes/frontend/cta.php huntry_render_header_cta,
// assets/js/huntry.js), with one slide per live event. Everything from the API
// is set with textContent or a property, never innerHTML.
const SLIDE_INTERVAL_MS = 6000;
const TRANSITION_RESET_MS = 520;
export const HEADER_MARKER = "header";

export function injectCtaStyles(): void {
  if (document.querySelector("style[data-huntry-cta-css]")) return;

  const style = document.createElement("style");

  style.dataset.huntryCtaCss = "";
  style.textContent = HUNTRY_CTA_CSS;
  document.head.appendChild(style);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

interface BuiltSlide {
  node: HTMLElement;
  update: (now: number) => void;
}

// `duplicate` is the trailing clone that makes the wrap-around keep sliding
// forward; it is hidden from assistive tech and the tab order.
function buildSlide(slide: HeaderSlide, data: StorefrontCtaData, duplicate: boolean): BuiltSlide {
  const node = element("div", "huntry-header__slide");
  const inner = element("div", "huntry-header__inner");
  const center = element("div", "huntry-header__center");
  const textContainer = element("div", "huntry-header__text-container");
  const button = element("a", "huntry-header__button");
  const liveDot = element("span", "huntry-header__live-indicator");
  const endsContainer = element("div", "huntry-header__countdown-end-container");
  const endsValue = element("span", "huntry-countdown-end");

  if (slide.accent) node.style.setProperty("--huntry-event-theme-primary-base", slide.accent);
  if (slide.background) node.style.setProperty("--huntry-event-theme-primary-dark", slide.background);

  // Only show the picture once it has loaded; otherwise the themed solid
  // background stays (a blocked or missing image must not leave a hole).
  if (slide.imageUrl) {
    const probe = new Image();

    probe.onload = () => {
      node.style.setProperty("--huntry-header-banner", cssUrl(slide.imageUrl as string));
      node.className = "huntry-header__slide huntry-header__slide--has-banner";
    };
    probe.src = slide.imageUrl;
  }

  // A custom description replaces the whole default line, as in the plugin.
  if (data.banner.description) {
    textContainer.appendChild(element("span", "huntry-header__text", data.banner.description));
  } else {
    textContainer.appendChild(element("span", "huntry-header__text", DEFAULT_BANNER_TEXT.trim()));
    textContainer.appendChild(document.createTextNode(" "));
    textContainer.appendChild(element("span", "huntry-header__text-orange", BRAND_WORD));
  }

  button.href = slide.href;
  button.setAttribute("aria-label", `Join the hunt: ${slide.name}`);

  if (duplicate) {
    node.setAttribute("aria-hidden", "true");
    button.setAttribute("tabindex", "-1");
  }

  if (data.banner.logoUrl) {
    const logo = element("img", "huntry-header__button-icon");

    logo.alt = "Huntry";
    logo.onerror = () => {
      logo.hidden = true;
    };
    logo.src = data.banner.logoUrl;
    button.appendChild(logo);
  }

  liveDot.appendChild(element("span", "huntry-header__live-dot"));
  button.appendChild(liveDot);
  button.appendChild(element("span", "huntry-header__button-text", "LIVE · JOIN NOW"));
  button.appendChild(element("span", "huntry-header__button-arrow", "→"));

  center.appendChild(textContainer);
  center.appendChild(button);
  inner.appendChild(center);

  endsContainer.appendChild(element("span", "huntry-header__countdown-label", "Ends in"));
  endsContainer.appendChild(endsValue);
  inner.appendChild(endsContainer);
  node.appendChild(inner);

  return {
    node,
    update(now) {
      const state = slideState(slide, now, formatCountdown);

      endsContainer.hidden = state.endsText === null;

      if (state.endsText !== null) endsValue.textContent = state.endsText;
    },
  };
}

// Mounts the banner and keeps it running for the life of the page. Returns
// without mounting when no event is live (nothing worth advertising).
export function mountHeaderBanner(data: StorefrontCtaData): void {
  if (!document.body || document.querySelector('[data-huntry-cta="header"]')) return;

  let slides = buildSlides(data, Date.now());

  if (slides.length === 0) return;

  injectCtaStyles();

  let root: HTMLElement | null = null;
  let built: BuiltSlide[] = [];
  let track: HTMLElement | null = null;
  let dots: HTMLButtonElement[] = [];
  let activeIndex = 0;
  let tickTimer: number | undefined;
  let advanceTimer: number | undefined;

  const stopTimers = () => {
    window.clearInterval(tickTimer);
    window.clearInterval(advanceTimer);
    advanceTimer = undefined;
  };

  const tick = () => {
    if (document.hidden) return;

    const now = Date.now();

    // An event ended since the banner was drawn: redraw without it (or remove
    // the banner when none are left).
    if (buildSlides(data, now).length !== slides.length) {
      render();

      return;
    }

    built.forEach((slide) => slide.update(now));
  };

  const showSlide = (index: number) => {
    activeIndex = index;

    if (track) track.style.transform = `translateX(-${index * 100}%)`;

    dots.forEach((dot, dotIndex) => dot.classList.toggle("is-active", dotIndex === index));
    tick();
  };

  const advance = () => {
    if (document.hidden || !track) return;

    if (activeIndex < slides.length - 1) {
      showSlide(activeIndex + 1);

      return;
    }

    // Wrap forward onto the trailing clone (same leftward motion), then snap
    // back to the real first slide without animating.
    activeIndex = 0;
    dots.forEach((dot, dotIndex) => dot.classList.toggle("is-active", dotIndex === 0));
    track.style.transform = `translateX(-${slides.length * 100}%)`;
    tick();

    const snapTrack = track;

    window.setTimeout(() => {
      snapTrack.style.transition = "none";
      snapTrack.style.transform = "translateX(0%)";
      void snapTrack.offsetHeight;
      snapTrack.style.transition = "";
    }, TRANSITION_RESET_MS);
  };

  const restartAdvance = () => {
    window.clearInterval(advanceTimer);
    advanceTimer = slides.length > 1 ? window.setInterval(advance, SLIDE_INTERVAL_MS) : undefined;
  };

  function render(): void {
    stopTimers();
    root?.remove();
    root = null;
    slides = buildSlides(data, Date.now());

    if (slides.length === 0) return;

    const carousel = slides.length > 1;
    const frame = element("div", carousel ? "huntry-header huntry-header--carousel" : "huntry-header");
    const viewport = element("div", "huntry-header__slides");

    track = element("div", "huntry-header__slides-track");
    built = slides.map((slide) => buildSlide(slide, data, false));

    for (const slide of built) track.appendChild(slide.node);

    if (carousel) {
      const clone = buildSlide(slides[0], data, true);

      built.push(clone);
      track.appendChild(clone.node);
    }

    viewport.appendChild(track);
    frame.appendChild(viewport);
    frame.dataset.huntryCta = HEADER_MARKER;

    dots = [];

    if (carousel) {
      const dotRow = element("div", "huntry-header__dots");

      slides.forEach((slide, index) => {
        const dot = element("button", index === 0 ? "huntry-header__dot is-active" : "huntry-header__dot");

        dot.type = "button";
        dot.setAttribute("aria-label", `Show ${slide.name}`);
        dot.addEventListener("click", () => {
          showSlide(index);
          restartAdvance();
        });
        dots.push(dot);
        dotRow.appendChild(dot);
      });

      frame.appendChild(dotRow);
    }

    activeIndex = 0;
    root = frame;
    document.body.insertBefore(frame, document.body.firstChild);
    built.forEach((slide) => slide.update(Date.now()));
    tickTimer = window.setInterval(tick, 1000);
    restartAdvance();
  }

  render();
}
