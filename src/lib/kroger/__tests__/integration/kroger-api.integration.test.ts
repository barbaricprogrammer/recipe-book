/**
 * Integration tests for the Kroger API client.
 *
 * These tests hit the REAL Kroger API to verify that our client
 * implementation matches the actual API behavior.
 *
 * Required environment variables:
 *   KROGER_CLIENT_ID     - Kroger developer client ID
 *   KROGER_CLIENT_SECRET - Kroger developer client secret
 *
 * Run with:
 *   KROGER_CLIENT_ID=xxx KROGER_CLIENT_SECRET=xxx npx vitest run --reporter=verbose src/lib/kroger/__tests__/integration/
 *
 * In CI, set these as GitHub Secrets and run with:
 *   npx vitest run src/lib/kroger/__tests__/integration/
 */

import { describe, it, expect, beforeAll } from "vitest";
import { KrogerAuthManager } from "../../auth";
import { KrogerClient } from "../../client";

const CLIENT_ID = process.env.KROGER_CLIENT_ID;
const CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET;

const hasCredentials = CLIENT_ID && CLIENT_SECRET;

// Skip all integration tests if credentials are not set
const describeIntegration = hasCredentials ? describe : describe.skip;

describeIntegration("Kroger API Integration", () => {
  let client: KrogerClient;

  beforeAll(() => {
    client = new KrogerClient({
      clientId: CLIENT_ID!,
      clientSecret: CLIENT_SECRET!,
    });
  });

  describe("Authentication", () => {
    it("obtains a client credentials token", async () => {
      const auth = new KrogerAuthManager(CLIENT_ID!, CLIENT_SECRET!);
      const token = await auth.getToken();

      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(10);
    });

    it("caches and reuses the token", async () => {
      const auth = new KrogerAuthManager(CLIENT_ID!, CLIENT_SECRET!);
      const token1 = await auth.getToken();
      const token2 = await auth.getToken();

      expect(token1).toBe(token2);
    });
  });

  describe("Locations API", () => {
    it("searches for stores by zip code", async () => {
      const result = await client.searchLocations({
        zipCode: "45202", // Cincinnati, OH (Kroger HQ area)
        limit: 3,
      });

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.length).toBeLessThanOrEqual(3);

      const store = result.data[0];
      expect(store.locationId).toBeTruthy();
      expect(store.chain).toBeTruthy();
      expect(store.name).toBeTruthy();
      expect(store.address).toBeDefined();
      expect(store.address.city).toBeTruthy();
      expect(store.address.state).toBeTruthy();
      expect(store.address.zipCode).toBeTruthy();
      expect(store.geolocation).toBeDefined();
      expect(typeof store.geolocation.latitude).toBe("number");
      expect(typeof store.geolocation.longitude).toBe("number");
    });

    it("filters stores by chain", async () => {
      const result = await client.searchLocations({
        zipCode: "45202",
        chain: "KROGER",
        limit: 3,
      });

      expect(result.data.length).toBeGreaterThan(0);
      for (const store of result.data) {
        expect(store.chain).toBe("KROGER");
      }
    });

    it("gets a specific store by location ID", async () => {
      // First find a store to get its ID
      const searchResult = await client.searchLocations({
        zipCode: "45202",
        limit: 1,
      });
      expect(searchResult.data.length).toBeGreaterThan(0);
      const locationId = searchResult.data[0].locationId;

      const result = await client.getLocation(locationId);

      expect(result.data).toBeDefined();
      expect(result.data.locationId).toBe(locationId);
      expect(result.data.address).toBeDefined();
      expect(result.data.departments).toBeDefined();
      expect(Array.isArray(result.data.departments)).toBe(true);
    });

    it("returns departments for a store", async () => {
      const searchResult = await client.searchLocations({
        zipCode: "45202",
        chain: "KROGER",
        limit: 1,
      });
      const locationId = searchResult.data[0].locationId;
      const result = await client.getLocation(locationId);

      // Kroger stores typically have multiple departments
      expect(result.data.departments.length).toBeGreaterThan(0);

      const dept = result.data.departments[0];
      expect(dept.departmentId).toBeTruthy();
      expect(dept.name).toBeTruthy();
    });
  });

  describe("Products API", () => {
    let locationId: string;

    beforeAll(async () => {
      // Get a real store location ID for product searches
      const locResult = await client.searchLocations({
        zipCode: "45202",
        chain: "KROGER",
        limit: 1,
      });
      locationId = locResult.data[0].locationId;
    });

    it("searches products by term", async () => {
      const result = await client.searchProducts({
        term: "milk",
        locationId,
        limit: 5,
      });

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.length).toBeLessThanOrEqual(5);
      expect(result.meta.pagination).toBeDefined();
      expect(result.meta.pagination.total).toBeGreaterThan(0);

      const product = result.data[0];
      expect(product.productId).toBeTruthy();
      expect(product.upc).toBeTruthy();
      expect(product.description).toBeTruthy();
      expect(product.brand).toBeDefined();
      expect(Array.isArray(product.images)).toBe(true);
      expect(Array.isArray(product.items)).toBe(true);
    });

    it("returns pricing when location is provided", async () => {
      const result = await client.searchProducts({
        term: "whole milk",
        locationId,
        limit: 5,
      });

      // At least some products should have pricing
      const productsWithPrice = result.data.filter(
        (p) => p.items[0]?.price !== undefined
      );
      expect(productsWithPrice.length).toBeGreaterThan(0);

      const price = productsWithPrice[0].items[0].price!;
      expect(typeof price.regular).toBe("number");
      expect(price.regular).toBeGreaterThan(0);
      expect(typeof price.promo).toBe("number");
    });

    it("returns fulfillment information", async () => {
      const result = await client.searchProducts({
        term: "bread",
        locationId,
        limit: 5,
      });

      const productsWithFulfillment = result.data.filter(
        (p) => p.items[0]?.fulfillment !== undefined
      );
      expect(productsWithFulfillment.length).toBeGreaterThan(0);

      const fulfillment = productsWithFulfillment[0].items[0].fulfillment;
      expect(typeof fulfillment.inStore).toBe("boolean");
      expect(typeof fulfillment.curbside).toBe("boolean");
      expect(typeof fulfillment.delivery).toBe("boolean");
    });

    it("returns product images", async () => {
      const result = await client.searchProducts({
        term: "cereal",
        locationId,
        limit: 10,
      });

      // At least some products should have images
      const productsWithImages = result.data.filter(
        (p) => p.images.length > 0
      );
      expect(productsWithImages.length).toBeGreaterThan(0);

      const image = productsWithImages[0].images[0];
      expect(image.perspective).toBeTruthy();
      expect(image.sizes.length).toBeGreaterThan(0);
      expect(image.sizes[0].url).toMatch(/^https?:\/\//);
    });

    it("gets a specific product by ID", async () => {
      // First search to get a product ID
      const searchResult = await client.searchProducts({
        term: "eggs",
        locationId,
        limit: 1,
      });
      expect(searchResult.data.length).toBeGreaterThan(0);
      const productId = searchResult.data[0].productId;

      const result = await client.getProduct(productId, locationId);

      expect(result.data).toBeDefined();
      expect(result.data.productId).toBe(productId);
      expect(result.data.description).toBeTruthy();
    });

    it("returns pagination metadata", async () => {
      const result = await client.searchProducts({
        term: "chicken",
        locationId,
        limit: 3,
      });

      expect(result.meta.pagination).toBeDefined();
      expect(typeof result.meta.pagination.start).toBe("number");
      expect(typeof result.meta.pagination.limit).toBe("number");
      expect(typeof result.meta.pagination.total).toBe("number");
      expect(result.meta.pagination.total).toBeGreaterThanOrEqual(
        result.data.length
      );
    });

    it("handles no results gracefully", async () => {
      const result = await client.searchProducts({
        term: "xyznonexistentproduct12345",
        locationId,
        limit: 5,
      });

      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(0);
    });
  });

  describe("Chains API", () => {
    it("lists all Kroger-family chains", async () => {
      const result = await client.getChains();

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);

      const chainNames = result.data.map((c) => c.name);

      // Kroger should always be in the list
      expect(chainNames).toContain("KROGER");

      // Every chain should have a name string
      for (const chain of result.data) {
        expect(chain.name).toBeTruthy();
        expect(typeof chain.name).toBe("string");
      }
    });
  });

  describe("Error handling", () => {
    it("rejects with error for invalid location ID", async () => {
      await expect(
        client.getLocation("00000000")
      ).rejects.toThrow();
    });

    it("rejects with error for invalid product ID", async () => {
      await expect(
        client.getProduct("0000000000000")
      ).rejects.toThrow();
    });
  });

  describe("Cart API (without user token)", () => {
    it("throws when trying to add to cart without user token", async () => {
      await expect(
        client.addToCart({
          items: [{ upc: "0021065600000", quantity: 1 }],
        })
      ).rejects.toThrow("Cart operations require a user token");
    });
  });
}, { timeout: 30000 });
