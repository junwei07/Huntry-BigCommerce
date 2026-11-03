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

* **Marketing**: modify
* **Customers**: modify 
* **Content**: modify
* **Products**: read-only 
* **Information & Settings**: read-only 
* **Orders**: read-only
* **App Extensions**: manage
* **Checkout Content**: modify 
* **Checkout**: modify 
* **Carts**: read-only

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
