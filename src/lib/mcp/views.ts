import type { ConnectedApp, OAuthApp } from "@/lib/auth/oauth-consent";

// What the AI assistant settings and the OAuth consent page send to the browser (security plan S9).
// Each view copies the fields a screen reads, by name, so a field the provider adds never reaches a
// response by accident. The scopes and logo URI the provider reports aren't shown anywhere.

/** An app as the consent page and the connected-apps list show it: its name is a claim, its URI a hint. */
export type OAuthAppView = Pick<OAuthApp, "clientId" | "name" | "uri">;

/** A connected app in Settings, with when the caller allowed it. */
export type ConnectedAppView = OAuthAppView & Pick<ConnectedApp, "connectedAt">;

export function oauthAppView({ clientId, name, uri }: OAuthApp): OAuthAppView {
  return { clientId, name, uri };
}

export function connectedAppView(app: ConnectedApp): ConnectedAppView {
  return { ...oauthAppView(app), connectedAt: app.connectedAt };
}
