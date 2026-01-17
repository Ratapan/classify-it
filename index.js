import fs from "fs";
import "dotenv/config";
import OpenAI from "openai";
import ExifReader from "exifreader";

if (!process.env.OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en el entorno (o en un archivo .env)");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const urls = fs
  .readFileSync("urls.txt", "utf-8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean);

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

async function extractMetadata(imageUrl) {
  try {
    // Fetch the image as a blob
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // Parse EXIF data
    const tags = ExifReader.load(arrayBuffer, { expanded: true });
    
    // Extract relevant metadata
    const metadata = {};

    // Focal length
    if (tags.exif?.FocalLength) {
      const focal = tags.exif.FocalLength.description || tags.exif.FocalLength.value;
      if (typeof focal === "number") {
        metadata.focal = `${focal}mm`;
      } else if (typeof focal === "string") {
        metadata.focal = focal;
      } else if (Array.isArray(focal) && focal.length >= 1) {
        metadata.focal = `${focal[0]}mm`;
      }
    }

    // Aperture (F-number)
    if (tags.exif?.FNumber) {
      const fNumber = tags.exif.FNumber.value || tags.exif.FNumber.description;
      if (Array.isArray(fNumber) && fNumber.length >= 2) {
        // Calculate f-number from fraction [numerator, denominator]
        metadata.apertura = Math.round((fNumber[0] / fNumber[1]) * 10) / 10;
      } else if (typeof fNumber === "number") {
        metadata.apertura = fNumber;
      } else if (typeof fNumber === "string") {
        // Remove "f/" prefix if present and parse
        const cleaned = fNumber.replace(/^f\//i, "").trim();
        metadata.apertura = parseFloat(cleaned);
      }
    }

    // ISO
    if (tags.exif?.ISOSpeedRatings) {
      const iso = tags.exif.ISOSpeedRatings.description || tags.exif.ISOSpeedRatings.value;
      if (typeof iso === "number") {
        metadata.iso = iso;
      } else if (typeof iso === "string") {
        metadata.iso = parseInt(iso);
      } else if (Array.isArray(iso) && iso.length >= 1) {
        metadata.iso = iso[0];
      }
    }

    // Shutter speed
    if (tags.exif?.ExposureTime) {
      const exposure = tags.exif.ExposureTime.description || tags.exif.ExposureTime.value;
      if (typeof exposure === "string") {
        metadata.velocidad = exposure;
      } else if (typeof exposure === "number") {
        metadata.velocidad = exposure < 1 ? `1/${Math.round(1 / exposure)}s` : `${exposure}s`;
      } else if (Array.isArray(exposure) && exposure.length >= 1) {
        const expValue = exposure[0];
        metadata.velocidad = expValue < 1 ? `1/${Math.round(1 / expValue)}s` : `${expValue}s`;
      }
    }

    // Camera model (Make + Model)
    let make = "";
    let model = "";
    
    if (tags.exif?.Make) {
      const makeValue = tags.exif.Make.description || tags.exif.Make.value;
      if (typeof makeValue === "string") {
        make = makeValue;
      } else if (Array.isArray(makeValue)) {
        make = makeValue.join(" ");
      }
    }
    
    if (tags.exif?.Model) {
      const modelValue = tags.exif.Model.description || tags.exif.Model.value;
      if (typeof modelValue === "string") {
        model = modelValue;
      } else if (Array.isArray(modelValue)) {
        model = modelValue.join(" ");
      }
    }
    
    // Combine Make and Model
    if (make && model) {
      metadata.camera = `${make} ${model}`;
    } else if (model) {
      metadata.camera = model;
    }

    // Lens model
    if (tags.exif?.LensModel) {
      const lens = tags.exif.LensModel.description || tags.exif.LensModel.value;
      if (typeof lens === "string") {
        metadata.lens = lens;
      } else if (Array.isArray(lens)) {
        metadata.lens = lens.join(" ");
      }
    }

    return metadata;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to extract metadata:", errorMessage);
    return {};
  }
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

    // Extract metadata and analyze image in parallel
    const [metadata, analyzed] = await Promise.all([
      extractMetadata(url),
      analyzeImage(url).catch((err) => {
        console.error(`Error procesando ${file}:`, err?.message ?? err);
        return {
          categories: [],
          category: "desconocido",
          caption: "No se pudo generar descripción.",
          footer: "",
          footer_en: ""
        };
      })
    ]);

    const { categories, category, caption, footer, footer_en } = analyzed;

    return {
      url,
      file,
      categories: categories ?? [],
      category,
      caption,
      footer,
      footer_en,
      stars:0,
      portfolio:false,
      visible:true,
      ...metadata
    };
  });

  // Write JSON output
  fs.writeFileSync("captions.json", JSON.stringify(results, null, 2), "utf-8");
  console.log("✔ captions.json generado");
}

main();
