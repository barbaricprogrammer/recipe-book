import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KrogerClient } from "../lib/kroger/client.js";
import type {
  KrogerProduct,
  KrogerLocation,
} from "../lib/kroger/types.js";

/**
 * Format a product into a concise, readable summary for tool results.
 */
function formatProduct(product: KrogerProduct): string {
  const item = product.items[0];
  const price = item?.price;
  const size = item?.size ?? "";
  const priceStr = price
    ? `$${price.promo !== price.regular && price.promo > 0 ? price.promo.toFixed(2) + " (sale, reg $" + price.regular.toFixed(2) + ")" : price.regular.toFixed(2)}`
    : "price unavailable";

  const fulfillment = item?.fulfillment;
  const availability = fulfillment
    ? [
        fulfillment.inStore && "in-store",
        fulfillment.curbside && "curbside",
        fulfillment.delivery && "delivery",
      ]
        .filter(Boolean)
        .join(", ")
    : "unknown";

  const aisle =
    product.aisleLocations.length > 0
      ? `Aisle: ${product.aisleLocations[0].description}${product.aisleLocations[0].number ? " #" + product.aisleLocations[0].number : ""}`
      : "";

  return [
    `${product.brand} - ${product.description}`,
    `  UPC: ${product.upc} | Product ID: ${product.productId}`,
    `  Price: ${priceStr}${size ? " (" + size + ")" : ""}`,
    `  Available: ${availability}`,
    aisle ? `  ${aisle}` : "",
    product.categories.length > 0
      ? `  Category: ${product.categories.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Format a location into a readable summary.
 */
function formatLocation(location: KrogerLocation): string {
  const addr = location.address;
  return [
    `${location.name} (${location.chain})`,
    `  Location ID: ${location.locationId}`,
    `  Address: ${addr.addressLine1}, ${addr.city}, ${addr.state} ${addr.zipCode}`,
    location.phone ? `  Phone: ${location.phone}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Create and configure the Kroger MCP server with all tool definitions.
 */
export function createKrogerMcpServer(client: KrogerClient): McpServer {
  const server = new McpServer(
    {
      name: "kroger-api",
      version: "0.1.0",
    },
    {
      instructions:
        "Kroger grocery store API. Search products, find stores, get product details, and add items to a customer's Kroger cart. " +
        "Use find_stores first to get a location ID, then pass it to search_products for accurate pricing.",
    }
  );

  // --- search_products ---
  server.tool(
    "search_products",
    "Search the Kroger product catalog for grocery items. Returns product names, brands, prices, and UPCs. " +
      "Provide a location ID for accurate store-specific pricing and availability.",
    {
      term: z
        .string()
        .describe("Search keyword (e.g., 'organic whole milk', 'chicken breast')"),
      location_id: z
        .string()
        .optional()
        .describe("Kroger store location ID for pricing/availability"),
      brand: z.string().optional().describe("Filter by brand name"),
      fulfillment: z
        .enum(["ais", "csp", "dth"])
        .optional()
        .describe("Fulfillment filter: ais=in-store, csp=curbside pickup, dth=delivery"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results to return (1-50, default 10)"),
    },
    async ({ term, location_id, brand, fulfillment, limit }) => {
      try {
        const result = await client.searchProducts({
          term,
          locationId: location_id,
          brand,
          fulfillment,
          limit: limit ?? 10,
        });

        if (result.data.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No products found for "${term}". Try a different search term or check the location ID.`,
              },
            ],
          };
        }

        const formatted = result.data.map(formatProduct).join("\n\n");
        const pagination = result.meta.pagination;

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${pagination.total} products for "${term}" (showing ${result.data.length}):\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error searching products: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- get_product_details ---
  server.tool(
    "get_product_details",
    "Get detailed information about a specific Kroger product by its product ID.",
    {
      product_id: z.string().describe("Kroger product ID"),
      location_id: z
        .string()
        .optional()
        .describe("Kroger store location ID for store-specific pricing"),
    },
    async ({ product_id, location_id }) => {
      try {
        const result = await client.getProduct(product_id, location_id);
        const product = result.data;

        const imageUrl =
          product.images[0]?.sizes?.find((s) => s.size === "medium")?.url ??
          product.images[0]?.sizes?.[0]?.url;

        const detailed = [
          formatProduct(product),
          "",
          imageUrl ? `Image: ${imageUrl}` : "",
          product.temperature?.indicator
            ? `Storage: ${product.temperature.indicator}`
            : "",
          product.itemInformation?.height
            ? `Dimensions: ${product.itemInformation.width}W x ${product.itemInformation.height}H x ${product.itemInformation.depth}D`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text" as const, text: detailed }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error getting product details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- find_stores ---
  server.tool(
    "find_stores",
    "Find Kroger-family stores near a location. Returns store names, addresses, and location IDs. " +
      "Supports filtering by chain (KROGER, HARRIS TEETER, FRED MEYER, RALPHS, KING SOOPERS, etc.).",
    {
      zip_code: z
        .string()
        .optional()
        .describe("5-digit US zip code to search near"),
      latitude: z.number().optional().describe("Latitude for location search"),
      longitude: z
        .number()
        .optional()
        .describe("Longitude for location search"),
      chain: z
        .string()
        .optional()
        .describe("Chain name filter (e.g., 'HARRIS TEETER', 'KROGER')"),
      radius_miles: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Search radius in miles (default 10)"),
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Max results to return (default 5)"),
    },
    async ({ zip_code, latitude, longitude, chain, radius_miles, limit }) => {
      try {
        if (!zip_code && latitude === undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Provide either a zip_code or latitude/longitude to search for stores.",
              },
            ],
          };
        }

        const result = await client.searchLocations({
          zipCode: zip_code,
          lat: latitude,
          lon: longitude,
          chain,
          radiusInMiles: radius_miles,
          limit: limit ?? 5,
        });

        if (result.data.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No stores found near ${zip_code ?? `${latitude},${longitude}`}${chain ? ` for chain ${chain}` : ""}. Try a larger radius or different location.`,
              },
            ],
          };
        }

        const formatted = result.data.map(formatLocation).join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${result.data.length} stores:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error finding stores: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- get_store_details ---
  server.tool(
    "get_store_details",
    "Get detailed information about a specific Kroger store by its location ID, including departments and hours.",
    {
      location_id: z.string().describe("Kroger store location ID"),
    },
    async ({ location_id }) => {
      try {
        const result = await client.getLocation(location_id);
        const loc = result.data;

        const departments =
          loc.departments.length > 0
            ? "Departments: " +
              loc.departments.map((d) => d.name).join(", ")
            : "";

        const detailed = [formatLocation(loc), departments]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text" as const, text: detailed }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error getting store details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- add_to_cart ---
  server.tool(
    "add_to_cart",
    "Add one or more products to the authenticated user's Kroger cart. " +
      "Requires user authentication. The UPC must come from a product search result. " +
      "Always confirm with the user before adding items.",
    {
      items: z
        .array(
          z.object({
            upc: z.string().describe("Product UPC from search results"),
            quantity: z
              .number()
              .min(1)
              .default(1)
              .describe("Quantity to add (default 1)"),
          })
        )
        .min(1)
        .describe("Array of items to add to cart"),
    },
    async ({ items }) => {
      try {
        await client.addToCart({ items });

        const itemSummary = items
          .map((i) => `  UPC ${i.upc} x${i.quantity}`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully added ${items.length} item(s) to cart:\n${itemSummary}\n\nItems are now in the user's Kroger cart and can be viewed at kroger.com or the Kroger app.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error adding to cart: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- get_chains ---
  server.tool(
    "get_chains",
    "List all Kroger-family chain names (e.g., KROGER, HARRIS TEETER, FRED MEYER, RALPHS). " +
      "Useful for discovering valid chain filters for store searches.",
    {},
    async () => {
      try {
        const result = await client.getChains();
        const chains = result.data.map((c) => c.name).join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Kroger-family chains:\n${chains}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error listing chains: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  return server;
}
