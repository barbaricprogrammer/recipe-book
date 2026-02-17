terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Store state in Azure Storage so CI and all contributors share the same state.
  # The storage account + container must exist before the first `terraform init`.
  # See docs/DEPLOYMENT.md for bootstrap instructions.
  backend "azurerm" {
    resource_group_name  = "rg-grocery-planner-tfstate"
    storage_account_name = "stgroceryplannertf"
    container_name       = "tfstate"
    key                  = "grocery-planner.tfstate"
  }
}

provider "azurerm" {
  features {}
}

# --------------------------------------------------------------------------- #
#  Resource Group
# --------------------------------------------------------------------------- #

resource "azurerm_resource_group" "main" {
  name     = "rg-grocery-planner-${var.environment}"
  location = var.location

  tags = local.tags
}

# --------------------------------------------------------------------------- #
#  App Service Plan (Linux)
# --------------------------------------------------------------------------- #

resource "azurerm_service_plan" "main" {
  name                = "plan-grocery-planner-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = var.app_service_sku

  tags = local.tags
}

# --------------------------------------------------------------------------- #
#  App Service (Node 22 LTS)
# --------------------------------------------------------------------------- #

resource "azurerm_linux_web_app" "main" {
  name                = "app-grocery-planner-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  service_plan_id     = azurerm_service_plan.main.id

  https_only = true

  site_config {
    always_on = var.app_service_sku != "F1" # Free tier doesn't support always_on

    application_stack {
      node_version = "22-lts"
    }

    app_command_line = "node server.js"
  }

  app_settings = {
    # Next.js
    WEBSITE_NODE_DEFAULT_VERSION = "~22"
    PORT                         = "8080"
    WEBSITES_PORT                = "8080"

    # Application secrets are set via GitHub Actions per-environment,
    # not in Terraform, to keep secrets out of state files.
    # See: .github/workflows/deploy.yml

    # Kroger OAuth redirect must match the deployed URL
    KROGER_REDIRECT_URI = "https://app-grocery-planner-${var.environment}.azurewebsites.net/auth/kroger/callback"
    NEXTAUTH_URL        = "https://app-grocery-planner-${var.environment}.azurewebsites.net"
  }

  tags = local.tags
}

# --------------------------------------------------------------------------- #
#  Staging Deployment Slot (production environment only)
# --------------------------------------------------------------------------- #

resource "azurerm_linux_web_app_slot" "staging" {
  count          = var.environment == "prod" ? 1 : 0
  name           = "staging"
  app_service_id = azurerm_linux_web_app.main.id

  https_only = true

  site_config {
    always_on = var.app_service_sku != "F1"

    application_stack {
      node_version = "22-lts"
    }

    app_command_line = "node server.js"
  }

  app_settings = {
    WEBSITE_NODE_DEFAULT_VERSION = "~22"
    PORT                         = "8080"
    WEBSITES_PORT                = "8080"

    KROGER_REDIRECT_URI = "https://app-grocery-planner-${var.environment}-staging.azurewebsites.net/auth/kroger/callback"
    NEXTAUTH_URL        = "https://app-grocery-planner-${var.environment}-staging.azurewebsites.net"
  }

  tags = local.tags
}

# --------------------------------------------------------------------------- #
#  Locals
# --------------------------------------------------------------------------- #

locals {
  tags = {
    project     = "grocery-planner"
    environment = var.environment
    managed_by  = "terraform"
  }
}
