import fs from "node:fs/promises";
import { Workbook } from "@oai/artifact-tool";

const sourcePath = "/Users/liovochkin/Downloads/products_export (5).csv";
const outputPath = "/Users/liovochkin/Downloads/dev-kauffmanconcept-com-editorial/outputs/product-export-cleanup/products_export_normalized.csv";
const previewOptionsPath = "/Users/liovochkin/Downloads/dev-kauffmanconcept-com-editorial/.codex-work/product-export-cleanup/options_preview.png";
const previewMetafieldsPath = "/Users/liovochkin/Downloads/dev-kauffmanconcept-com-editorial/.codex-work/product-export-cleanup/metafields_preview.png";

const csvText = await fs.readFile(sourcePath, "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Products" });
const sheet = workbook.worksheets.getItem("Products");
const usedRange = sheet.getUsedRange(true);
const rows = usedRange.values.map((row) => [...row]);
const headers = rows[0];
const column = Object.fromEntries(headers.map((name, index) => [name, index]));

const productByHandle = new Map();
for (const row of rows.slice(1)) {
  if (row[column.Title]) {
    productByHandle.set(row[column.Handle], {
      family: row[column["Product family (product.metafields.custom.product_family)"]],
      collection: row[column["Primary Collection (product.metafields.custom.collection)"]],
      sizeOption: row[column["Option1 Name"]] === "Size" ? 1 : 2,
    });
  }
}

let currentHandle = "";
let handleRowsChanged = 0;
let hoodieVariantsNormalized = 0;
let crystalDescriptionsUpdated = 0;
let descriptionsWithOriginRemoved = 0;
let crystalSizeGuidesSet = 0;
let hoodieSizeGuidesSet = 0;

for (const row of rows.slice(1)) {
  const originalHandle = row[column.Handle];
  if (originalHandle) currentHandle = originalHandle;
  const product = productByHandle.get(currentHandle);

  const cleanedHandle = originalHandle.replaceAll("-nbsp-", "-");
  if (cleanedHandle !== originalHandle) {
    row[column.Handle] = cleanedHandle;
    handleRowsChanged += 1;
  }

  const isProductRow = Boolean(row[column.Title]);
  const isHoodie = product?.family === "Hoodie";
  const isCrystalTshirt = product?.family === "T-Shirt" && product?.collection === "Crystal";

  if (isHoodie) {
    const size = product.sizeOption === 1
      ? row[column["Option1 Value"]]
      : row[column["Option2 Value"]];
    row[column["Option1 Name"]] = isProductRow ? "Size" : "";
    row[column["Option1 Value"]] = size;
    row[column["Option1 Linked To"]] = isProductRow ? "product.metafields.shopify.size" : "";
    row[column["Option2 Name"]] = "";
    row[column["Option2 Value"]] = "";
    row[column["Option2 Linked To"]] = "";
    hoodieVariantsNormalized += 1;
  }

  if (isProductRow && isCrystalTshirt) {
    row[column["Size Guide (product.metafields.custom.size_guide)"]] = "t-shirt-cr";
    crystalSizeGuidesSet += 1;
  }

  if (isProductRow && isHoodie) {
    row[column["Size Guide (product.metafields.custom.size_guide)"]] = "hoodie";
    hoodieSizeGuidesSet += 1;
  }

  if (isProductRow && row[column["Body (HTML)"]]) {
    let body = row[column["Body (HTML)"]];
    if (isCrystalTshirt && body.includes("230 gsm")) {
      body = body.replaceAll("230 gsm", "270 gsm");
      crystalDescriptionsUpdated += 1;
    }
    const beforeOriginRemoval = body;
    body = body
      .replace(/\s*<(?:div|p)[^>]*>\s*Made in Italy\s*<\/(?:div|p)>\s*/gi, "")
      .replace(/\s*Made in Italy\s*/gi, " ")
      .trim();
    if (body !== beforeOriginRemoval) descriptionsWithOriginRemoved += 1;
    row[column["Body (HTML)"]] = body;
  }
}

usedRange.values = rows;

const csvEscape = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const outputCsv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
await fs.writeFile(outputPath, outputCsv, "utf8");

const outputWorkbook = await Workbook.fromCSV(outputCsv, { sheetName: "Products" });
const outputSheet = outputWorkbook.worksheets.getItem("Products");
const optionsPreview = await outputWorkbook.render({
  sheetName: "Products",
  range: "A1:N54",
  scale: 0.8,
  format: "png",
});
await fs.writeFile(previewOptionsPath, new Uint8Array(await optionsPreview.arrayBuffer()));
const metafieldsPreview = await outputWorkbook.render({
  sheetName: "Products",
  range: "AM1:AP54",
  scale: 1,
  format: "png",
});
await fs.writeFile(previewMetafieldsPath, new Uint8Array(await metafieldsPreview.arrayBuffer()));

const verification = outputSheet.getUsedRange(true).values;
const verificationHeaders = verification[0];
const vcol = Object.fromEntries(verificationHeaders.map((name, index) => [name, index]));
const data = verification.slice(1);
const hoodieRows = data.filter((row) => {
  const handle = row[vcol.Handle];
  return handle.startsWith("hoodie-");
});
const productRows = data.filter((row) => row[vcol.Title]);

const checks = {
  rowCount: data.length,
  columnCount: verificationHeaders.length,
  handleRowsChanged,
  hoodieVariantsNormalized,
  crystalDescriptionsUpdated,
  descriptionsWithOriginRemoved,
  crystalSizeGuidesSet,
  hoodieSizeGuidesSet,
  remainingNbspHandles: data.filter((row) => row[vcol.Handle].includes("nbsp")).length,
  remainingMadeInItaly: productRows.filter((row) => row[vcol["Body (HTML)"]].includes("Made in Italy")).length,
  remaining230Gsm: productRows.filter((row) => row[vcol["Body (HTML)"]].includes("230 gsm")).length,
  crystalTshirt270Gsm: productRows.filter((row) =>
    row[vcol["Primary Collection (product.metafields.custom.collection)"]] === "Crystal" &&
    row[vcol["Product family (product.metafields.custom.product_family)"]] === "T-Shirt" &&
    row[vcol["Body (HTML)"]].includes("270 gsm")
  ).length,
  invalidHoodieOptions: hoodieRows.filter((row) =>
    row[vcol["Option2 Name"]] || row[vcol["Option2 Value"]] ||
    !["s", "m", "l"].includes(row[vcol["Option1 Value"]])
  ).length,
  crystalTshirtGuideValues: [...new Set(productRows.filter((row) =>
    row[vcol["Primary Collection (product.metafields.custom.collection)"]] === "Crystal" &&
    row[vcol["Product family (product.metafields.custom.product_family)"]] === "T-Shirt"
  ).map((row) => row[vcol["Size Guide (product.metafields.custom.size_guide)"]]))],
  hoodieGuideValues: [...new Set(productRows.filter((row) =>
    row[vcol["Product family (product.metafields.custom.product_family)"]] === "Hoodie"
  ).map((row) => row[vcol["Size Guide (product.metafields.custom.size_guide)"]]))],
  normalizedHandles: [...new Set(hoodieRows.map((row) => row[vcol.Handle]))],
};

console.log(JSON.stringify(checks, null, 2));
console.log((await outputWorkbook.inspect({
  kind: "table",
  sheetId: "Products",
  range: "A42:AP54",
  include: "values,formulas",
  tableMaxRows: 13,
  tableMaxCols: 42,
  maxChars: 14000,
})).ndjson);
