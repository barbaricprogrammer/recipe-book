# Deployment

The app runs on **Azure App Service (Linux, Node 22)** with infrastructure
managed by **Terraform** and deployments handled by **GitHub Actions**.

---

## Architecture

```
GitHub Actions
├── infra.yml     → Terraform plan/apply (provisions Azure resources)
└── deploy.yml    → Build Next.js → deploy to staging → swap to production

Azure
├── Resource Group: rg-grocery-planner-staging
│   └── App Service Plan + App Service (staging environment)
│
└── Resource Group: rg-grocery-planner-prod
    └── App Service Plan + App Service (production)
        └── Deployment Slot: staging (pre-production validation)
```

### Deployment Flow

```
Push to main
  │
  ├─► infra.yml (if infra/ changed)
  │     Plan staging → Apply staging → Plan prod → Apply prod (gated)
  │
  └─► deploy.yml (if app code changed)
        Build & test → Deploy to staging slot → Swap to production (gated)
```

Production deployments require **manual approval** via GitHub environment
protection rules.

---

## Prerequisites

### 1. Azure Subscription

You need an Azure subscription with credits. The App Service B1 tier costs
approximately $13/month.

### 2. Terraform State Storage (one-time bootstrap)

Terraform needs a storage account to keep its state file. This is the one
resource you create manually (or via a small bootstrap script) before everything
else is automated.

Run this in the Azure Portal Cloud Shell or locally with `az` CLI:

```bash
# Create a resource group for TF state
az group create \
  --name rg-grocery-planner-tfstate \
  --location eastus

# Create a storage account (name must be globally unique)
az storage account create \
  --name stgroceryplannertf \
  --resource-group rg-grocery-planner-tfstate \
  --sku Standard_LRS \
  --encryption-services blob

# Create a blob container
az storage container create \
  --name tfstate \
  --account-name stgroceryplannertf
```

### 3. Azure Service Principal (OIDC for GitHub Actions)

GitHub Actions authenticates to Azure via OIDC (no stored credentials). Create a
service principal with federated identity:

```bash
# Create an app registration
az ad app create --display-name "github-grocery-planner"

# Note the appId from the output, then create a service principal
az ad sp create --id <appId>

# Assign Contributor role on the subscription (or scope to resource groups)
az role assignment create \
  --assignee <appId> \
  --role Contributor \
  --scope /subscriptions/<subscription-id>

# Add federated credentials for GitHub Actions
# Repeat for each branch/environment as needed
az ad app federated-credential create \
  --id <appId> \
  --parameters '{
    "name": "github-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<org>/<repo>:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id <appId> \
  --parameters '{
    "name": "github-staging-env",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<org>/<repo>:environment:staging",
    "audiences": ["api://AzureADTokenExchange"]
  }'

az ad app federated-credential create \
  --id <appId> \
  --parameters '{
    "name": "github-production-env",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<org>/<repo>:environment:production",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

### 4. GitHub Configuration

#### Environments

Create two environments in **Settings → Environments**:

| Environment | Protection Rules |
|-------------|-----------------|
| `staging` | None (auto-deploy) |
| `production` | Required reviewers (1+) |

#### Secrets

Set these secrets at the **repository level** (shared by all environments):

| Secret | Source |
|--------|--------|
| `AZURE_CLIENT_ID` | App registration appId |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `TF_STATE_RESOURCE_GROUP` | `rg-grocery-planner-tfstate` |
| `TF_STATE_STORAGE_ACCOUNT` | `stgroceryplannertf` |

Set these secrets **per environment** (staging and production may differ):

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `KROGER_CLIENT_ID` | Kroger OAuth client ID |
| `KROGER_CLIENT_SECRET` | Kroger OAuth client secret |
| `NEXTAUTH_SECRET` | Random secret (`openssl rand -base64 32`) |

---

## Terraform

All infrastructure code lives in `infra/`.

```
infra/
├── main.tf                    # Resources (RG, App Service Plan, App Service, slots)
├── variables.tf               # Input variables
├── outputs.tf                 # Output values (URLs, resource names)
└── environments/
    ├── staging.tfvars         # Variable values for staging
    └── prod.tfvars            # Variable values for production
```

### What Terraform Manages

- Resource groups
- App Service Plans (Linux, B1 SKU)
- App Services (Node 22 LTS) with standalone Next.js config
- Deployment slots (staging slot on production only)
- Non-secret app settings (PORT, KROGER_REDIRECT_URI, NEXTAUTH_URL)

### What Terraform Does NOT Manage

- Application secrets (ANTHROPIC_API_KEY, KROGER_CLIENT_SECRET, etc.) — these
  are injected by GitHub Actions from environment secrets to avoid storing them
  in Terraform state.
- The Terraform state storage account (bootstrapped manually).
- DNS / custom domains (add later if needed).

---

## App Deployment

The deploy workflow (`.github/workflows/deploy.yml`) runs on every push to
`main` that changes app code:

1. **Build & Test** — `npm ci`, lint, typecheck, unit tests, `next build`
2. **Deploy to Staging** — uploads the standalone build to the staging
   deployment slot, configures secrets via `az webapp config`
3. **Deploy to Production** — after manual approval, swaps the staging slot to
   production (zero-downtime)

### Standalone Build

`next.config.js` includes `output: "standalone"` which produces a self-contained
`server.js` with only the required `node_modules`. The deploy workflow assembles
the artifact:

```
deploy/
├── server.js          # Entry point (started by App Service)
├── node_modules/      # Only production dependencies
├── .next/static/      # Static assets
└── public/            # Public files
```

### Manual Deployment

Use `workflow_dispatch` to trigger a deploy without pushing code:

**Actions → Deploy → Run workflow → main**

---

## Environment URLs

| Environment | URL |
|-------------|-----|
| Staging slot | `https://app-grocery-planner-prod-staging.azurewebsites.net` |
| Production | `https://app-grocery-planner-prod.azurewebsites.net` |

Update `KROGER_REDIRECT_URI` in Kroger's developer portal to include both
callback URLs:
- `https://app-grocery-planner-prod.azurewebsites.net/auth/kroger/callback`
- `https://app-grocery-planner-prod-staging.azurewebsites.net/auth/kroger/callback`
- `http://localhost:3000/auth/kroger/callback` (for local dev)

---

## Cost Estimate

| Resource | SKU | ~Monthly Cost |
|----------|-----|---------------|
| App Service Plan (staging) | B1 | $13 |
| App Service Plan (prod) | B1 | $13 |
| Storage (TF state) | Standard LRS | < $1 |
| **Total** | | **~$27/month** |

Scale to S1 (~$69/month per plan) if you need deployment slots, auto-scale, or
custom domains with SSL.
