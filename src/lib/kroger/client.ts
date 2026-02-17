import { KrogerAuthManager, KrogerUserTokenManager } from "./auth.js";
import type {
  KrogerCartAddRequest,
  KrogerChainsResponse,
  KrogerLocationResponse,
  KrogerLocationsResponse,
  KrogerProductResponse,
  KrogerProductsResponse,
} from "./types.js";

const KROGER_BASE_URL = "https://api.kroger.com/v1";

export interface KrogerClientConfig {
  clientId: string;
  clientSecret: string;
  userAccessToken?: string;
  userRefreshToken?: string;
}

/**
 * Kroger API client that handles both app-level and user-level operations.
 */
export class KrogerClient {
  private auth: KrogerAuthManager;
  private userAuth: KrogerUserTokenManager;

  constructor(config: KrogerClientConfig) {
    this.auth = new KrogerAuthManager(config.clientId, config.clientSecret);
    this.userAuth = new KrogerUserTokenManager(
      config.clientId,
      config.clientSecret,
      config.userAccessToken,
      config.userRefreshToken
    );
  }

  // --- Products ---

  async searchProducts(params: {
    term: string;
    locationId?: string;
    brand?: string;
    fulfillment?: string;
    limit?: number;
    start?: number;
  }): Promise<KrogerProductsResponse> {
    const query = new URLSearchParams();
    query.set("filter.term", params.term);
    if (params.locationId) query.set("filter.locationId", params.locationId);
    if (params.brand) query.set("filter.brand", params.brand);
    if (params.fulfillment) query.set("filter.fulfillment", params.fulfillment);
    if (params.limit) query.set("filter.limit", String(params.limit));
    if (params.start) query.set("filter.start", String(params.start));

    return this.appRequest<KrogerProductsResponse>(
      `/products?${query.toString()}`
    );
  }

  async getProduct(
    productId: string,
    locationId?: string
  ): Promise<KrogerProductResponse> {
    const query = new URLSearchParams();
    if (locationId) query.set("filter.locationId", locationId);
    const qs = query.toString();
    const path = `/products/${encodeURIComponent(productId)}${qs ? `?${qs}` : ""}`;
    return this.appRequest<KrogerProductResponse>(path);
  }

  // --- Locations ---

  async searchLocations(params: {
    zipCode?: string;
    lat?: number;
    lon?: number;
    radiusInMiles?: number;
    chain?: string;
    limit?: number;
    department?: string;
  }): Promise<KrogerLocationsResponse> {
    const query = new URLSearchParams();
    if (params.zipCode) query.set("filter.zipCode.near", params.zipCode);
    if (params.lat !== undefined)
      query.set("filter.lat.near", String(params.lat));
    if (params.lon !== undefined)
      query.set("filter.lon.near", String(params.lon));
    if (params.radiusInMiles)
      query.set("filter.radiusInMiles", String(params.radiusInMiles));
    if (params.chain) query.set("filter.chain", params.chain);
    if (params.limit) query.set("filter.limit", String(params.limit));
    if (params.department) query.set("filter.department", params.department);

    return this.appRequest<KrogerLocationsResponse>(
      `/locations?${query.toString()}`
    );
  }

  async getLocation(locationId: string): Promise<KrogerLocationResponse> {
    return this.appRequest<KrogerLocationResponse>(
      `/locations/${encodeURIComponent(locationId)}`
    );
  }

  // --- Chains ---

  async getChains(): Promise<KrogerChainsResponse> {
    return this.appRequest<KrogerChainsResponse>("/chains");
  }

  // --- Cart ---

  async addToCart(items: KrogerCartAddRequest): Promise<void> {
    if (!this.userAuth.isConfigured) {
      throw new Error(
        "Cart operations require a user token. Set KROGER_USER_ACCESS_TOKEN or authenticate via OAuth."
      );
    }

    const token = await this.userAuth.getToken();

    const response = await fetch(`${KROGER_BASE_URL}/cart/add`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(items),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Kroger cart add failed (${response.status}): ${body}`
      );
    }
  }

  // --- Internal helpers ---

  private async appRequest<T>(path: string): Promise<T> {
    const token = await this.auth.getToken();

    const response = await fetch(`${KROGER_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Kroger API error (${response.status}) for ${path}: ${body}`
      );
    }

    return response.json() as Promise<T>;
  }
}
