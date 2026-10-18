import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

export type ReceiptPaperWidth = "mm58" | "mm80";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const DOT_WIDTH: Record<ReceiptPaperWidth, number> = {
  mm58: 384,
  mm80: 512,
};

function chromeExecutablePath() {
  if (process.env.CHROME_EXECUTABLE_PATH?.trim()) {
    return process.env.CHROME_EXECUTABLE_PATH.trim();
  }
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return chromium.executablePath();
}

function chromeArgs() {
  if (process.env.CHROME_EXECUTABLE_PATH?.trim() || process.platform === "darwin") {
    return [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ];
  }
  return chromium.args;
}

export function buildPrintUrl(
  receiptUrl: string,
  orderId: string,
  businessDomain?: string,
) {
  let url: URL;
  try {
    url = new URL(receiptUrl);
  } catch {
    const normalizedDomain = businessDomain?.trim() ?? "";
    if (normalizedDomain.includes(".")) {
      url = new URL(`https://${normalizedDomain}`);
    } else {
      const baseUrl = process.env.ORDER_APP_BASE_URL?.trim();
      if (!baseUrl || !normalizedDomain) {
        throw new Error("La direccion del recibo no es valida");
      }
      url = new URL(`/s/${encodeURIComponent(normalizedDomain)}`, baseUrl);
    }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("La direccion del recibo no es valida");
  }
  const receiptMarker = "/checkout/receipt/";
  const markerIndex = url.pathname.indexOf(receiptMarker);
  const tenantPath = markerIndex >= 0
    ? url.pathname.slice(0, markerIndex)
    : url.pathname.replace(/\/$/, "");
  url.pathname = `${tenantPath}/checkout/print`;
  url.search = "";
  url.searchParams.set("order_id", orderId);
  url.searchParams.set("render", "1");
  return url.toString();
}

function escPosRaster(raw: Buffer, width: number, height: number, cutter: boolean) {
  const rowBytes = Math.ceil(width / 8);
  const output: number[] = [0x1b, 0x40];
  const chunkHeight = 256;

  for (let top = 0; top < height; top += chunkHeight) {
    const rows = Math.min(chunkHeight, height - top);
    output.push(
      0x1d,
      0x76,
      0x30,
      0x00,
      rowBytes & 0xff,
      (rowBytes >> 8) & 0xff,
      rows & 0xff,
      (rows >> 8) & 0xff,
    );
    for (let y = 0; y < rows; y += 1) {
      for (let byteIndex = 0; byteIndex < rowBytes; byteIndex += 1) {
        let packed = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = byteIndex * 8 + bit;
          if (x < width && raw[(top + y) * width + x] < 128) {
            packed |= 0x80 >> bit;
          }
        }
        output.push(packed);
      }
    }
  }

  output.push(0x0a, 0x0a, 0x0a);
  if (cutter) output.push(0x1d, 0x56, 0x00);
  return Buffer.from(output);
}

export async function renderReceiptEscPos(params: {
  receiptUrl: string;
  orderId: string;
  paperWidth: ReceiptPaperWidth;
  supportsCutter: boolean;
  businessDomain?: string;
  readinessTimeoutMs?: number;
}) {
  const dotWidth = DOT_WIDTH[params.paperWidth];
  const browser = await puppeteer.launch({
    args: chromeArgs(),
    defaultViewport: { width: dotWidth, height: 900, deviceScaleFactor: 1 },
    executablePath: await chromeExecutablePath(),
    headless: true,
    timeout: 8_000,
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    const response = await page.goto(
      buildPrintUrl(params.receiptUrl, params.orderId, params.businessDomain),
      {
        waitUntil: "domcontentloaded",
        timeout: 6_000,
      },
    );
    try {
      await page.waitForFunction(
        () =>
          document.querySelector(
            '[data-mediasis-receipt-root][data-render-ready="true"]',
          ) !== null || document.querySelector('[data-mediasis-render-error]') !== null,
        { timeout: params.readinessTimeoutMs ?? 8_000 },
      );
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        title: document.title,
        hasReceiptRoot: document.querySelector('[data-mediasis-receipt-root]') !== null,
      }));
      throw new Error(
        `La pagina del recibo no quedo lista (HTTP ${response?.status() ?? 0}, URL ${page.url()}, titulo ${diagnostics.title || "sin titulo"}, raiz ${diagnostics.hasReceiptRoot ? "presente" : "ausente"})`,
        { cause: error },
      );
    }
    const renderError = await page.$eval(
      '[data-mediasis-render-error]',
      (element) => element.getAttribute('data-mediasis-render-error'),
    ).catch(() => null);
    if (renderError) {
      throw new Error(
        `La aplicacion de pedidos no pudo cargar el recibo: ${renderError}`,
      );
    }
    await page.evaluate(async () => {
      const wait = (milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
      await Promise.race([document.fonts.ready.then(() => undefined), wait(2_000)]);
      await Promise.race([
        Promise.all(
          Array.from(document.images).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            });
          }),
        ).then(() => undefined),
        wait(2_000),
      ]);
    });
    const root = await page.$('[data-mediasis-receipt-root]');
    if (!root) throw new Error("No se encontro el contenido del recibo");
    const screenshot = await root.screenshot({ type: "png", omitBackground: false });
    const raster = await sharp(screenshot)
      .flatten({ background: "#ffffff" })
      .resize({ width: dotWidth, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .threshold(190)
      .raw()
      .toBuffer({ resolveWithObject: true });
    return escPosRaster(
      raster.data,
      raster.info.width,
      raster.info.height,
      params.supportsCutter,
    );
  } finally {
    // Chromium can occasionally stop responding during shutdown in a
    // serverless runtime. Never hold the API response open for that cleanup.
    await Promise.race([
      browser.close(),
      delay(1_000),
    ]);
  }
}
