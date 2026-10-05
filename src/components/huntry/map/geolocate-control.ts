import type { IControl } from "maplibre-gl";

export type GeolocateControlState = "idle" | "waiting" | "success" | "error";

const STATE_CLASSES = [
  "maplibregl-ctrl-geolocate-waiting",
  "maplibregl-ctrl-geolocate-active",
  "maplibregl-ctrl-geolocate-active-error",
];

// A stand-in for maplibregl.GeolocateControl: that control always calls
// window.navigator.geolocation directly (dist/maplibre-gl.mjs), which the
// BigCommerce iframe's Permissions Policy denies regardless of trigger
// method — see map-placement-view.tsx. This reuses its exact DOM structure
// and CSS classes (maplibre-gl.css, imported there) so it looks and
// animates identically, but hands click handling to the popup-relay flow.
export class HuntryGeolocateControl implements IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;

  constructor(private readonly onTrigger: () => void) {}

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "maplibregl-ctrl-geolocate";
    this.button.setAttribute("aria-label", "Find my location");
    this.button.addEventListener("click", this.onTrigger);

    const icon = document.createElement("span");
    icon.className = "maplibregl-ctrl-icon";
    icon.setAttribute("aria-hidden", "true");
    this.button.appendChild(icon);

    this.container.appendChild(this.button);

    return this.container;
  }

  onRemove(): void {
    this.button?.removeEventListener("click", this.onTrigger);
    this.container?.remove();
    this.container = null;
    this.button = null;
  }

  setState(state: GeolocateControlState): void {
    if (!this.button) {
      return;
    }

    this.button.classList.remove(...STATE_CLASSES);
    this.button.disabled = state === "waiting";

    if (state === "waiting") {
      this.button.classList.add("maplibregl-ctrl-geolocate-waiting");
    } else if (state === "success") {
      this.button.classList.add("maplibregl-ctrl-geolocate-active");
    } else if (state === "error") {
      this.button.classList.add("maplibregl-ctrl-geolocate-active-error");
    }
  }
}
