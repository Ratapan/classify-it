import fs from "fs";
import "dotenv/config";
import OpenAI from "openai";
import { createObjectCsvWriter } from "csv-writer";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en el entorno (o en un archivo .env)");
  process.exit(1);
}

const urls = fs
  .readFileSync("urls.txt", "utf-8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean);

const csvWriter = createObjectCsvWriter({
  path: "captions.csv",
  header: [
    { id: "file", title: "file" },
    { id: "categories", title: "categories" },
    { id: "category", title: "category" },
    { id: "caption", title: "caption" },
    { id: "footer", title: "footer" },
    { id: "footer_en", title: "footer_en" }
  ]
});

const PROMPT = `
Analiza la imagen y responde SOLO en JSON con esta estructura:

{
  "categories": ["un Array de categorías (ej: ciudad, paisaje, arquitectura, personas, retrato, evento)"],
  "footer": "pie de foto breve, natural y descriptivo, en español neutro o en caso de ser necesario modismos en chileno",
  "footer_en": "footer pero en inglés",
  "caption": "descripcion detallada de la imagen en español neutro, sin juicios de valor"

}

No agregues texto fuera del JSON.
`;

function coerceToArrayOfStrings(value) {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function extractLikelyJson(text) {
  if (!text) return "";

  const trimmed = String(text).trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

async function asyncPool(concurrency, items, iteratorFn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;

      results[currentIndex] = await iteratorFn(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function analyzeImage(url) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: PROMPT },
          {
            type: "input_image",
            image_url: url
          }
        ]
      }
    ]
  });

  const text = response.output_text;
  const jsonText = extractLikelyJson(text);

  try {
    const parsed = JSON.parse(jsonText);
    const categories = coerceToArrayOfStrings(
      parsed?.categories ?? parsed?.categores ?? parsed?.category
    );

    const category =
      (typeof parsed?.category === "string" && parsed.category.trim())
        ? parsed.category.trim()
        : (categories[0] ?? "desconocido");

    return {
      categories,
      category,
      caption:
        (typeof parsed?.caption === "string" && parsed.caption.trim())
          ? parsed.caption.trim()
          : "",
      footer:
        (typeof parsed?.footer === "string" && parsed.footer.trim())
          ? parsed.footer.trim()
          : "",
      footer_en:
        (typeof parsed?.footer_en === "string" && parsed.footer_en.trim())
          ? parsed.footer_en.trim()
          : ""
    };
  } catch {
    return {
      categories: [],
      category: "desconocido",
      caption: "No se pudo generar descripción.",
      footer: "",
      footer_en: ""
    };
  }
}

async function main() {
  const concurrency =
    Number.parseInt(process.env.CONCURRENCY ?? "", 10) || 5;

  const results = await asyncPool(concurrency, urls, async (url) => {
    const file = url.split("/").pop();
    console.log(`Procesando ${file}...`);

    let analyzed;
    try {
      analyzed = await analyzeImage(url);
    } catch (err) {
      console.error(`Error procesando ${file}:`, err?.message ?? err);
      analyzed = {
        categories: [],
        category: "desconocido",
        caption: "No se pudo generar descripción.",
        footer: "",
        footer_en: ""
      };
    }

    const { categories, category, caption, footer, footer_en } = analyzed;

    return {
      file,
      categories: (categories ?? []).join("|") || "",
      category,
      caption,
      footer,
      footer_en
    };
  });

  await csvWriter.writeRecords(results);
  console.log("✔ captions.csv generado");
}

main();
