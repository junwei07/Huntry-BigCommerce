# BigCommerce Starter Single-Click App

A Next.js starter for building a BigCommerce single-click 
app — an app a merchant installs from their store's control panel with one
click, which then runs inside that control panel and manages the merchant's
store data on their behalf.

The starter provides the layers every such app needs: the OAuth install and
launch flow, session management and per-request authorization, per-store
credential storage, BigCommerce REST and GraphQL API clients with rate-limit
and timeout handling, caching, and error handling. The Huntry events feature
(`src/components/huntry`, `src/lib/huntry`) is built on top of those layers.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and the
reasoning behind it — data modes, the install/session flow, two-tier
authorization, credentials storage, the API clients, caching, and error
handling.

## The BigCommerce Developer Portal

A single-click app isn't just a deployed web application; it's an app **registered with
BigCommerce**. Registration happens in the
[BigCommerce developer portal](https://build.bigcommerce.com/), and it's
what makes an app installable into a store.

The portal is where you:

* Create the app record and get its **Client ID** and **Client Secret**, the
  credentials this app uses to exchange an install code for a store access
  token.
* Declare the app's **callback URLs** — the endpoints BigCommerce calls to
  install the app (`/api/app/auth`), launch it (`/api/app/load`), and notify
  it of removals (`/api/app/uninstall`, `/api/app/remove_user`). These map
  directly to the route handlers in `src/app/api/app/`.
* Choose the **OAuth scopes** the app requests, which bound what its access
  token can do.

Creating a developer portal account is free and doesn't require a
partnership (that's only needed to publish to the BigCommerce App
Marketplace). You'll also want a sandbox or trial store you can install
into. See BigCommerce's
[Beginning App Development](https://docs.bigcommerce.com/developer/docs/integrations/apps/guide/beginning-development)
and [Single-Click App OAuth Flow](https://docs.bigcommerce.com/developer/docs/integrations/apps/guide/auth)
for the wider context.

You can get started with this app without the Developer Portal dependency, but the full functionality exists for the context of a single-click app.

## Using This App

This app is intended as an example, tutorial, and starter. Choose the path that best fits your goals:

### Option 1: Run the Example App

If you just want a quick start with the fully functional Huntry app (in MOCK data mode),
you can clone and run the app in a few easy steps.

See [docs/RUN-EXAMPLE-APP.md](docs/RUN-EXAMPLE-APP.md) for quick setup instructions, which detail the configuration steps
to go from a dependency-free start with mock records all the way through a functional single-click app connected to your
own store's data.


### Option 2: Use the App as a Tutorial

Rather than reading the finished code, you can build it. To install starting boilerplate and then explore the step-by-step process of adding critical functionality (like BigDesign-based UI, REST API calls, and authentication/session management), start with [docs/TUTORIAL.md](docs/TUTORIAL.md).

### Option 3: Use the App as a Starter

This starter app clearly separates its example use case from core libraries that support authentication, storage, session management, and BigCommerce API interactions.

If you just want to get started building your own app on this foundation, follow [docs/USING-AS-A-STARTER.md](docs/USING-AS-A-STARTER.md) for a guide on what to remove and update.

## The Huntry Feature

The app's feature is Huntry, a migration of a legacy WordPress events plugin:
events, rewards, sponsors, featured placements, a map, and player claims,
managed from an admin UI inside the BigCommerce control panel. See
[docs/MIGRATION.md](docs/MIGRATION.md) for the design and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the non-obvious decisions in
the underlying layers. The starter's original gift certificates example has
been removed; [docs/TUTORIAL.md](docs/TUTORIAL.md) and
[docs/USING-AS-A-STARTER.md](docs/USING-AS-A-STARTER.md) remain as starter
history.

## Hosting Provider Support

The app comes with built-in scaffolding supporting multiple
hosting providers. See the dedicated guides:

- [Vercel Deployment Guide](./docs/VERCEL-DEPLOYMENT.md)
