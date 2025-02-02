import axios, { AxiosError } from "axios";
import * as child_process from "child_process";
import { Process, config, utils, specHelper } from "../../../src/index";

const actionhero = new Process();
let url: string;

async function exec(command: string) {
  return new Promise((resolve, reject) => {
    child_process.exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      return resolve({ stdout, stderr });
    });
  });
}

describe("Core", () => {
  describe("static file", () => {
    beforeAll(async () => {
      await actionhero.start();
      if (config.web) {
        url =
          "http://localhost:" +
          config.web.port +
          "/" +
          config.web.urlPathForFiles;
      }
    });

    afterAll(async () => {
      await actionhero.stop();
    });

    test("file: an HTML file", async () => {
      const response = await specHelper.getStaticFile("simple.html");
      expect(response.mime).toEqual("text/html");
      expect(response.content).toContain("<h1>Actionhero</h1>");
    });

    test("file: 404 pages", async () => {
      const response = await specHelper.getStaticFile("someRandomFile");
      expect(response.error).toEqual("that file is not found");
      expect(response.content).toBeNull();
    });

    test("I should not see files outside of the public dir", async () => {
      const response = await specHelper.getStaticFile("../config/config.json");
      expect(response.error).toEqual("that file is not found");
      expect(response.content).toBeNull();
    });

    test("file: sub paths should work", async () => {
      const response = await specHelper.getStaticFile("logo/actionhero.png");
      expect(response.mime).toEqual("image/png");
      expect(response.length).toEqual(59273);
      // wacky per-OS encoding issues I guess?
      expect(response.content.length).toBeGreaterThanOrEqual(50000);
      expect(response.content.length).toBeLessThan(60000);
    });

    test("should send back the cache-control header", async () => {
      const response = await axios.get(url + "/simple.html");
      expect(response.status).toEqual(200);
      expect(response.headers["cache-control"]).toBeTruthy();
    });

    test("should send back the etag header", async () => {
      const response = await axios.get(url + "/simple.html");
      expect(response.status).toEqual(200);
      expect(response.headers.etag).toBeTruthy();
    });

    test('should send back a 304 if the header "if-modified-since" is present and condition matches', async () => {
      const response = await axios.get(url + "/simple.html");
      expect(response.status).toEqual(200);

      try {
        await axios(url + "/simple.html", {
          headers: { "If-Modified-Since": new Date().toUTCString() },
        });
        throw new Error("should not get here");
      } catch (error) {
        if (error instanceof AxiosError) {
          expect(error.toString()).toMatch(/304/);
        } else throw error;
      }
    });

    test("should send back a 304 if the ETAG header is present", async () => {
      const response = await axios.get(url + "/simple.html");
      expect(response.status).toEqual(200);
      expect(response.data).toContain("<h1>Actionhero</h1>");
      expect(response.headers.etag).toBeTruthy();

      const etag = response.headers.etag;
      const options = {
        headers: { "If-None-Match": etag },
        resolveWithFullResponse: true,
      };

      try {
        await axios(url + "/simple.html", options);
        throw new Error("should not get here");
      } catch (error) {
        if (error instanceof AxiosError) {
          expect(error.toString()).toMatch(/304/);
        } else throw error;
      }
    });

    test("should send a different etag for other files", async () => {
      const response = await axios.get(url + "/simple.html");
      expect(response.status).toEqual(200);
      expect(response.headers.etag).toBeTruthy();
      const etag = response.headers.etag;

      const secondResponse = await axios.get(url + "/index.html");
      expect(secondResponse.status).toEqual(200);
      expect(secondResponse.headers.etag).toBeTruthy();
      const etagTwo = secondResponse.headers.etag;
      expect(etagTwo).not.toEqual(etag);
    });

    test('should send back the file if the header "if-modified-since" is present but condition does not match', async () => {
      const response = await axios.get(url + "/simple.html");
      expect(response.status).toEqual(200);
      const lastModified = new Date(response.headers["last-modified"]);
      const delay = 24 * 1000 * 3600;

      const secondResponse = await axios(url + "/simple.html", {
        headers: {
          "If-Modified-Since": new Date(
            lastModified.getTime() - delay
          ).toUTCString(),
        },
      });

      expect(secondResponse.status).toEqual(200);
      expect(secondResponse.data.length).toBeGreaterThan(1);
    });

    if (process.platform === "win32") {
      console.log(
        "*** CANNOT RUN FILE DESCRIPTOR TESTS ON WINDOWS.  Sorry. ***"
      );
    } else {
      describe("do not leave open file descriptors ", () => {
        const lsofChk = async () => {
          //@ts-ignore
          const { stdout } = await exec('lsof -n -P|grep "/simple.html"|wc -l');
          return stdout.trim();
        };

        test("closes all descriptors on statusCode 200 responses", async () => {
          const response = await axios.get(url + "/simple.html");
          expect(response.status).toEqual(200);
          await utils.sleep(100);
          expect(await lsofChk()).toEqual("0");
        }, 30000);

        test("closes all descriptors on statusCode 304 responses", async () => {
          try {
            await axios.get(url + "/simple.html", {
              headers: { "if-none-match": "*" },
            });
            throw new Error("should return 304");
          } catch (error) {
            if (error instanceof AxiosError) {
              expect(error.response?.status).toEqual(304);
              await utils.sleep(100);
              expect(await lsofChk()).toEqual("0");
            } else throw error;
          }
        }, 30000);
      });
    }
  });
});
