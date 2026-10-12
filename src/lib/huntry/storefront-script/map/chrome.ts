import { endsCountdown } from "../cards";
import { HUNTRY_FULLSCREEN_CSS } from "../styles.generated";

// The fullscreen takeover for one event's map, the counterpart of the
// WordPress plugin's templates/huntry-fullscreen.php: a title bar with a back
// link and an "Ends in" countdown over a map that fills the viewport. Stencil
// has no template swap, so it is a fixed overlay above the theme.
export interface FullscreenOptions {
  title: string;
  backHref: string;
  endsAt: string | null;
  // Admin-chosen event colour. Only a plain hex value is ever used, so it
  // can't smuggle anything else into a style attribute.
  primaryColor: string | null;
}

export interface Fullscreen {
  // The element maplibre should render into.
  mapHost: HTMLElement;
  restore: () => void;
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

export function safeColor(value: string | null | undefined): string | null {
  return value && HEX_COLOR.test(value) ? value : null;
}

function injectShellStyles(): void {
  if (document.querySelector("style[data-huntry-fullscreen-css]")) return;

  const style = document.createElement("style");

  style.dataset.huntryFullscreenCss = "";
  style.textContent = HUNTRY_FULLSCREEN_CSS;
  document.head.appendChild(style);
}

export function enterFullscreen(container: HTMLElement, options: FullscreenOptions): Fullscreen {
  injectShellStyles();

  // position: fixed is relative to the nearest ancestor with a transform,
  // filter or contain, and Stencil themes often have one around the page
  // content, which would clip the overlay to the content column. Moving the
  // container to <body> avoids that; a comment node marks where it came from.
  const anchor = document.createComment("huntry-map");
  const parent = container.parentNode;
  const previousOverflow = document.body.style.overflow;
  const color = safeColor(options.primaryColor);

  parent?.insertBefore(anchor, container);
  document.body.appendChild(container);
  document.body.style.overflow = "hidden";

  container.textContent = "";
  container.classList.add("huntry-fullscreen");

  const header = document.createElement("div");
  const back = document.createElement("a");
  const title = document.createElement("h1");
  const countdown = document.createElement("span");
  const mapHost = document.createElement("div");

  header.className = "huntry-fullscreen__header";
  back.className = "huntry-fullscreen__back";
  back.href = options.backHref;
  back.setAttribute("aria-label", "Back to all hunts");
  back.textContent = "←";
  title.className = "huntry-fullscreen__title";
  title.textContent = options.title;
  countdown.className = "huntry-fullscreen__countdown";
  mapHost.className = "huntry-fullscreen__map";

  if (color) {
    countdown.style.background = color;
  }

  header.append(back, title);
  container.append(header, countdown, mapHost);

  const tick = () => {
    const text = endsCountdown(options.endsAt, Date.now());

    countdown.textContent = text ?? "";
    countdown.hidden = text === null;
  };
  const timer = window.setInterval(tick, 1000);

  tick();

  return {
    mapHost,
    restore: () => {
      window.clearInterval(timer);
      document.body.style.overflow = previousOverflow;
      container.classList.remove("huntry-fullscreen");
      anchor.parentNode?.insertBefore(container, anchor);
      anchor.remove();
    },
  };
}
