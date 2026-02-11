import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CredentialStore } from "../credentials.js";
import type { ServiceCredentials } from "../credentials.js";

const tmpDir = path.join(os.tmpdir(), `agentdoor-creds-test-${Date.now()}`);
let store: CredentialStore;

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, "credentials.json");
  store = new CredentialStore(filePath);
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function makeCreds(overrides: Partial<ServiceCredentials> = {}): ServiceCredentials {
  return {
    agentId: "ag_test123",
    apiKey: "agk_live_testkey",
    token: "eyJ...",
    tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    scopesGranted: ["test.read"],
    storedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("CredentialStore.get", () => {
  it("returns null when no credentials are stored", () => {
    const result = store.get("https://api.example.com");
    expect(result).toBeNull();
  });

  it("returns null for an unknown URL when other URLs are stored", () => {
    store.save("https://api.example.com", makeCreds());
    const result = store.get("https://api.other.com");
    expect(result).toBeNull();
  });
});

describe("CredentialStore.save / get round-trip", () => {
  it("saves credentials and retrieves them by URL", () => {
    const creds = makeCreds();
    store.save("https://api.example.com", creds);

    const loaded = store.get("https://api.example.com");
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe(creds.agentId);
    expect(loaded!.apiKey).toBe(creds.apiKey);
    expect(loaded!.scopesGranted).toEqual(creds.scopesGranted);
  });

  it("overwrites existing credentials for the same URL", () => {
    store.save("https://api.example.com", makeCreds({ agentId: "ag_first" }));
    store.save("https://api.example.com", makeCreds({ agentId: "ag_second" }));

    const loaded = store.get("https://api.example.com");
    expect(loaded!.agentId).toBe("ag_second");
  });

  it("stores credentials for multiple services independently", () => {
    store.save("https://api.alpha.com", makeCreds({ agentId: "ag_alpha" }));
    store.save("https://api.beta.com", makeCreds({ agentId: "ag_beta" }));

    expect(store.get("https://api.alpha.com")!.agentId).toBe("ag_alpha");
    expect(store.get("https://api.beta.com")!.agentId).toBe("ag_beta");
  });
});

describe("CredentialStore.hasValidCredentials", () => {
  it("returns false when no credentials exist", () => {
    expect(store.hasValidCredentials("https://api.example.com")).toBe(false);
  });

  it("returns true when apiKey is present", () => {
    store.save("https://api.example.com", makeCreds({ apiKey: "agk_live_valid" }));
    expect(store.hasValidCredentials("https://api.example.com")).toBe(true);
  });

  it("returns true even when token is missing if apiKey is present", () => {
    store.save(
      "https://api.example.com",
      makeCreds({ apiKey: "agk_live_valid", token: undefined, tokenExpiresAt: undefined }),
    );
    expect(store.hasValidCredentials("https://api.example.com")).toBe(true);
  });
});

describe("CredentialStore.hasValidToken", () => {
  it("returns false when no credentials exist", () => {
    expect(store.hasValidToken("https://api.example.com")).toBe(false);
  });

  it("returns false when there is no token", () => {
    store.save(
      "https://api.example.com",
      makeCreds({ token: undefined, tokenExpiresAt: undefined }),
    );
    expect(store.hasValidToken("https://api.example.com")).toBe(false);
  });

  it("returns true when token is present and not expired", () => {
    const futureExpiry = new Date(Date.now() + 3600000).toISOString();
    store.save(
      "https://api.example.com",
      makeCreds({ token: "valid.jwt.token", tokenExpiresAt: futureExpiry }),
    );
    expect(store.hasValidToken("https://api.example.com")).toBe(true);
  });

  it("returns false when token is expired", () => {
    const pastExpiry = new Date(Date.now() - 60000).toISOString();
    store.save(
      "https://api.example.com",
      makeCreds({ token: "expired.jwt.token", tokenExpiresAt: pastExpiry }),
    );
    expect(store.hasValidToken("https://api.example.com")).toBe(false);
  });
});

describe("CredentialStore.remove", () => {
  it("removes stored credentials and returns true", () => {
    store.save("https://api.example.com", makeCreds());

    const removed = store.remove("https://api.example.com");
    expect(removed).toBe(true);
    expect(store.get("https://api.example.com")).toBeNull();
  });

  it("returns false when removing credentials that do not exist", () => {
    const removed = store.remove("https://api.nonexistent.com");
    expect(removed).toBe(false);
  });

  it("does not affect other stored services", () => {
    store.save("https://api.alpha.com", makeCreds({ agentId: "ag_alpha" }));
    store.save("https://api.beta.com", makeCreds({ agentId: "ag_beta" }));

    store.remove("https://api.alpha.com");

    expect(store.get("https://api.alpha.com")).toBeNull();
    expect(store.get("https://api.beta.com")!.agentId).toBe("ag_beta");
  });
});

describe("CredentialStore.listServices", () => {
  it("returns an empty array when no services are stored", () => {
    expect(store.listServices()).toEqual([]);
  });

  it("returns all stored service URLs", () => {
    store.save("https://api.alpha.com", makeCreds());
    store.save("https://api.beta.com", makeCreds());

    const services = store.listServices();
    expect(services).toHaveLength(2);
    expect(services).toContain("https://api.alpha.com");
    expect(services).toContain("https://api.beta.com");
  });
});

describe("CredentialStore.clear", () => {
  it("removes all stored credentials", () => {
    store.save("https://api.alpha.com", makeCreds());
    store.save("https://api.beta.com", makeCreds());

    store.clear();

    expect(store.listServices()).toEqual([]);
    expect(store.get("https://api.alpha.com")).toBeNull();
    expect(store.get("https://api.beta.com")).toBeNull();
  });

  it("is safe to call when store is already empty", () => {
    expect(() => store.clear()).not.toThrow();
    expect(store.listServices()).toEqual([]);
  });
});

describe("URL normalization", () => {
  it("normalizes bare hostname to https:// URL", () => {
    store.save("api.example.com", makeCreds({ agentId: "ag_bare" }));

    const loaded = store.get("https://api.example.com");
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("ag_bare");
  });

  it("treats bare hostname and https:// URL as the same key", () => {
    store.save("api.example.com", makeCreds({ agentId: "ag_first" }));
    store.save("https://api.example.com", makeCreds({ agentId: "ag_second" }));

    // The second save should overwrite the first since they normalize to the same key
    const services = store.listServices();
    expect(services).toHaveLength(1);
    expect(store.get("api.example.com")!.agentId).toBe("ag_second");
  });

  it("strips trailing slashes during normalization", () => {
    store.save("https://api.example.com/", makeCreds({ agentId: "ag_slashed" }));

    const loaded = store.get("https://api.example.com");
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("ag_slashed");
  });
});

describe("CredentialStore.updateToken", () => {
  it("updates token fields for an existing service", () => {
    store.save("https://api.example.com", makeCreds());

    const newExpiry = new Date(Date.now() + 7200000).toISOString();
    store.updateToken("https://api.example.com", "new.jwt.token", newExpiry);

    const loaded = store.get("https://api.example.com");
    expect(loaded!.token).toBe("new.jwt.token");
    expect(loaded!.tokenExpiresAt).toBe(newExpiry);
    // Other fields should remain unchanged
    expect(loaded!.agentId).toBe("ag_test123");
    expect(loaded!.apiKey).toBe("agk_live_testkey");
  });

  it("throws when updating token for a non-existent service", () => {
    expect(() =>
      store.updateToken("https://api.nonexistent.com", "token", new Date().toISOString()),
    ).toThrow("no stored credentials found");
  });
});
