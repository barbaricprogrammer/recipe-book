import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KrogerAuthManager, KrogerUserTokenManager } from "../auth";

const MOCK_TOKEN_RESPONSE = {
  access_token: "mock-access-token",
  expires_in: 1800,
  token_type: "bearer",
};

const MOCK_REFRESH_RESPONSE = {
  access_token: "refreshed-access-token",
  expires_in: 1800,
  token_type: "bearer",
  refresh_token: "new-refresh-token",
};

function mockFetchSuccess(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchFailure(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

describe("KrogerAuthManager", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches a new token when none is cached", async () => {
    globalThis.fetch = mockFetchSuccess(MOCK_TOKEN_RESPONSE);
    const auth = new KrogerAuthManager("client-id", "client-secret");

    const token = await auth.getToken();

    expect(token).toBe("mock-access-token");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.kroger.com/v1/connect/oauth2/token");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toMatch(/^Basic /);
    expect(options.body).toContain("grant_type=client_credentials");
    expect(options.body).toContain("scope=product.compact");
  });

  it("sends correct base64 credentials", async () => {
    globalThis.fetch = mockFetchSuccess(MOCK_TOKEN_RESPONSE);
    const auth = new KrogerAuthManager("my-id", "my-secret");

    await auth.getToken();

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const expected = Buffer.from("my-id:my-secret").toString("base64");
    expect(options.headers.Authorization).toBe(`Basic ${expected}`);
  });

  it("uses custom scope when provided", async () => {
    globalThis.fetch = mockFetchSuccess(MOCK_TOKEN_RESPONSE);
    const auth = new KrogerAuthManager("id", "secret");

    await auth.getToken("cart.basic:write");

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(options.body).toContain(
      "scope=" + encodeURIComponent("cart.basic:write")
    );
  });

  it("returns cached token on subsequent calls", async () => {
    globalThis.fetch = mockFetchSuccess(MOCK_TOKEN_RESPONSE);
    const auth = new KrogerAuthManager("id", "secret");

    const token1 = await auth.getToken();
    const token2 = await auth.getToken();

    expect(token1).toBe("mock-access-token");
    expect(token2).toBe("mock-access-token");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches token when cached token expires", async () => {
    const fetchMock = mockFetchSuccess(MOCK_TOKEN_RESPONSE);
    globalThis.fetch = fetchMock;
    const auth = new KrogerAuthManager("id", "secret");

    // Mock Date.now to simulate time passing
    const realNow = Date.now;
    const startTime = realNow();

    // First call — gets token
    vi.spyOn(Date, "now").mockReturnValue(startTime);
    await auth.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Move time past expiry (1800s - 60s buffer = 1740s)
    vi.spyOn(Date, "now").mockReturnValue(startTime + 1741 * 1000);
    await auth.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = mockFetchFailure(401, "Invalid credentials");
    const auth = new KrogerAuthManager("bad-id", "bad-secret");

    await expect(auth.getToken()).rejects.toThrow(
      "Kroger token request failed (401): Invalid credentials"
    );
  });
});

describe("KrogerUserTokenManager", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports isConfigured=false when no tokens provided", () => {
    const mgr = new KrogerUserTokenManager("id", "secret");
    expect(mgr.isConfigured).toBe(false);
  });

  it("reports isConfigured=true when access token provided", () => {
    const mgr = new KrogerUserTokenManager("id", "secret", "token");
    expect(mgr.isConfigured).toBe(true);
  });

  it("reports isConfigured=true when refresh token provided", () => {
    const mgr = new KrogerUserTokenManager(
      "id",
      "secret",
      undefined,
      "refresh"
    );
    expect(mgr.isConfigured).toBe(true);
  });

  it("returns cached access token when still valid", async () => {
    const mgr = new KrogerUserTokenManager("id", "secret", "my-token");
    const token = await mgr.getToken();
    expect(token).toBe("my-token");
  });

  it("refreshes when access token is expired but refresh token exists", async () => {
    globalThis.fetch = mockFetchSuccess(MOCK_REFRESH_RESPONSE);

    const mgr = new KrogerUserTokenManager(
      "id",
      "secret",
      "expired-token",
      "my-refresh-token"
    );

    // Force token to be expired
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 2_000_000);

    const token = await mgr.getToken();
    expect(token).toBe("refreshed-access-token");

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.kroger.com/v1/connect/oauth2/token");
    expect(options.body).toContain("grant_type=refresh_token");
    expect(options.body).toContain("refresh_token=my-refresh-token");
  });

  it("throws when no valid token and no refresh token", async () => {
    const mgr = new KrogerUserTokenManager("id", "secret");
    await expect(mgr.getToken()).rejects.toThrow(
      "No valid user token available"
    );
  });

  it("throws on refresh failure", async () => {
    globalThis.fetch = mockFetchFailure(401, "Invalid refresh token");

    const mgr = new KrogerUserTokenManager(
      "id",
      "secret",
      undefined,
      "bad-refresh"
    );

    await expect(mgr.getToken()).rejects.toThrow(
      "Kroger token refresh failed (401)"
    );
  });
});
