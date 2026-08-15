import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// Verifies the sign-in navigation from the landing page and that the
// login form on the /auth page renders in production.
describe("ASOS authentication page", () => {
  it("navigates from the landing page to the login form", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: "https://dspagenthub.com" });

    // Click the "Sign in" link in the top navigation.
    await (await testdriver.find("the \"Sign in\" link in the top navigation bar")).click();
    await testdriver.wait(2500);

    // We should now be on the auth page showing the login form.
    const loginFormVisible = await testdriver.assert(
      'the login form is visible with a "Welcome back" heading, an Email field, and a Password field',
    );
    expect(loginFormVisible).toBeTruthy();

    // The passwordless demo entry point should also be available.
    const demoButtonVisible = await testdriver.assert(
      'a "Skip login — enter demo instantly" button is visible',
    );
    expect(demoButtonVisible).toBeTruthy();
  });
});
