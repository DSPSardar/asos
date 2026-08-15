import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// Smoke test for the ASOS / DSP Agent Hub marketing landing page in production.
// Verifies the public homepage renders its hero and primary call-to-action.
describe("ASOS landing page", () => {
  it("loads the marketing homepage with hero and CTA", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: "https://dspagenthub.com" });

    // The hero headline should be present.
    const heroVisible = await testdriver.assert(
      'the hero headline "Close deals while you sleep." is visible',
    );
    expect(heroVisible).toBeTruthy();

    // The primary call-to-action to start a free trial should be present.
    const ctaVisible = await testdriver.assert(
      'a "Start free trial" call-to-action button is visible',
    );
    expect(ctaVisible).toBeTruthy();
  });
});
