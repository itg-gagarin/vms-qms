// Reads the CAPA out of a supplier's emailed reply (PDF, photo, Word, plain text or a saved email) with Claude.
// The result is a draft for Purchasing to check: it is never treated as the supplier's confirmed answer.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import JSZip from "jszip";
import { z } from "zod";

export const EXTRACTION_MODEL = "claude-opus-5-5";

export type ReplyFile = { name: string; mime: string; data: Buffer };

const CapaSchema = z.object({
  root_cause: z.string(),
  corrective_action: z.string(),
  target_date: z.string(),
  preventive_action: z.string(),
  effective_from: z.string(),
  responder_name: z.string(),
  responder_position: z.string(),
  responder_email: z.string(),
  notes: z.string(),
});
export type CapaDraft = z.infer<typeof CapaSchema>;

export type Extraction = { model: string; fields: CapaDraft; skipped: string[] };
export type Extractor = (files: ReplyFile[], ctx: { ncfNo: string; supplier: string }) => Promise<Extraction>;

export class ExtractionError extends Error {}

/** Whether the server has an Anthropic API key. Without one, Purchasing types the CAPA in. */
export const extractionConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

const SYSTEM = `You read a supplier's reply to a Non Conformity Form (NCF) from Integra Group, a furniture manufacturer in Indonesia,
and copy out its Corrective and Preventive Action (CAPA). The reply may be in Indonesian or English, and may be a scanned form,
a photo, a letter or an email thread.

Copy what the supplier wrote; do not invent, improve or translate it. Keep the supplier's own wording, shortened only where it is
clearly boilerplate. Use an empty string for any field the reply does not state.

- root_cause: why the non-conformity happened (akar masalah).
- corrective_action: what the supplier will do about the affected goods (tindakan perbaikan).
- target_date: when the corrective action will be finished, as YYYY-MM-DD (target selesai).
- preventive_action: what changes so it does not happen again (tindakan pencegahan).
- effective_from: from when the preventive action applies, as YYYY-MM-DD (berlaku mulai).
- responder_name, responder_position, responder_email: the person at the supplier who answered.
- notes: one or two sentences for the Purchasing officer: what was unclear, missing, or guessed from context
  (for example a date written without a year). Empty if everything was stated plainly.

Dates: convert Indonesian or English dates to YYYY-MM-DD. If the year is missing, use the year of the NCF and say so in notes.`;

async function docxText(data: Buffer) {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => p.replace(/<[^>]+>/g, "") + "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .trim();
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Turns the reply files into message content. Files Claude cannot read are listed in `skipped`. */
async function toContent(files: ReplyFile[]) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (f.mime === "application/pdf") {
      content.push({
        type: "document", title: f.name,
        source: { type: "base64", media_type: "application/pdf", data: f.data.toString("base64") },
      });
    } else if (IMAGE_TYPES.has(f.mime)) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: f.mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: f.data.toString("base64") },
      });
    } else if (f.mime === DOCX) {
      const text = await docxText(f.data);
      if (text) content.push({ type: "text", text: `File ${f.name}:\n${text}` });
      else skipped.push(f.name);
    } else if (f.mime.startsWith("text/") || f.mime === "message/rfc822") {
      content.push({ type: "text", text: `File ${f.name}:\n${f.data.toString("utf8")}` });
    } else {
      skipped.push(f.name);
    }
  }
  return { content, skipped };
}

let client: Anthropic | undefined;

/** The default extractor: one structured-output request to Claude. */
export const claudeExtractor: Extractor = async (files, ctx) => {
  if (!extractionConfigured()) throw new ExtractionError("Automatic reading is not set up (no ANTHROPIC_API_KEY on the server).");
  const { content, skipped } = await toContent(files);
  if (content.length === 0) throw new ExtractionError(`None of the files can be read automatically: ${skipped.join(", ")}.`);
  client ??= new Anthropic();
  try {
    const response = await client.beta.messages.parse(
      {
        model: EXTRACTION_MODEL,
        max_tokens: 16000,
        // If the model declines, the API retries the request on a fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        output_config: { effort: "medium", format: betaZodOutputFormat(CapaSchema) },
        messages: [{
          role: "user",
          content: [...content, { type: "text", text: `This is ${ctx.supplier}'s reply to NCF ${ctx.ncfNo}. Copy out the CAPA.` }],
        }],
      },
      { timeout: 120_000 },
    );
    if (response.stop_reason === "refusal") throw new ExtractionError("The reply could not be read automatically. Type the CAPA in.");
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new ExtractionError("The reply was read only partly. Type the CAPA in or check every field.");
    }
    return { model: response.model, fields: response.parsed_output, skipped };
  } catch (e) {
    if (e instanceof ExtractionError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new ExtractionError("The Anthropic API key on the server is not valid.");
    if (e instanceof Anthropic.RateLimitError) throw new ExtractionError("Automatic reading is busy right now. Try again in a minute, or type the CAPA in.");
    if (e instanceof Anthropic.APIError) throw new ExtractionError(`Automatic reading failed (${e.status ?? "network"}). Type the CAPA in.`);
    throw e;
  }
};
