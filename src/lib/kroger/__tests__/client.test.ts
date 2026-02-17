import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KrogerClient } from "../client";
import type {
  KrogerProductsResponse,
  KrogerProductResponse,
  KrogerLocationsResponse,
  KrogerLocationResponse,
  KrogerChainsResponse,
} from "../types";

// We need to mock the auth module so KrogerClient doesn't make real token requests
vi.mock("../auth", () => ({
  KrogerAuthManager: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockResolvedValue("mock-app-token"),
  })),
  KrogerUserTokenManager: vi.fn().mockImplementation(() => ({
    isConfigured: true,
    getToken: vi.fn().mockResolvedValue("mock-user-token"),
  })),
}));

const MOCK_PRODUCTS_RESPONSE: KrogerProductsResponse = {
  data: [
    {
      productId: "0021065600000",
      upc: "0021065600000",
      brand: "Kroger",
      description: "Boneless Skinless Chicken Breast",
      images: [],
      items: [
        {
          itemId: "0021065600000",
          price: { regular: 8.99, promo: 6.49 },
          size: "per lb",
          fulfillment: { curbside: true, delivery: true, inStore: true },
        },
      ],
      categories: ["Meat & Seafood"],
      aisleLocations: [{ description: "Meat & Seafood", number: "7" }],
    },
  ],
  meta: { pagination: { start: 0, limit: 10, total: 1 } },
};

const MOCK_PRODUCT_RESPONSE: KrogerProductResponse = {
  data: MOCK_PRODUCTS_RESPONSE.data[0],
};

const MOCK_LOCATIONS_RESPONSE: KrogerLocationsResponse = {
  data: [
    {
      locationId: "01400441",
      chain: "HARRIS TEETER",
      name: "Harris Teeter",
      address: {
        addressLine1: "123 Main St",
        city: "Raleigh",
        state: "NC",
        zipCode: "27601",
      },
      geolocation: { latitude: 35.7796, longitude: -78.6382 },
      departments: [{ departmentId: "1", name: "Bakery" }],
    },
  ],
};

const MOCK_LOCATION_RESPONSE: KrogerLocationResponse = {
  data: MOCK_LOCATIONS_RESPONSE.data[0],
};

const MOCK_CHAINS_RESPONSE: KrogerChainsResponse = {
  data: [{ name: "KROGER" }, { name: "HARRIS TEETER" }, { name: "RALPHS" }],
};

function mockFetchJson(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

describe("KrogerClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function createClient() {
    return new KrogerClient({ clientId: "id", clientSecret: "secret" });
  }

  describe("searchProducts", () => {
    it("makes GET request with correct query parameters", async () => {
      globalThis.fetch = mockFetchJson(MOCK_PRODUCTS_RESPONSE);
      const client = createClient();

      const result = await client.searchProducts({
        term: "chicken breast",
        locationId: "01400441",
        limit: 10,
      });

      expect(result).toEqual(MOCK_PRODUCTS_RESPONSE);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      expect(url).toContain("https://api.kroger.com/v1/products?");
      expect(url).toContain("filter.term=chicken+breast");
      expect(url).toContain("filter.locationId=01400441");
      expect(url).toContain("filter.limit=10");
      expect(options.headers.Authorization).toBe("Bearer mock-app-token");
    });

    it("includes optional brand and fulfillment filters", async () => {
      globalThis.fetch = mockFetchJson(MOCK_PRODUCTS_RESPONSE);
      const client = createClient();

      await client.searchProducts({
        term: "milk",
        brand: "Kroger",
        fulfillment: "csp",
      });

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toContain("filter.brand=Kroger");
      expect(url).toContain("filter.fulfillment=csp");
    });

    it("throws on API error", async () => {
      globalThis.fetch = mockFetchError(500, "Internal Server Error");
      const client = createClient();

      await expect(
        client.searchProducts({ term: "chicken" })
      ).rejects.toThrow("Kroger API error (500)");
    });
  });

  describe("getProduct", () => {
    it("fetches a single product by ID", async () => {
      globalThis.fetch = mockFetchJson(MOCK_PRODUCT_RESPONSE);
      const client = createClient();

      const result = await client.getProduct("0021065600000", "01400441");

      expect(result.data.productId).toBe("0021065600000");
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toContain("/products/0021065600000");
      expect(url).toContain("filter.locationId=01400441");
    });

    it("works without locationId", async () => {
      globalThis.fetch = mockFetchJson(MOCK_PRODUCT_RESPONSE);
      const client = createClient();

      await client.getProduct("0021065600000");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe(
        "https://api.kroger.com/v1/products/0021065600000"
      );
    });
  });

  describe("searchLocations", () => {
    it("searches by zip code", async () => {
      globalThis.fetch = mockFetchJson(MOCK_LOCATIONS_RESPONSE);
      const client = createClient();

      const result = await client.searchLocations({
        zipCode: "27601",
        chain: "HARRIS TEETER",
        limit: 5,
      });

      expect(result.data).toHaveLength(1);
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toContain("filter.zipCode.near=27601");
      expect(url).toContain("filter.chain=HARRIS+TEETER");
      expect(url).toContain("filter.limit=5");
    });

    it("searches by lat/lon", async () => {
      globalThis.fetch = mockFetchJson(MOCK_LOCATIONS_RESPONSE);
      const client = createClient();

      await client.searchLocations({
        lat: 35.7796,
        lon: -78.6382,
        radiusInMiles: 15,
      });

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toContain("filter.lat.near=35.7796");
      expect(url).toContain("filter.lon.near=-78.6382");
      expect(url).toContain("filter.radiusInMiles=15");
    });
  });

  describe("getLocation", () => {
    it("fetches a single location by ID", async () => {
      globalThis.fetch = mockFetchJson(MOCK_LOCATION_RESPONSE);
      const client = createClient();

      const result = await client.getLocation("01400441");

      expect(result.data.locationId).toBe("01400441");
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe("https://api.kroger.com/v1/locations/01400441");
    });
  });

  describe("getChains", () => {
    it("fetches all chains", async () => {
      globalThis.fetch = mockFetchJson(MOCK_CHAINS_RESPONSE);
      const client = createClient();

      const result = await client.getChains();

      expect(result.data).toHaveLength(3);
      expect(result.data.map((c) => c.name)).toEqual([
        "KROGER",
        "HARRIS TEETER",
        "RALPHS",
      ]);
    });
  });

  describe("addToCart", () => {
    it("sends PUT request with items", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
      const client = createClient();

      await client.addToCart({
        items: [{ upc: "0021065600000", quantity: 2 }],
      });

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      expect(url).toBe("https://api.kroger.com/v1/cart/add");
      expect(options.method).toBe("PUT");
      expect(options.headers.Authorization).toBe("Bearer mock-user-token");
      expect(JSON.parse(options.body)).toEqual({
        items: [{ upc: "0021065600000", quantity: 2 }],
      });
    });

    it("throws on cart API error", async () => {
      globalThis.fetch = mockFetchError(401, "Unauthorized");
      const client = createClient();

      await expect(
        client.addToCart({ items: [{ upc: "123", quantity: 1 }] })
      ).rejects.toThrow("Kroger cart add failed (401)");
    });
  });
});
