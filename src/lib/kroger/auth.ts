import type { CachedToken, KrogerTokenResponse } from "./types.js";

const KROGER_TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";

// Buffer before expiry to avoid using a token that's about to expire
const EXPIRY_BUFFER_MS = 60_000; // 1 minute

/**
 * Manages OAuth2 client credentials tokens for the Kroger API.
 * Caches tokens in memory and refreshes them proactively before expiry.
 */
export class KrogerAuthManager {
  private clientId: string;
  private clientSecret: string;
  private cachedToken: CachedToken | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Get a valid access token, fetching a new one if needed.
   */
  async getToken(scope = "product.compact"): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.accessToken;
    }
    return this.fetchToken(scope);
  }

  /**
   * Fetch a new client credentials token from Kroger.
   */
  private async fetchToken(scope: string): Promise<string> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`
    ).toString("base64");

    const response = await fetch(KROGER_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Kroger token request failed (${response.status}): ${body}`
      );
    }

    const data = (await response.json()) as KrogerTokenResponse;

    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS,
    };

    return data.access_token;
  }
}

/**
 * Manages a user-level token (from authorization_code flow).
 * The MCP server receives this token from the environment or configuration.
 */
export class KrogerUserTokenManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private clientId: string;
  private clientSecret: string;

  constructor(
    clientId: string,
    clientSecret: string,
    accessToken?: string,
    refreshToken?: string
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    if (accessToken) {
      this.accessToken = accessToken;
      // Assume it's valid for 30 min from now if we don't know the exact expiry
      this.expiresAt = Date.now() + 1800 * 1000 - EXPIRY_BUFFER_MS;
    }
    if (refreshToken) {
      this.refreshToken = refreshToken;
    }
  }

  get isConfigured(): boolean {
    return this.accessToken !== null || this.refreshToken !== null;
  }

  /**
   * Get a valid user access token, refreshing if needed.
   */
  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken;
    }

    if (this.refreshToken) {
      return this.refresh();
    }

    throw new Error(
      "No valid user token available. User must authenticate with Kroger first."
    );
  }

  /**
   * Refresh the user token using the stored refresh token.
   */
  private async refresh(): Promise<string> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`
    ).toString("base64");

    const response = await fetch(KROGER_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.refreshToken!)}`,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Kroger token refresh failed (${response.status}): ${body}`
      );
    }

    const data = (await response.json()) as KrogerTokenResponse;

    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }

    return data.access_token;
  }
}
