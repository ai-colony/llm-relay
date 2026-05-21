import { readFileSync } from 'node:fs';

import { OpenAI } from 'openai';
import { PDFParse } from 'pdf-parse';

import type { LlamaChunk } from './types/llama.js';

const openai = new OpenAI({ baseURL: 'http://localhost:8080/v1', apiKey: 'llama', timeout: 3000 });

const chunkText = (text: string, maxChars = 6000): string[] => {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const end = text.lastIndexOf('\n\n', index + maxChars);
    const cutAt = end > index ? end : index + maxChars;
    chunks.push(text.slice(index, cutAt).trim());
    index = cutAt;
  }
  return chunks;
};

const queryLLM = async (model: string, prompt: string) => {
  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0
  });
  let queryResponse = '';
  for await (const choice of response.choices) queryResponse += choice.message?.content || '';
  return queryResponse;
};

const startPdf = async () => {
  const list = await openai.models.list();
  const model = list.data[0]?.id;
  if (!model) return console.log('No models found');
  console.log(`Using model: ${model}`);

  const fileContent = readFileSync('./4CWFVLVC92B.pdf', 'binary');
  const pdfText = (await new PDFParse({ data: fileContent }).getText()).text;

  const pdfChunks = chunkText(pdfText, 3000);
  console.log(`PDF split into ${pdfChunks.length} chunks.`);

  let fullResponse = '';
  for (const chunk of pdfChunks) {
    const prompt = `
            Extract identifiers (dates, names, locations, etc) from the following PDF chunk:

            ${chunk}
            
            Do not use formatting. Separate identifiers with new lines. Return empty string if no identifiers are found.`;
    const response = await queryLLM(model, prompt);
    fullResponse += response + '\n';
  }

  console.log(fullResponse);
};

const startAnalyze = async () => {
  const list = await openai.models.list();
  const model = list.data[0]?.id;
  if (!model) return console.log('No models found');
  console.log(`Using model: ${model}`);

  const prompt = `
Te egy belső kontrolling asszisztens vagy. Elemezd az alábbi adatokat és készíts
strukturált jelentést magyar nyelven.

---

## SZERZŐDÉS ADATOK

Vevő: Horizont Kereskedelmi Kft.
Szerződés száma: SZ-2024-0047
Érvényességi idő: 2024-01-01 – 2024-12-31

Szerződött tételek:
| Cikkszám  | Megnevezés          | Egység | Havi min. rendelt menny. | Egységár (nettó) |
|-----------|---------------------|--------|--------------------------|------------------|
| TRM-1010  | Prémium alapanyag A | kg     | 500                      | 1 240 Ft         |
| TRM-2020  | Standard alapanyag B| kg     | 300                      | 870 Ft           |
| PKG-0500  | Csomagolóegység C   | db     | 1 000                    | 185 Ft           |

Szerződéses kedvezmény: 5% visszatérítés, ha az összes havi forgalom meghaladja
a 2 000 000 Ft-ot.

---

## SZÁMLÁZOTT TÉTELEK (utolsó 6 hónap)

Január:
- TRM-1010 | 520 kg | 1 240 Ft/kg
- TRM-2020 | 310 kg | 870 Ft/kg
- PKG-0500 | 950 db | 185 Ft/db

Február:
- TRM-1010 | 480 kg | 1 240 Ft/kg
- TRM-2020 | 290 kg | 870 Ft/kg
- PKG-0500 | 870 db | 185 Ft/db
- SPC-9901 | 50 kg  | 1 100 Ft/kg 

Március:
- TRM-1010 | 610 kg | 1 265 Ft/kg 
- TRM-2020 | 305 kg | 870 Ft/kg
- PKG-0500 | 1 100 db | 185 Ft/db

Április:
- TRM-1010 | 540 kg | 1 240 Ft/kg
- TRM-2020 | 280 kg | 855 Ft/kg   
- PKG-0500 | 1 050 db | 185 Ft/db

Május:
- TRM-1010 | 570 kg | 1 240 Ft/kg
- TRM-2020 | 320 kg | 870 Ft/kg
- PKG-0500 | 1 200 db | 185 Ft/db
- PROMO-01 | 200 db | 90 Ft/db   

Június:
- TRM-1010 | 495 kg | 1 240 Ft/kg
- TRM-2020 | 275 kg | 870 Ft/kg
- PKG-0500 | 980 db | 185 Ft/db

---

## FELADATAID

### 1. Szerződésmegfelelés ellenőrzése
Hónapról hónapra ellenőrizd, hogy minden szerződött tétel (TRM-1010, TRM-2020,
PKG-0500) eléri-e a minimálisan előírt mennyiséget.
Jelöld egyértelműen: TELJESÍTETT / NEM TELJESÍTETT.

### 2. Trendelemzés
Vizsgáld meg az egyes cikkek havi mennyiségének alakulását (jan–jún).
Minősítsd: NÖVEKVŐ / CSÖKKENŐ / STABIL / INGADOZÓ.
Adj rövid narratív értékelést is (2-3 mondat).

---

## FORMÁTUM ELVÁRÁSOK

- Használj táblázatokat ahol releváns.
- Minden szakaszt (#-es fejléccel) különíts el.
- Számítások esetén mutasd a képletet is, ne csak az eredményt.
- Kerüld a felesleges körítést, légy tömör és precíz.
- Pénzösszegeket mindig Ft-ban, egész számra kerekítve adj meg.
            `;
  const response = (await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    stream: true
  })) as unknown as AsyncIterable<LlamaChunk>;
  for await (const part of response) {
    const delta = part.choices[0]?.delta;

    const content = delta?.content ?? '';
    const thinking = delta?.reasoning_content ?? '';

    if (thinking) process.stdout.write('T' + thinking);
    if (content) process.stdout.write(content);
  }
  process.stdout.write('\n');
};

const startSimple = async () => {
  const list = await openai.models.list();
  const model = list.data[0]?.id;
  if (!model) return console.log('No models found');
  console.log(`Using model: ${model}`);

  const prompt = `Does Javascript and/or Typescript have types?`;
  const response = (await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are a professional JavaScript and TypeScript developer.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    stream: true
  })) as unknown as AsyncIterable<LlamaChunk>;

  let reasoningStarted = false;
  let reasoningEnded = false;
  for await (const part of response) {
    const delta = part.choices[0]?.delta;

    const content = delta?.content ?? '';
    const reasoning = delta?.reasoning_content ?? '';

    if (reasoningStarted && !reasoning && !reasoningEnded) {
      process.stdout.write('!!!End of reasoning.\n\n\n');
      reasoningEnded = true;
    }
    if (reasoning && !reasoningStarted) {
      process.stdout.write('!!!Reasoning:\n');
      reasoningStarted = true;
    }

    if (reasoning) process.stdout.write(reasoning);
    if (content) process.stdout.write(content);
  }
  process.stdout.write('\n');
};

//startAnalyze();
startSimple();
