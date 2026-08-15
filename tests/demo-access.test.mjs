import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// Production ASOS (AI Sales OS) auth page. The auth screen exposes a
// "Skip login — enter demo instantly" button that drops straight into the
// dashboard in a read-only demo workspace — a safe, credential-free flow to
// exercise against production.
const AUTH_URL = "https://dspagenthub.com/auth";

describe("ASOS demo access", () => {
  it('enters the demo workspace via "Skip login" and lands on the dashboard', async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: AUTH_URL });

    // Give the SPA a moment to hydrate the auth form.
    await testdriver.wait(3000);

    // Confirm the demo entry point is present before clicking it.
    const skipVisible = await testdriver.assert(
      'A "Skip login — enter demo instantly" button is visible near the bottom of the auth card',
    );
    expect(skipVisible).toBeTruthy();

    // Enter the demo workspace — this navigates to the dashboard.
    await testdriver
      .find('The "Skip login — enter demo instantly" button (pill button with a green dot)')
      .click();

    // Wait for the client-side navigation to the dashboard to complete.
    await testdriver.wait(4000);

    const dashboardVisible = await testdriver.assert(
      "The app has left the login page and is now showing the ASOS dashboard / sales workspace (e.g. navigation to leads, contacts, pipeline, or a dashboard overview)",
    );
    expect(dashboardVisible).toBeTruthy();
  });
});
