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

// This app's one App Extension: a top-level LINK-context menu item that
// opens the Huntry admin experience. Unlike a record-scoped extension
// (e.g. one on a customer detail page), a top-level link isn't attached to
// a resource type, so there's no `model` field here. label.locales is
// required by the schema despite being documented as optional — an empty
// array satisfies it since there's no localized text.
export const APP_EXTENSION_INPUT = {
  context: "LINK",
  url: "/huntry",
  label: {
    defaultValue: "Huntry",
    locales: [],
  },
};
