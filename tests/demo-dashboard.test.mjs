import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// The auth page offers a passwordless "Skip login — enter demo instantly"
// path that drops the user straight into the dashboard demo workspace.
// This lets us exercise the authenticated shell in production without any
// real credentials or fixtures.
describe("ASOS demo workspace", () => {
  it("enters the demo dashboard via Skip login", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: "https://dspagenthub.com/auth" });
    await testdriver.wait(2000);

    // Click the passwordless demo entry button on the auth page.
    await (
      await testdriver.find(
        "the \"Skip login — enter demo instantly\" button at the bottom of the auth form",
      )
    ).click();

    // Give the SPA time to route into the dashboard.
    await testdriver.wait(4000);

    // We should land in the dashboard / demo workspace.
    const dashboardVisible = await testdriver.assert(
      "the dashboard workspace is visible (a logged-in app view with a sidebar or navigation, not the login form)",
    );
    expect(dashboardVisible).toBeTruthy();
  });
});
