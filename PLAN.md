# Grocery Planning & Purchasing App — Project Plan

## Overview

A conversational grocery planning and purchasing application that uses the
**Anthropic API** (Claude) for intelligent meal planning, recipe management, and
grocery list generation, and the **Kroger Public API** for product search,
price lookup, store selection, and cart population across Kroger-family stores
(Harris Teeter, Kroger, Fred Meyer, Ralphs, etc.).

Users authenticate with their own Kroger account. Claude handles the
"thinking" — turning vague meal ideas into structured shopping lists — while the
Kroger API handles the "doing" — finding real products at real prices and adding
them to the user's cart for pickup or delivery.

---

## Goals

1. **Meal planning** — Given dietary preferences, budget, household size, and
   time constraints, generate weekly meal plans with recipes.
2. **Smart grocery lists** — Convert meal plans into deduplicated, categorized
   grocery lists with quantities.
3. **Product matching** — Search the Kroger catalog for each list item, rank
   results by relevance/price/brand preference, and let the user confirm or
   swap.
4. **Cart population** — Add confirmed products to the user's Kroger cart so
   they can check out via the Kroger app or website.
5. **Store awareness** — Let the user pick their preferred store (by zip code,
   chain, or saved location) and scope all searches/pricing to that store.
6. **Iterative refinement** — Support follow-up conversation to adjust the plan
   ("swap the salmon for chicken", "add snacks for the kids", "stay under
   $150").

---

## Non-Goals (v1)

- **Checkout / payment** — The Kroger Public API does not expose a checkout
  endpoint. Users complete payment in the Kroger app/website after we populate
  their cart.
- **Delivery scheduling** — Selecting pickup/delivery time slots is not
  available in the public API.
- **Multi-store orders** — v1 targets a single store per session.
- **Coupon/loyalty integration** — Kroger coupons are not exposed in the public
  API.
- **Persistent user accounts** — v1 stores session state only; no database.

---

## Core User Flow

```
1. User signs in with Kroger (OAuth2 + PKCE)
2. User selects their preferred store (Locations API)
3. User describes what they want to eat / how many people / budget
4. Claude generates a meal plan + grocery list
5. App searches Kroger Products API for each item
6. User reviews matched products, swaps as needed
7. App adds confirmed items to Kroger cart (Cart API)
8. User checks out on kroger.com or the Kroger app
```

---

## Technology Stack

| Layer             | Choice                  | Rationale                                    |
|-------------------|-------------------------|----------------------------------------------|
| Language          | TypeScript              | Type safety, broad ecosystem                 |
| Runtime           | Node.js (>=20 LTS)      | Native fetch, stable ESM                     |
| Framework         | Next.js 14 (App Router) | SSR, API routes, React Server Components     |
| AI                | Anthropic SDK (`@anthropic-ai/sdk`) | Official TypeScript SDK for Claude  |
| Styling           | Tailwind CSS            | Rapid UI development                         |
| State             | React Context + `useReducer` | Simple, no external deps for v1         |
| Auth              | NextAuth.js             | OAuth2/PKCE provider support                 |
| HTTP (server)     | Native fetch            | No extra deps; Kroger API is straightforward |
| Testing           | Vitest + React Testing Library | Fast, ESM-native                      |
| Linting           | ESLint + Prettier        | Standard tooling                            |

---

## Kroger API Surface (Public)

All endpoints are under `https://api.kroger.com/v1/`.

### Authentication

| Detail          | Value                                              |
|-----------------|----------------------------------------------------|
| Token URL       | `/connect/oauth2/token`                            |
| Grant types     | `authorization_code` (user), `client_credentials` (app) |
| PKCE            | Supported and recommended for browser flows        |
| Token lifetime  | 1800 seconds (30 min)                              |
| Refresh tokens  | Issued with `authorization_code` grant             |

### Scopes

| Scope                  | Purpose                          |
|------------------------|----------------------------------|
| `product.compact`      | Search products (compact response) |
| `cart.basic:write`     | Add items to user's cart         |
| `profile.compact`      | Read user profile ID             |

### Endpoints Used

| Method | Path                  | Scope              | Purpose                              |
|--------|-----------------------|---------------------|--------------------------------------|
| GET    | `/locations`          | (none / app token)  | Find stores by zip, chain, lat/lng   |
| GET    | `/locations/{id}`     | (none / app token)  | Get store details                    |
| GET    | `/chains`             | (none / app token)  | List all Kroger-family chain names   |
| GET    | `/products`           | `product.compact`   | Search products by term + location   |
| GET    | `/products/{id}`      | `product.compact`   | Get single product details           |
| PUT    | `/cart/add`           | `cart.basic:write`  | Add items to user's cart             |

### Key Query Parameters — Products

| Parameter              | Description                        |
|------------------------|------------------------------------|
| `filter.term`          | Search keyword (e.g., "milk")      |
| `filter.locationId`    | Scope to a specific store          |
| `filter.brand`         | Filter by brand name               |
| `filter.limit`         | Results per page (max 50)          |
| `filter.start`         | Pagination offset                  |
| `filter.fulfillment`   | Filter by fulfillment type         |

### Key Query Parameters — Locations

| Parameter                | Description                      |
|--------------------------|----------------------------------|
| `filter.zipCode.near`    | Search near a zip code           |
| `filter.lat.near`        | Search near latitude             |
| `filter.lon.near`        | Search near longitude            |
| `filter.chain`           | Filter by chain (e.g., `HARRIS TEETER`) |
| `filter.department`      | Filter by department             |
| `filter.radiusInMiles`   | Search radius (default 10)       |
| `filter.limit`           | Number of results (default 10)   |

### Rate Limits

- 10,000 API calls per day (across all endpoints)
- 5,000 calls per day for Identity endpoint specifically

---

## Anthropic API Usage

Claude will be used via the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) with **tool use** (function calling) to:

1. **Generate meal plans** — Given user preferences, output structured JSON
   meal plans with recipes, ingredients, and quantities.
2. **Build grocery lists** — Deduplicate and categorize ingredients across
   multiple recipes, converting recipe quantities to store-purchase quantities.
3. **Handle substitutions** — When a product isn't found or is out of stock,
   suggest alternatives.
4. **Budget optimization** — Compare product options and recommend
   cost-effective choices.
5. **Conversational refinement** — Process follow-up requests to modify plans.

### Tool Definitions (Claude Function Calling)

Claude will be given tools that map to our internal functions:

| Tool Name               | Description                                    |
|-------------------------|------------------------------------------------|
| `search_products`       | Search Kroger catalog for a grocery item       |
| `get_product_details`   | Get full details for a specific product        |
| `add_to_cart`           | Add a product to the user's Kroger cart        |
| `find_stores`           | Search for nearby Kroger-family stores         |
| `get_store_details`     | Get details for a specific store               |
| `get_current_cart`      | Retrieve the current state of the grocery list |

This allows Claude to autonomously search for products, compare prices, and
populate the cart during the conversation, with user confirmation at key steps.

---

## Project Structure

```
recipe-book/
├── PLAN.md                          # This file
├── docs/
│   ├── ARCHITECTURE.md              # System architecture & data flow
│   └── API_INTEGRATION.md           # Kroger & Anthropic API details
├── src/
│   ├── app/                         # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # Landing / chat page
│   │   ├── auth/
│   │   │   └── kroger/
│   │   │       └── callback/
│   │   │           └── route.ts     # OAuth callback handler
│   │   └── api/
│   │       ├── chat/
│   │       │   └── route.ts         # Anthropic streaming endpoint
│   │       ├── kroger/
│   │       │   ├── products/
│   │       │   │   └── route.ts     # Product search proxy
│   │       │   ├── locations/
│   │       │   │   └── route.ts     # Store search proxy
│   │       │   └── cart/
│   │       │       └── route.ts     # Cart operations proxy
│   │       └── auth/
│   │           └── [...nextauth]/
│   │               └── route.ts     # NextAuth catch-all
│   ├── lib/
│   │   ├── kroger/
│   │   │   ├── client.ts            # Kroger API client
│   │   │   ├── auth.ts              # Token management
│   │   │   └── types.ts             # Kroger API types
│   │   ├── anthropic/
│   │   │   ├── client.ts            # Anthropic client setup
│   │   │   ├── tools.ts             # Tool definitions for Claude
│   │   │   ├── prompts.ts           # System prompts
│   │   │   └── types.ts             # Chat/tool types
│   │   └── utils/
│   │       └── grocery-list.ts      # List dedup, categorization
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx       # Main chat interface
│   │   │   ├── MessageBubble.tsx    # Individual message
│   │   │   └── InputBar.tsx         # User input
│   │   ├── grocery/
│   │   │   ├── ProductCard.tsx      # Product display
│   │   │   ├── GroceryList.tsx      # Shopping list view
│   │   │   └── CartSummary.tsx      # Cart total / review
│   │   ├── store/
│   │   │   ├── StoreSelector.tsx    # Store picker
│   │   │   └── StoreCard.tsx        # Store display
│   │   └── layout/
│   │       ├── Header.tsx
│   │       └── Sidebar.tsx
│   ├── context/
│   │   ├── ChatContext.tsx           # Chat state
│   │   ├── StoreContext.tsx          # Selected store
│   │   └── CartContext.tsx           # Local cart state
│   └── types/
│       └── index.ts                 # Shared app types
├── public/
├── .env.example                     # Required env vars template
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
└── vitest.config.ts
```

---

## Milestones

### M1 — Foundation (current)
- [x] Project plan and documentation
- [ ] Repository scaffolding (Next.js, TypeScript, Tailwind, ESLint)
- [ ] Environment configuration (`.env.example`)

### M2 — Kroger Integration
- [ ] OAuth2 + PKCE flow with NextAuth
- [ ] Kroger API client (`locations`, `products`, `cart`)
- [ ] Store selector UI
- [ ] Product search UI

### M3 — AI-Powered Planning
- [ ] Anthropic client with tool definitions
- [ ] System prompt for meal planning
- [ ] Streaming chat endpoint
- [ ] Chat UI with message rendering

### M4 — Cart & Checkout Handoff
- [ ] Product matching pipeline (Claude list -> Kroger search -> user confirm)
- [ ] Cart population via Kroger Cart API
- [ ] Cart review / summary UI
- [ ] Checkout handoff (link to Kroger)

### M5 — Polish
- [ ] Error handling & retry logic
- [ ] Loading states & optimistic UI
- [ ] Mobile responsiveness
- [ ] Unit & integration tests

---

## Environment Variables

```bash
# Anthropic
ANTHROPIC_API_KEY=           # Claude API key

# Kroger OAuth
KROGER_CLIENT_ID=            # From developer.kroger.com
KROGER_CLIENT_SECRET=        # From developer.kroger.com
KROGER_REDIRECT_URI=         # e.g., http://localhost:3000/auth/kroger/callback

# NextAuth
NEXTAUTH_SECRET=             # Random secret for session encryption
NEXTAUTH_URL=                # e.g., http://localhost:3000

# Optional
DEFAULT_CHAIN=HARRIS TEETER  # Default Kroger chain filter
DEFAULT_ZIP=                 # Default zip code for store search
```

---

## Open Questions

1. **Model selection** — Should we use `claude-sonnet-4-20250514` (faster, cheaper) or
   `claude-opus-4-0-20250414` (more capable) for meal planning? Likely Sonnet for most
   interactions, with an option to escalate.
2. **Streaming** — Should Claude responses stream to the UI, or should we wait
   for complete responses? Streaming is better UX for long meal plans.
3. **Product matching confidence** — When Claude's grocery list item doesn't
   match well to Kroger results, what's the threshold for asking the user vs.
   auto-selecting? Needs experimentation.
4. **Rate limit strategy** — 10k calls/day is generous for personal use but
   could be tight for multi-user deployment. Consider caching product searches.
5. **Harris Teeter specifics** — The chain name in the API is likely
   `HARRIS TEETER` (uppercase). Need to confirm via the `/v1/chains` endpoint.
