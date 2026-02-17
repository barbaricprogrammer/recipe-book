import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KrogerClient } from "../../lib/kroger/client";
import { createKrogerMcpServer } from "../server";
import type {
  KrogerProductsResponse,
  KrogerProductResponse,
  KrogerLocationsResponse,
  KrogerLocationResponse,
  KrogerChainsResponse,
} from "../../lib/kroger/types";

// --- Test fixtures ---

const MOCK_PRODUCT = {
  productId: "0021065600000",
  upc: "0021065600000",
  brand: "Kroger",
  description: "Boneless Skinless Chicken Breast",
  images: [
    {
      perspective: "front",
      sizes: [
        { size: "medium" as const, url: "https://example.com/chicken.jpg" },
      ],
    },
  ],
  items: [
    {
      itemId: "0021065600000",
      price: { regular: 8.99, promo: 6.49 },
      size: "per lb",
      fulfillment: {
        curbside: true,
        delivery: true,
        inStore: true,
      },
    },
  ],
  categories: ["Meat & Seafood"],
  aisleLocations: [{ description: "Meat & Seafood", number: "7" }],
};

const MOCK_LOCATION = {
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
  phone: "919-555-1234",
  departments: [
    { departmentId: "1", name: "Bakery" },
    { departmentId: "2", name: "Deli" },
  ],
};

// --- Helper to create connected client+server pair ---

async function createTestPair(krogerClient: KrogerClient) {
  const mcpServer = createKrogerMcpServer(krogerClient);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, mcpServer };
}

function createMockKrogerClient(overrides: Partial<KrogerClient> = {}) {
  return {
    searchProducts: vi.fn(),
    getProduct: vi.fn(),
    searchLocations: vi.fn(),
    getLocation: vi.fn(),
    getChains: vi.fn(),
    addToCart: vi.fn(),
    ...overrides,
  } as unknown as KrogerClient;
}

describe("Kroger MCP Server", () => {
  describe("listTools", () => {
    it("exposes all 6 tools", async () => {
      const krogerClient = createMockKrogerClient();
      const { client } = await createTestPair(krogerClient);

      const { tools } = await client.listTools();

      expect(tools).toHaveLength(6);
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "add_to_cart",
        "find_stores",
        "get_chains",
        "get_product_details",
        "get_store_details",
        "search_products",
      ]);
    });

    it("each tool has a description", async () => {
      const krogerClient = createMockKrogerClient();
      const { client } = await createTestPair(krogerClient);

      const { tools } = await client.listTools();

      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.description!.length).toBeGreaterThan(10);
      }
    });
  });

  describe("search_products", () => {
    it("returns formatted product results", async () => {
      const response: KrogerProductsResponse = {
        data: [MOCK_PRODUCT],
        meta: { pagination: { start: 0, limit: 10, total: 1 } },
      };
      const krogerClient = createMockKrogerClient({
        searchProducts: vi.fn().mockResolvedValue(response),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "search_products",
        arguments: { term: "chicken breast", location_id: "01400441" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Found 1 products");
      expect(text).toContain("Kroger - Boneless Skinless Chicken Breast");
      expect(text).toContain("UPC: 0021065600000");
      expect(text).toContain("$6.49 (sale");
      expect(text).toContain("Meat & Seafood");
    });

    it("returns message when no products found", async () => {
      const response: KrogerProductsResponse = {
        data: [],
        meta: { pagination: { start: 0, limit: 10, total: 0 } },
      };
      const krogerClient = createMockKrogerClient({
        searchProducts: vi.fn().mockResolvedValue(response),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "search_products",
        arguments: { term: "nonexistent" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain('No products found for "nonexistent"');
    });

    it("returns error on API failure", async () => {
      const krogerClient = createMockKrogerClient({
        searchProducts: vi.fn().mockRejectedValue(new Error("API down")),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "search_products",
        arguments: { term: "chicken" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Error searching products");
      expect(text).toContain("API down");
    });

    it("passes all parameters to client", async () => {
      const searchMock = vi.fn().mockResolvedValue({
        data: [],
        meta: { pagination: { start: 0, limit: 5, total: 0 } },
      });
      const krogerClient = createMockKrogerClient({
        searchProducts: searchMock,
      });
      const { client } = await createTestPair(krogerClient);

      await client.callTool({
        name: "search_products",
        arguments: {
          term: "milk",
          location_id: "01400441",
          brand: "Kroger",
          fulfillment: "csp",
          limit: 5,
        },
      });

      expect(searchMock).toHaveBeenCalledWith({
        term: "milk",
        locationId: "01400441",
        brand: "Kroger",
        fulfillment: "csp",
        limit: 5,
      });
    });

    it("defaults limit to 10 when not provided", async () => {
      const searchMock = vi.fn().mockResolvedValue({
        data: [],
        meta: { pagination: { start: 0, limit: 10, total: 0 } },
      });
      const krogerClient = createMockKrogerClient({
        searchProducts: searchMock,
      });
      const { client } = await createTestPair(krogerClient);

      await client.callTool({
        name: "search_products",
        arguments: { term: "milk" },
      });

      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });
  });

  describe("get_product_details", () => {
    it("returns formatted product details with image", async () => {
      const response: KrogerProductResponse = { data: MOCK_PRODUCT };
      const krogerClient = createMockKrogerClient({
        getProduct: vi.fn().mockResolvedValue(response),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "get_product_details",
        arguments: { product_id: "0021065600000", location_id: "01400441" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Kroger - Boneless Skinless Chicken Breast");
      expect(text).toContain("Image: https://example.com/chicken.jpg");
    });

    it("returns error on API failure", async () => {
      const krogerClient = createMockKrogerClient({
        getProduct: vi.fn().mockRejectedValue(new Error("Not found")),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "get_product_details",
        arguments: { product_id: "invalid" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Error getting product details");
    });
  });

  describe("find_stores", () => {
    it("returns formatted store results", async () => {
      const response: KrogerLocationsResponse = { data: [MOCK_LOCATION] };
      const krogerClient = createMockKrogerClient({
        searchLocations: vi.fn().mockResolvedValue(response),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "find_stores",
        arguments: { zip_code: "27601", chain: "HARRIS TEETER" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Found 1 stores");
      expect(text).toContain("Harris Teeter (HARRIS TEETER)");
      expect(text).toContain("Location ID: 01400441");
      expect(text).toContain("123 Main St, Raleigh, NC 27601");
    });

    it("returns error when no location provided", async () => {
      const krogerClient = createMockKrogerClient();
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "find_stores",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("zip_code or latitude/longitude");
    });

    it("returns message when no stores found", async () => {
      const krogerClient = createMockKrogerClient({
        searchLocations: vi.fn().mockResolvedValue({ data: [] }),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "find_stores",
        arguments: { zip_code: "00000" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("No stores found");
    });

    it("supports lat/lon search", async () => {
      const searchMock = vi.fn().mockResolvedValue({ data: [MOCK_LOCATION] });
      const krogerClient = createMockKrogerClient({
        searchLocations: searchMock,
      });
      const { client } = await createTestPair(krogerClient);

      await client.callTool({
        name: "find_stores",
        arguments: { latitude: 35.7796, longitude: -78.6382, radius_miles: 15 },
      });

      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lat: 35.7796,
          lon: -78.6382,
          radiusInMiles: 15,
        })
      );
    });
  });

  describe("get_store_details", () => {
    it("returns formatted store details with departments", async () => {
      const response: KrogerLocationResponse = { data: MOCK_LOCATION };
      const krogerClient = createMockKrogerClient({
        getLocation: vi.fn().mockResolvedValue(response),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "get_store_details",
        arguments: { location_id: "01400441" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Harris Teeter");
      expect(text).toContain("Departments: Bakery, Deli");
    });

    it("returns error on API failure", async () => {
      const krogerClient = createMockKrogerClient({
        getLocation: vi.fn().mockRejectedValue(new Error("Not found")),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "get_store_details",
        arguments: { location_id: "invalid" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Error getting store details");
    });
  });

  describe("add_to_cart", () => {
    it("adds items and returns success summary", async () => {
      const addMock = vi.fn().mockResolvedValue(undefined);
      const krogerClient = createMockKrogerClient({ addToCart: addMock });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "add_to_cart",
        arguments: {
          items: [
            { upc: "0021065600000", quantity: 2 },
            { upc: "0001111041600", quantity: 1 },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Successfully added 2 item(s)");
      expect(text).toContain("UPC 0021065600000 x2");
      expect(text).toContain("UPC 0001111041600 x1");

      expect(addMock).toHaveBeenCalledWith({
        items: [
          { upc: "0021065600000", quantity: 2 },
          { upc: "0001111041600", quantity: 1 },
        ],
      });
    });

    it("returns error when cart add fails", async () => {
      const krogerClient = createMockKrogerClient({
        addToCart: vi
          .fn()
          .mockRejectedValue(new Error("Cart operations require a user token")),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "add_to_cart",
        arguments: { items: [{ upc: "123", quantity: 1 }] },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Error adding to cart");
      expect(text).toContain("require a user token");
    });
  });

  describe("get_chains", () => {
    it("returns list of chain names", async () => {
      const response: KrogerChainsResponse = {
        data: [{ name: "KROGER" }, { name: "HARRIS TEETER" }],
      };
      const krogerClient = createMockKrogerClient({
        getChains: vi.fn().mockResolvedValue(response),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "get_chains",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("KROGER");
      expect(text).toContain("HARRIS TEETER");
    });

    it("returns error on API failure", async () => {
      const krogerClient = createMockKrogerClient({
        getChains: vi.fn().mockRejectedValue(new Error("Network error")),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "get_chains",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Error listing chains");
    });
  });

  describe("price formatting", () => {
    it("shows sale price when promo differs from regular", async () => {
      const product = {
        ...MOCK_PRODUCT,
        items: [
          {
            ...MOCK_PRODUCT.items[0],
            price: { regular: 8.99, promo: 6.49 },
          },
        ],
      };
      const krogerClient = createMockKrogerClient({
        searchProducts: vi.fn().mockResolvedValue({
          data: [product],
          meta: { pagination: { start: 0, limit: 10, total: 1 } },
        }),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "search_products",
        arguments: { term: "chicken" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("$6.49 (sale, reg $8.99)");
    });

    it("shows regular price when promo equals regular", async () => {
      const product = {
        ...MOCK_PRODUCT,
        items: [
          {
            ...MOCK_PRODUCT.items[0],
            price: { regular: 3.99, promo: 3.99 },
          },
        ],
      };
      const krogerClient = createMockKrogerClient({
        searchProducts: vi.fn().mockResolvedValue({
          data: [product],
          meta: { pagination: { start: 0, limit: 10, total: 1 } },
        }),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "search_products",
        arguments: { term: "milk" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("$3.99");
      expect(text).not.toContain("sale");
    });

    it("shows 'price unavailable' when no price", async () => {
      const product = {
        ...MOCK_PRODUCT,
        items: [
          {
            ...MOCK_PRODUCT.items[0],
            price: undefined,
          },
        ],
      };
      const krogerClient = createMockKrogerClient({
        searchProducts: vi.fn().mockResolvedValue({
          data: [product],
          meta: { pagination: { start: 0, limit: 10, total: 1 } },
        }),
      });
      const { client } = await createTestPair(krogerClient);

      const result = await client.callTool({
        name: "search_products",
        arguments: { term: "item" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("price unavailable");
    });
  });
});
