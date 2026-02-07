# API Integration Guide

This document covers the two external APIs the app depends on: the **Kroger
Public API** for grocery data and cart operations, and the **Anthropic API**
for AI-powered planning.

---

## Table of Contents

1. [Kroger API](#kroger-api)
   - [Registration](#registration)
   - [Authentication](#authentication)
   - [Locations API](#locations-api)
   - [Products API](#products-api)
   - [Cart API](#cart-api)
   - [Rate Limits](#rate-limits)
   - [Error Codes](#error-codes)
2. [Anthropic API](#anthropic-api)
   - [Setup](#setup)
   - [Tool Use (Function Calling)](#tool-use-function-calling)
   - [Streaming](#streaming)
   - [System Prompt Design](#system-prompt-design)

---

## Kroger API

**Base URL:** `https://api.kroger.com/v1`

**Developer Portal:** https://developer.kroger.com

### Registration

1. Create an account at https://developer.kroger.com
2. Register a new application
3. Set the redirect URI (e.g., `http://localhost:3000/auth/kroger/callback`)
4. Request the following scopes:
   - `product.compact`
   - `cart.basic:write`
   - `profile.compact`
5. Note your `client_id` and `client_secret`

### Authentication

Kroger uses OAuth2 with two grant types.

#### Client Credentials (App-Level)

For endpoints that don't require user context (locations, product search).

```
POST /v1/connect/oauth2/token
Authorization: Basic {base64(client_id:client_secret)}
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=product.compact
```

**Response:**
```json
{
  "expires_in": 1800,
  "access_token": "eyJhbG...",
  "token_type": "bearer"
}
```

Tokens expire after **1800 seconds (30 minutes)**. The app should cache the
token and refresh proactively before expiry.

#### Authorization Code + PKCE (User-Level)

Required for cart operations and user-scoped data.

**Step 1 — Generate PKCE parameters:**
```typescript
const codeVerifier = generateRandomString(128);
const codeChallenge = base64url(sha256(codeVerifier));
```

**Step 2 — Redirect user to Kroger:**
```
GET https://api.kroger.com/v1/connect/oauth2/authorize
  ?client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}
  &response_type=code
  &scope=product.compact cart.basic:write profile.compact
  &code_challenge={CODE_CHALLENGE}
  &code_challenge_method=S256
```

**Step 3 — Exchange code for tokens:**
```
POST /v1/connect/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={AUTHORIZATION_CODE}
&redirect_uri={REDIRECT_URI}
&code_verifier={CODE_VERIFIER}
```

**Response:**
```json
{
  "expires_in": 1800,
  "access_token": "eyJhbG...",
  "refresh_token": "eyJhbG...",
  "token_type": "bearer"
}
```

**Step 4 — Refresh when expired:**
```
POST /v1/connect/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={REFRESH_TOKEN}
```

### Locations API

Find Kroger-family stores.

#### List Chains

```
GET /v1/chains
Authorization: Bearer {token}
```

Returns all chain names (e.g., `KROGER`, `HARRIS TEETER`, `FRED MEYER`,
`RALPHS`, `KING SOOPERS`, etc.).

#### Search Locations

```
GET /v1/locations
  ?filter.zipCode.near=27601
  &filter.chain=HARRIS TEETER
  &filter.radiusInMiles=15
  &filter.limit=5
Authorization: Bearer {token}
Accept: application/json
```

**Response structure:**
```json
{
  "data": [
    {
      "locationId": "01400441",
      "chain": "HARRIS TEETER",
      "name": "Harris Teeter",
      "address": {
        "addressLine1": "123 Main St",
        "city": "Raleigh",
        "state": "NC",
        "zipCode": "27601"
      },
      "geolocation": {
        "latitude": 35.7796,
        "longitude": -78.6382
      },
      "departments": [...],
      "hours": {...}
    }
  ]
}
```

### Products API

Search the Kroger product catalog. Results include pricing when scoped to a
specific location.

#### Search Products

```
GET /v1/products
  ?filter.term=chicken breast
  &filter.locationId=01400441
  &filter.limit=10
Authorization: Bearer {token}
Accept: application/json
```

**Response structure:**
```json
{
  "data": [
    {
      "productId": "0021065600000",
      "upc": "0021065600000",
      "brand": "Kroger",
      "description": "Boneless Skinless Chicken Breast",
      "images": [
        {
          "perspective": "front",
          "sizes": [
            { "size": "thumbnail", "url": "https://..." },
            { "size": "medium", "url": "https://..." },
            { "size": "large", "url": "https://..." }
          ]
        }
      ],
      "items": [
        {
          "itemId": "0021065600000",
          "price": {
            "regular": 8.99,
            "promo": 6.49
          },
          "size": "per lb",
          "fulfillment": {
            "curbside": true,
            "delivery": true,
            "inStore": true
          }
        }
      ],
      "categories": ["Meat & Seafood"],
      "aisleLocations": [
        {
          "description": "Meat & Seafood",
          "number": "7"
        }
      ]
    }
  ],
  "meta": {
    "pagination": {
      "start": 0,
      "limit": 10,
      "total": 47
    }
  }
}
```

**Key parameters:**

| Parameter            | Required | Description                          |
|----------------------|----------|--------------------------------------|
| `filter.term`        | Yes      | Search keyword                       |
| `filter.locationId`  | No*      | Location ID for pricing/availability |
| `filter.brand`       | No       | Filter by brand name                 |
| `filter.fulfillment` | No       | `ais` (in-store), `csp` (pickup), `dth` (delivery) |
| `filter.limit`       | No       | 1–50 (default varies)               |
| `filter.start`       | No       | Pagination offset                    |

*`filter.locationId` is technically optional but should always be provided to
get accurate pricing and availability for the user's selected store.

#### Get Product by ID

```
GET /v1/products/{productId}
  ?filter.locationId=01400441
Authorization: Bearer {token}
```

### Cart API

Add items to the authenticated user's Kroger cart.

#### Add to Cart

```
PUT /v1/cart/add
Authorization: Bearer {user_token}
Content-Type: application/json

{
  "items": [
    {
      "upc": "0021065600000",
      "quantity": 2
    }
  ]
}
```

**Notes:**
- Requires a **user-level** token (authorization_code grant) with
  `cart.basic:write` scope.
- The `upc` must come from a Products API response.
- Items are added to the user's persistent Kroger cart (the same one they see
  on kroger.com or the Kroger app).
- There is no "remove from cart" or "get cart" endpoint in the public API.
  The app maintains a local shadow of what was added during the session.
- If an item is already in the cart, the quantity is **updated** (not added to).

### Rate Limits

| Limit                | Value         |
|----------------------|---------------|
| Total API calls/day  | 10,000        |
| Identity endpoint    | 5,000/day     |
| Per-request timeout  | Not documented; assume 30s |

**Mitigation strategies:**
- Cache product search results for the same term + location for 15 minutes.
- Cache location results for 24 hours (stores don't change often).
- Cache the chains list indefinitely (changes very rarely).
- Batch cart additions where possible (multiple items in one PUT).

### Error Codes

| HTTP Status | Meaning                     | Action                          |
|-------------|-----------------------------|---------------------------------|
| 400         | Bad request / invalid params | Check query parameters          |
| 401         | Token expired or invalid    | Refresh token or re-authenticate |
| 403         | Insufficient scope          | Re-authorize with correct scopes |
| 404         | Resource not found          | Product/location doesn't exist  |
| 429         | Rate limit exceeded         | Backoff and retry               |
| 500         | Kroger server error         | Retry with exponential backoff  |

---

## Anthropic API

**SDK:** `@anthropic-ai/sdk` (TypeScript)

**Documentation:** https://docs.anthropic.com

### Setup

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

### Tool Use (Function Calling)

Claude is configured with tools that map to Kroger API operations. When Claude
decides it needs real product data, it emits `tool_use` content blocks that
the server executes and returns as `tool_result` messages.

#### Tool Definitions

```typescript
const tools: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Search the Kroger product catalog for a grocery item. " +
      "Returns product names, brands, prices, and UPCs. " +
      "Always include the store location ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        term: {
          type: "string",
          description: "Search term (e.g., 'organic whole milk')",
        },
        location_id: {
          type: "string",
          description: "Kroger store location ID",
        },
        limit: {
          type: "number",
          description: "Max results to return (1-50, default 5)",
        },
      },
      required: ["term", "location_id"],
    },
  },
  {
    name: "get_product_details",
    description:
      "Get detailed information about a specific product by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_id: {
          type: "string",
          description: "Kroger product ID",
        },
        location_id: {
          type: "string",
          description: "Kroger store location ID for pricing",
        },
      },
      required: ["product_id", "location_id"],
    },
  },
  {
    name: "add_to_cart",
    description:
      "Add one or more products to the user's Kroger cart. " +
      "Always confirm with the user before calling this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              upc: {
                type: "string",
                description: "Product UPC from search results",
              },
              quantity: {
                type: "number",
                description: "Quantity to add (default 1)",
              },
            },
            required: ["upc"],
          },
          description: "Array of items to add to cart",
        },
      },
      required: ["items"],
    },
  },
  {
    name: "find_stores",
    description:
      "Find Kroger-family stores near a zip code. " +
      "Can filter by chain (e.g., HARRIS TEETER, KROGER).",
    input_schema: {
      type: "object" as const,
      properties: {
        zip_code: {
          type: "string",
          description: "5-digit US zip code",
        },
        chain: {
          type: "string",
          description:
            "Chain name filter (e.g., 'HARRIS TEETER', 'KROGER')",
        },
        radius_miles: {
          type: "number",
          description: "Search radius in miles (default 10)",
        },
      },
      required: ["zip_code"],
    },
  },
];
```

#### Tool Execution Loop

```typescript
async function chat(userMessage: string, history: Message[]) {
  const messages = [...history, { role: "user", content: userMessage }];

  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools,
    messages,
  });

  // Agentic loop: keep going while Claude wants to use tools
  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use"
    );

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const result = await executeToolCall(toolUse.name, toolUse.input);
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        };
      })
    );

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
  }

  return response;
}
```

### Streaming

For better UX, the chat endpoint streams responses using Anthropic's streaming
API:

```typescript
const stream = await anthropic.messages.stream({
  model: "claude-sonnet-4-20250514",
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  tools,
  messages,
});

for await (const event of stream) {
  // Forward text deltas to the client via SSE
  if (event.type === "content_block_delta") {
    if (event.delta.type === "text_delta") {
      sendSSE({ type: "text", content: event.delta.text });
    }
  }

  // Handle tool use after stream completes
  if (event.type === "message_stop") {
    // Check if tool calls need execution
  }
}
```

**Note:** When streaming with tool use, the server must buffer tool_use blocks,
execute them after the stream completes, then start a new stream for Claude's
follow-up response. The client sees a seamless conversation.

### System Prompt Design

The system prompt establishes Claude's role as a grocery planning assistant:

```
You are a grocery planning assistant. You help users plan meals and build
shopping lists, then find and add real products to their Kroger cart.

## Your capabilities
- Generate meal plans based on dietary preferences, budget, and household size
- Convert recipes into categorized grocery lists with appropriate quantities
- Search the Kroger product catalog to find matching products
- Compare products by price, brand, and size to find the best value
- Add confirmed products to the user's Kroger cart

## Guidelines
- Always search for products at the user's selected store for accurate
  pricing and availability
- Present product options with prices before adding to cart
- Never add items to cart without user confirmation
- When a product search returns no results, suggest alternative search terms
- Keep a running total of estimated cost
- Organize grocery lists by store department for efficient shopping
- Consider unit prices when comparing products
- Flag potential allergens when known

## Current session context
- Store: {storeName} (ID: {locationId})
- Chain: {chain}
- User preferences: {preferences}
```

The system prompt is assembled dynamically with session context (selected store,
known preferences) before each API call.

---

## Implementation Sequence

The recommended order for building the API integration:

1. **Kroger client credentials auth** — Get an app token to test with
2. **Locations API** — Build store search so the user can pick a store
3. **Products API** — Build product search scoped to the selected store
4. **Kroger OAuth + PKCE** — Add user authentication for cart access
5. **Cart API** — Add "add to cart" capability
6. **Anthropic integration** — Wire up Claude with tool definitions
7. **Streaming** — Add SSE streaming from the chat endpoint
8. **Tool execution loop** — Implement the agentic tool-use cycle
