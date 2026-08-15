import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

// Production ASOS (AI Sales OS) auth page.
const AUTH_URL = "https://dspagenthub.com/auth";

describe("ASOS auth page", () => {
  it("shows the login form and can switch to the register tab", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: AUTH_URL });

    // Give the SPA a moment to hydrate the auth form.
    await testdriver.wait(3000);

    // Login form is the default tab.
    const loginVisible = await testdriver.assert(
      'The login form is visible with a "Welcome back" heading, an Email input, a Password input, and a "Sign In" submit button',
    );
    expect(loginVisible).toBeTruthy();

    // Switch to the "Get Started" (register) tab.
    await testdriver.find('The "Get Started" tab in the auth form tab switcher').click();
    await testdriver.wait(1500);

    const registerVisible = await testdriver.assert(
      'The registration form is now shown with a "Start free trial" heading and a "Your Name" input field',
    );
    expect(registerVisible).toBeTruthy();
  });
});
