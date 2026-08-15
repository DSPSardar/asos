import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// Production marketing/landing page for the ASOS (AI Sales OS) app.
const APP_URL = "https://dspagenthub.com";

describe("ASOS landing page", () => {
  it("loads the production marketing page with hero and navigation", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: APP_URL });

    // Give the SPA a moment to hydrate.
    await testdriver.wait(3000);

    const assertResult = await testdriver.assert(
      'The ASOS landing page is loaded, showing the headline "Close deals while you sleep" and a top navigation with a "Sign in" link and "Start free trial" button',
    );
    expect(assertResult).toBeTruthy();
  });
});
