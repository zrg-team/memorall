/**
 * HTML parsing, supplied by the host.
 *
 * The web tools need to turn a fetched page into a document. `DOMParser` is a
 * browser global, and reaching for it directly would make this package
 * browser-only — it would import fine under Node and then fail the moment a
 * search or a page read ran. Every other capability here arrives through the
 * host, and parsing is no different.
 *
 * A browser host installs one line; a Node host installs whichever DOM
 * implementation it already depends on. Nothing here assumes either.
 */

export type HtmlParser = (html: string) => Document;

let installed: HtmlParser | null = null;

export const setHtmlParser = (parser: HtmlParser): void => {
  installed = parser;
};

export const hasHtmlParser = (): boolean => installed !== null;

export const parseHtmlDocument = (html: string): Document => {
  if (!installed) {
    throw new Error(
      "No HTML parser is installed. The host must call setHtmlParser() — a browser can pass " +
        "(html) => new DOMParser().parseFromString(html, 'text/html').",
    );
  }
  return installed(html || "<html><body></body></html>");
};
