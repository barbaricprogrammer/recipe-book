// Kroger API type definitions
// Based on https://developer.kroger.com/reference/

// --- Authentication ---

export interface KrogerTokenResponse {
  expires_in: number;
  access_token: string;
  token_type: string;
  refresh_token?: string;
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
}

// --- Products ---

export interface KrogerProductImage {
  perspective: string;
  featured?: boolean;
  sizes: Array<{
    size: "thumbnail" | "small" | "medium" | "large" | "xlarge";
    url: string;
  }>;
}

export interface KrogerAisleLocation {
  bayNumber?: string;
  description: string;
  number?: string;
  numberOfFacings?: string;
  side?: string;
  shelfNumber?: string;
  shelfPositionInBay?: string;
}

export interface KrogerProductPrice {
  regular: number;
  promo: number;
}

export interface KrogerFulfillment {
  curbside: boolean;
  delivery: boolean;
  inStore: boolean;
  shipToHome?: boolean;
}

export interface KrogerProductItem {
  itemId: string;
  favorite?: boolean;
  fulfillment: KrogerFulfillment;
  price?: KrogerProductPrice;
  size?: string;
  soldBy?: string;
}

export interface KrogerProduct {
  productId: string;
  upc: string;
  brand: string;
  description: string;
  images: KrogerProductImage[];
  items: KrogerProductItem[];
  categories: string[];
  aisleLocations: KrogerAisleLocation[];
  itemInformation?: {
    depth?: string;
    height?: string;
    width?: string;
  };
  temperature?: {
    indicator?: string;
    heatSensitive?: boolean;
  };
}

export interface KrogerPagination {
  start: number;
  limit: number;
  total: number;
}

export interface KrogerProductsResponse {
  data: KrogerProduct[];
  meta: {
    pagination: KrogerPagination;
  };
}

export interface KrogerProductResponse {
  data: KrogerProduct;
}

// --- Locations ---

export interface KrogerAddress {
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  county?: string;
}

export interface KrogerGeolocation {
  latitude: number;
  longitude: number;
  latLng?: string;
}

export interface KrogerDepartment {
  departmentId: string;
  name: string;
  phone?: string;
  hours?: Record<string, unknown>;
}

export interface KrogerLocation {
  locationId: string;
  chain: string;
  name: string;
  address: KrogerAddress;
  geolocation: KrogerGeolocation;
  phone?: string;
  departments: KrogerDepartment[];
  hours?: Record<string, unknown>;
}

export interface KrogerLocationsResponse {
  data: KrogerLocation[];
}

export interface KrogerLocationResponse {
  data: KrogerLocation;
}

// --- Cart ---

export interface KrogerCartItem {
  upc: string;
  quantity: number;
}

export interface KrogerCartAddRequest {
  items: KrogerCartItem[];
}

// --- Chains ---

export interface KrogerChain {
  name: string;
}

export interface KrogerChainsResponse {
  data: KrogerChain[];
}
