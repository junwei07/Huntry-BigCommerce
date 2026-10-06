// GraphQL documents for registering this app's App Extension, shared by both
// the install-time call and the user-triggered retry action so they can't
// drift on what "this app's extension" is.
export const CREATE_APP_EXTENSION_MUTATION = `
  mutation AppExtension($input: CreateAppExtensionInput!) {
    appExtension {
      createAppExtension(input: $input) {
        appExtension {
          id
        }
      }
    }
  }
`;

export interface CreateAppExtensionResult {
  appExtension: {
    createAppExtension: {
      appExtension: {
        id: string;
      };
    };
  };
}

// Looks up this store's existing App Extensions. url is fetched alongside id
// since that's the only field identifying "this is the extension
// APP_EXTENSION_INPUT describes" short of user-visible, localizable label text.
export const APP_EXTENSIONS_QUERY = `
  query AppExtensions {
    store {
      appExtensions {
        edges {
          node {
            id
            url
          }
        }
      }
    }
  }
`;

export interface AppExtensionsResult {
  store: {
    appExtensions: {
      edges: Array<{
        node: {
          id: string;
          url: string;
        };
      }>;
    };
  };
}

// This app's one App Extension: a LINK-context link, shown on customer pages,
// that opens the Huntry admin experience. BigCommerce requires all four of
// context, model, url and label — an App Extension is always attached to an
// entity page (AppExtensionModel: CATEGORIES, CUSTOMERS, ORDERS, PRODUCTS,
// PRODUCT_DESCRIPTION), never a standalone nav entry (a missing `model` is
// rejected with a 400; see HBC-CHANGELOG.md's BC-HUN-012 correction). Players
// are customers, hence CUSTOMERS. `url` must be a plain path using
// BigCommerce's `${id}` template as a path segment: a query-string form
// (`/huntry?customerId=${id}`) was rejected with "URL field is incorrectly
// formatted", and every documented example is path-only. The route it lands
// on (app/store/[storeHash]/huntry/customers/[id]) currently just forwards to
// the Overview, leaving room for a per-player view later. label.locales is
// required by the schema despite being documented as optional — an empty
// array satisfies it since there's no localized text.
export const APP_EXTENSION_INPUT = {
  context: "LINK",
  model: "CUSTOMERS",
  url: "/huntry/customers/${id}",
  label: {
    defaultValue: "Huntry",
    locales: [],
  },
};
