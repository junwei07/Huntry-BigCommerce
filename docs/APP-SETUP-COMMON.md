# BigCommerce App Setup: Callbacks, Scopes, and Secrets

Shared across the BigCommerce app setup guides —
[LOCAL-SINGLE-CLICK-APP.md](./LOCAL-SINGLE-CLICK-APP.md) and
[VERCEL-DEPLOYMENT.md](./VERCEL-DEPLOYMENT.md) — since the
developer-portal callback URLs, scopes, and secret-generation command are
identical regardless of where `<APP_ORIGIN>` points.

## Callback URLs

On the **Technical** tab, set the callback URLs, substituting your current
`<APP_ORIGIN>` (tunnel URL, Vercel production URL, or Worker URL):

| Callback | URL |
| --- | --- |
| Auth | `<APP_ORIGIN>/api/app/auth` |
| Load | `<APP_ORIGIN>/api/app/load` |
| Uninstall | `<APP_ORIGIN>/api/app/uninstall` |
| Remove User | `<APP_ORIGIN>/api/app/remove_user` |

These paths are the four route handlers under `src/app/api/app/`. The Auth
callback URL must match `APP_ORIGIN` exactly, since the app sends it back to
BigCommerce as the OAuth `redirect_uri` during the token exchange and
BigCommerce rejects a mismatch.

## Scopes

On the **Scopes** tab, enable at minimum:

* **Marketing**: modify (gates the Promotions v3 + coupon-code APIs —
  there is no separate "Promotions" scope)
* **Customers**: modify (the Customer Group eligibility mechanism — see
  `docs/MIGRATION.md` §2)
* **Content**: modify
* **Products**: read-only (gates `GET /v3/catalog/products`, used by the
  reward product picker — a distinct scope from Customers; conflating the
  two caused a live 403 the first time the picker was exercised, see
  `HBC-CHANGELOG.md`'s BC-HUN-019 entry)
* **Storefront API Customer Impersonation Tokens**: required for
  `customer/current.jwt`
* **Orders**: read-only (gates webhook registration for
  `store/order/created` and the order re-fetch it triggers — there is no
  separate "Webhooks" scope)
* **App Extensions**: manage
* **Checkout Content**: modify (`store_content_checkout`; BC-HUN-051 — lets
  the storefront script load on `/checkout`, where it shows "Invalid coupon
  usage"). Needed **in addition to** Checkout below, not instead of it.
* **Checkout**: modify (`store_checkout` — **not** "Checkout Content", a
  different scope that does not unlock `/v3/checkouts`; BC-HUN-049: removes a reward code from a cart that
  isn't its claimer's, and re-reads the checkout; also confirm whether
  **Carts**: read-only is needed for the `store/cart/couponApplied` webhook —
  see the scope table under "Required OAuth Scopes" in `docs/MIGRATION.md`). Stores installed before this scope
  was added must reauthorize.

Scope changes only take effect for a store on the next install, so if you
change them later, uninstall and reinstall the app.

## Generating Secrets

`SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` are both generated the
same way:

```shell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Run it once per variable so they get different values — `SESSION_SECRET`
signs this app's own session cookie, `CREDENTIALS_ENCRYPTION_KEY` encrypts
stored access tokens at rest, and neither is interchangeable with
`BIGCOMMERCE_CLIENT_SECRET`, which is only used to verify BigCommerce's
inbound signed payloads. Use fresh values per environment rather than
reusing ones from another environment, and treat them as production
secrets once deployed — changing `CREDENTIALS_ENCRYPTION_KEY` later makes
every already-stored token undecryptable, forcing every store to reinstall.
