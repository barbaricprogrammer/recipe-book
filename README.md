# Grocery Planner

AI-powered grocery planning and purchasing app that uses Claude to generate meal plans and integrates with the Kroger API to search products, compare prices, and add items to your cart.

## How It Works

1. Describe your meal preferences, budget, and household size
2. Claude generates a meal plan and shopping list
3. The app searches the Kroger catalog for matching products
4. Review and confirm your selections
5. Items are added to your Kroger cart for checkout

## Architecture

- **Next.js 14** (App Router) with React 18 and TypeScript
- **Kroger MCP Server** — exposes Kroger API operations as [Model Context Protocol](https://modelcontextprotocol.io) tools
- **Kroger API Client** — typed client with OAuth2 token management
- **Claude API** — powers meal planning and conversational grocery assistance

## Getting Started

### Prerequisites

- Node.js 22+
- A [Kroger Developer](https://developer.kroger.com) account (for API credentials)
- An [Anthropic](https://console.anthropic.com) API key

### Setup

```bash
git clone <repo-url>
cd recipe-book
npm install
cp .env.example .env
```

Fill in your `.env` file:

```
ANTHROPIC_API_KEY=           # from console.anthropic.com
KROGER_CLIENT_ID=            # from developer.kroger.com
KROGER_CLIENT_SECRET=        # from developer.kroger.com
NEXTAUTH_SECRET=             # generate with: openssl rand -base64 32
```

### Run

```bash
npm run dev          # Start Next.js dev server at localhost:3000
npm run mcp:kroger   # Start the Kroger MCP server (stdio)
```

## MCP Server

The Kroger MCP server (`src/mcp/`) exposes six tools over stdio transport:

| Tool | Description |
|------|-------------|
| `search_products` | Search the Kroger catalog by keyword, brand, or fulfillment type |
| `get_product_details` | Get full details for a product by ID |
| `find_stores` | Find nearby Kroger-family stores by zip code or coordinates |
| `get_store_details` | Get store departments and hours |
| `add_to_cart` | Add items to an authenticated user's Kroger cart |
| `get_chains` | List all Kroger-family chains (Kroger, Harris Teeter, Fred Meyer, etc.) |

### Using with Claude Desktop

Add to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "kroger": {
      "command": "npx",
      "args": ["tsx", "src/mcp/index.ts"],
      "cwd": "/path/to/recipe-book",
      "env": {
        "KROGER_CLIENT_ID": "your-client-id",
        "KROGER_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint + Prettier |
| `npm run typecheck` | TypeScript type checking |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests (requires Kroger credentials) |
| `npm run test:all` | All tests |
| `npm run test:coverage` | Coverage report |
| `npm run mcp:kroger` | Start Kroger MCP server |

## Project Structure

```
src/
  mcp/              # MCP server (entry point, tool definitions, tests)
  lib/kroger/       # Kroger API client, auth manager, types
  app/              # Next.js App Router pages
  components/       # React components
  context/          # React Context state management
  types/            # Shared TypeScript types
docs/
  ARCHITECTURE.md   # System architecture and data flow
  API_INTEGRATION.md # Kroger & Anthropic API reference
```

## CI

GitHub Actions runs automatically on PRs and merges to main:

- **PRs**: lint, type-check, unit tests
- **Push to main**: lint, type-check, unit tests, integration tests

See `.github/workflows/ci.yml`.

## License

Private
