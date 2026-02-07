# Architecture

## System Overview

The app is a **Next.js** application that acts as an orchestrator between two
external services: the **Anthropic API** (Claude) for intelligence and the
**Kroger API** for grocery data and cart operations. All Kroger API calls are
proxied through Next.js API routes so that credentials and tokens stay
server-side.

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Chat UI  │  │ Store Picker │  │ Grocery List / Cart   │ │
│  └────┬─────┘  └──────┬───────┘  └───────────┬───────────┘ │
│       │               │                      │              │
└───────┼───────────────┼──────────────────────┼──────────────┘
        │               │                      │
        ▼               ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 Next.js Server (API Routes)                  │
│                                                             │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ /api/chat  │  │ /api/kroger/ │  │ /api/auth/          │ │
│  │            │  │  products    │  │  [...nextauth]       │ │
│  │ Anthropic  │  │  locations   │  │                      │ │
│  │ streaming  │  │  cart        │  │ Kroger OAuth2 + PKCE │ │
│  └─────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│        │                │                      │            │
└────────┼────────────────┼──────────────────────┼────────────┘
         │                │                      │
         ▼                ▼                      ▼
   ┌──────────┐    ┌──────────┐          ┌──────────┐
   │ Anthropic│    │ Kroger   │          │ Kroger   │
   │ API      │    │ API      │          │ OAuth    │
   │ (Claude) │    │ (v1/)    │          │ Server   │
   └──────────┘    └──────────┘          └──────────┘
```

---

## Data Flow: Meal Plan to Cart

This is the primary flow — from a user's meal idea to products in their Kroger
cart.

```
User: "Plan dinners for the week, family of 4, ~$100 budget"
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ 1. /api/chat receives user message                  │
│                                                     │
│ 2. Build Claude messages array:                     │
│    - System prompt (meal planner persona + tools)   │
│    - Conversation history                           │
│    - New user message                               │
│                                                     │
│ 3. Call Anthropic API with tool_use enabled          │
│    Tools: search_products, add_to_cart, etc.        │
│                                                     │
│ 4. Claude responds with meal plan + tool calls:     │
│    - Text: "Here's your weekly plan..."             │
│    - tool_use: search_products("chicken breast")    │
│    - tool_use: search_products("jasmine rice")      │
│    - ...                                            │
│                                                     │
│ 5. Server executes tool calls against Kroger API    │
│    GET /v1/products?filter.term=chicken+breast      │
│        &filter.locationId=01400441                  │
│                                                     │
│ 6. Return tool results to Claude                    │
│                                                     │
│ 7. Claude synthesizes results:                      │
│    "I found Simple Truth chicken breast at $8.99    │
│     and Kroger brand at $6.49. Want me to add       │
│     the Kroger brand to your cart?"                 │
│                                                     │
│ 8. Stream response back to browser                  │
└─────────────────────────────────────────────────────┘
  │
  ▼
User: "Yes, go with the Kroger brand for everything"
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ 9. Claude calls add_to_cart for each confirmed item │
│                                                     │
│ 10. Server executes:                                │
│     PUT /v1/cart/add                                │
│     { "items": [{ "upc": "...", "quantity": 2 }] } │
│                                                     │
│ 11. Claude confirms: "Added 12 items to your       │
│     Harris Teeter cart. Total ~$94. Head to         │
│     harristeeter.com to check out!"                 │
└─────────────────────────────────────────────────────┘
```

---

## Authentication Flow

The app uses **two layers** of authentication:

### Layer 1: Kroger OAuth2 (User Authorization)

Required for cart operations and user-scoped product searches.

```
Browser                    Next.js Server             Kroger OAuth
  │                              │                         │
  │  1. Click "Sign in           │                         │
  │     with Kroger"             │                         │
  │─────────────────────────────>│                         │
  │                              │                         │
  │  2. Generate PKCE            │                         │
  │     code_verifier +          │                         │
  │     code_challenge           │                         │
  │                              │                         │
  │  3. Redirect to Kroger       │                         │
  │     /authorize?              │                         │
  │     client_id=...&           │                         │
  │     redirect_uri=...&        │                         │
  │     scope=product.compact    │                         │
  │       cart.basic:write       │                         │
  │       profile.compact&       │                         │
  │     code_challenge=...&      │                         │
  │     code_challenge_method    │                         │
  │       =S256                  │                         │
  │<─────────────────────────────┼─────────────────────────>
  │                              │                         │
  │  4. User logs into Kroger    │                         │
  │     and grants permission    │                         │
  │                              │                         │
  │  5. Kroger redirects to      │                         │
  │     callback with ?code=...  │                         │
  │─────────────────────────────>│                         │
  │                              │  6. POST /oauth2/token  │
  │                              │     grant_type=          │
  │                              │       authorization_code │
  │                              │     code=...            │
  │                              │     code_verifier=...   │
  │                              │────────────────────────>│
  │                              │                         │
  │                              │  7. Receive             │
  │                              │     access_token +      │
  │                              │     refresh_token       │
  │                              │<────────────────────────│
  │                              │                         │
  │  8. Session established      │                         │
  │     (tokens stored           │                         │
  │      server-side in          │                         │
  │      encrypted session)      │                         │
  │<─────────────────────────────│                         │
```

### Layer 2: Kroger Client Credentials (App-Level)

Used for unauthenticated endpoints (locations, chains) before the user signs in.

```
POST /v1/connect/oauth2/token
Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=product.compact
```

Returns an app-level token (30 min TTL) that can query products and locations
but cannot access user-specific features like cart.

---

## Component Architecture

```
App Layout
├── Header
│   ├── Logo / App Name
│   ├── Store Selector (dropdown)
│   └── Auth Button (Sign in / Sign out)
│
├── Main Content (two-column on desktop)
│   │
│   ├── Chat Panel (left / primary)
│   │   ├── Message List
│   │   │   ├── MessageBubble (user)
│   │   │   ├── MessageBubble (assistant)
│   │   │   │   └── Inline ProductCard (when Claude shows products)
│   │   │   └── MessageBubble (system / status)
│   │   └── InputBar
│   │       ├── Text Input
│   │       └── Send Button
│   │
│   └── Sidebar (right / secondary)
│       ├── Grocery List Panel
│       │   ├── Category headers (Produce, Dairy, Meat, etc.)
│       │   └── List items with quantity, price, status
│       │       (pending / matched / in-cart)
│       │
│       └── Cart Summary Panel
│           ├── Item count
│           ├── Estimated total
│           └── "Checkout on Kroger" button
│
└── Footer (minimal)
```

---

## State Management

v1 uses React Context with `useReducer` — no external state library.

### Contexts

| Context        | State                                      | Purpose                            |
|----------------|--------------------------------------------|------------------------------------|
| `ChatContext`  | messages[], isStreaming, error              | Conversation with Claude           |
| `StoreContext` | selectedStore, nearbyStores[], chain        | Current Kroger store               |
| `CartContext`  | items[], estimatedTotal, lastSyncedAt       | Local mirror of Kroger cart state  |

### Why Not a Global Store?

These three contexts have different lifecycles and consumer sets. The chat
panel doesn't need to re-render when the cart updates. Keeping them separate
avoids unnecessary re-renders without adding the complexity of a state
management library.

---

## Error Handling Strategy

| Error Source       | Handling                                                |
|--------------------|---------------------------------------------------------|
| Kroger token expired | Auto-refresh with refresh token; fall back to re-auth |
| Kroger rate limit  | Exponential backoff; show "try again" to user           |
| Kroger 404 product | Claude suggests alternatives via conversation           |
| Anthropic API error | Retry once; show error message in chat                 |
| Network failure    | Retry with backoff; offline indicator in UI             |

---

## Security Considerations

1. **Kroger credentials** — `KROGER_CLIENT_SECRET` never leaves the server.
   All Kroger API calls go through Next.js API routes.
2. **User tokens** — Stored in encrypted, httpOnly session cookies via
   NextAuth. Never exposed to client JavaScript.
3. **Anthropic key** — Server-side only, used exclusively in `/api/chat`.
4. **Input sanitization** — User chat input is passed to Claude as-is (it's a
   natural language interface), but any values used in Kroger API query
   parameters are URL-encoded.
5. **PKCE** — Prevents authorization code interception in the OAuth flow.
6. **No secrets in client bundle** — All `KROGER_*` and `ANTHROPIC_*` env vars
   are server-only (no `NEXT_PUBLIC_` prefix).
