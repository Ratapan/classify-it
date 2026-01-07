# classify-it

Clasificador simple de imágenes por URL: lee `urls.txt`, pide a OpenAI analizar cada imagen y genera un `captions.csv` con categorías y textos.

## Requisitos

- Node.js 18+ (recomendado 20+)
- Una API key de OpenAI

## Instalación

```bash
npm install
```

## Configuración

Crea un archivo `.env` en la raíz del proyecto:

```env
OPENAI_API_KEY=tu_api_key_aqui
```

En `urls.txt` agrega 1 URL de imagen por línea.

## Uso

```bash
npm start
```

Por defecto procesa en paralelo con concurrencia `5`. Puedes ajustar con:

```bash
CONCURRENCY=10 npm start
```

Salida: se genera `captions.csv` con estas columnas:

- `file`: nombre de archivo deducido desde la URL
- `categories`: categorías separadas por `|`
- `category`: categoría principal (primera categoría)
- `caption`: descripción detallada en español
- `footer`: pie de foto breve en español
- `footer_en`: pie de foto breve en inglés

## Notas

- El script procesa URLs en paralelo con un límite de concurrencia para ser más rápido sin saturar la API.
- Si el modelo devuelve JSON envuelto en ```json, el script lo limpia y lo parsea igual.
