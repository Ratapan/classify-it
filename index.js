import fs from "fs";
import OpenAI from "openai";
import { createObjectCsvWriter } from "csv-writer";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const urls = fs
  .readFileSync("urls.txt", "utf-8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean);

const csvWriter = createObjectCsvWriter({
  path: "captions.csv",
  header: [
    { id: "file", title: "file" },
    { id: "category", title: "category" },
    { id: "caption", title: "caption" }
  ]
});

const PROMPT = `
Analiza la imagen y responde SOLO en JSON con esta estructura:

{
  "category": "una sola categoría breve (ej: ciudad, paisaje, arquitectura, personas, evento)",
  "caption": "pie de foto breve, natural y descriptivo, en español neutro"
}

No agregues texto fuera del JSON.
`;

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

  try {
    return JSON.parse(text);
  } catch {
    return {
      category: "desconocido",
      caption: "No se pudo generar descripción."
    };
  }
}

async function main() {
  const results = [];

  for (const url of urls) {
    const file = url.split("/").pop();
    console.log(`Procesando ${file}...`);

    const { category, caption } = await analyzeImage(url);

    results.push({
      file,
      category,
      caption
    });
  }

  await csvWriter.writeRecords(results);
  console.log("✔ captions.csv generado");
}

main();
