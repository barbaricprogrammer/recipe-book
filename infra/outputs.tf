output "resource_group_name" {
  description = "Name of the resource group"
  value       = azurerm_resource_group.main.name
}

output "app_service_name" {
  description = "Name of the App Service"
  value       = azurerm_linux_web_app.main.name
}

output "app_service_default_hostname" {
  description = "Default hostname of the App Service"
  value       = azurerm_linux_web_app.main.default_hostname
}

output "app_url" {
  description = "Full URL of the deployed application"
  value       = "https://${azurerm_linux_web_app.main.default_hostname}"
}

output "staging_url" {
  description = "URL of the staging slot (prod environment only)"
  value       = var.environment == "prod" ? "https://${azurerm_linux_web_app_slot.staging[0].default_hostname}" : null
}
