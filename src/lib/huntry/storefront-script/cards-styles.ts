// Styles for the /huntry/ event-cards listing, injected by cards-view.ts. Kept
// small because they ship in the loader that runs on every storefront page, and
// scoped under .huntry-cards* so nothing leaks into the merchant's theme.
export const HUNTRY_CARDS_CSS = `
.huntry-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; margin: 16px 0; }
.huntry-card { display: flex; flex-direction: column; background: #fff; border: 1px solid #e3e3e8; border-radius: 12px; overflow: hidden; color: inherit; text-decoration: none; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.huntry-card:hover, .huntry-card:focus { box-shadow: 0 4px 14px rgba(0,0,0,.16); text-decoration: none; color: inherit; }
.huntry-card__banner { width: 100%; height: 140px; object-fit: cover; display: block; background: #f1f1f4; }
.huntry-card__body { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 16px; flex: 1; }
.huntry-card__pill { align-self: flex-start; padding: 2px 10px; border-radius: 999px; background: #22c55e; color: #fff; font: 700 12px/1.6 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .04em; }
.huntry-card__title { margin: 0; font: 700 18px/1.3 system-ui, sans-serif; }
.huntry-card__meta { margin: 0; color: #55556a; font: 14px/1.4 system-ui, sans-serif; }
.huntry-card__desc { margin: 0; font: 14px/1.5 system-ui, sans-serif; }
.huntry-card__cta { margin-top: auto; align-self: flex-start; padding: 8px 16px; border-radius: 8px; background: #0f1322; color: #fff; font: 700 14px/1.2 system-ui, sans-serif; }
.huntry-cards-message { margin: 24px 0; font: 16px/1.5 system-ui, sans-serif; }
.huntry-cards-message a { text-decoration: underline; }
`;
