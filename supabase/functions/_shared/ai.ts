// Anthropic helpers shared by the document-verifying agents (verify-spend, validate-registration):
// file loading + real-signature sniffing, document blocks, a structured-JSON model call and the fail-closed
// mapping of every model failure to an HttpError (the caller's subject then stays pending / in review).
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
import { admin, env, HttpError } from './core.ts'

export const MODEL = 'claude-opus-5-5'
export const MAX_BYTES = 10 * 1024 * 1024
// Per attempt; with maxRetries: 1 the worst case (~2 min) stays below the 150 s Edge Function limit.
export const MODEL_TIMEOUT_MS = 60_000

export type DocMime = 'application/pdf' | 'image/png' | 'image/jpeg'

export function sniffMime(bytes: Uint8Array): DocMime | null {
  const at = (s: string) => [...s].every((c, i) => bytes[i] === c.charCodeAt(0))
  if (at('%PDF')) return 'application/pdf'
  if (bytes[0] === 0x89 && at('\x89PNG')) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  return null
}

/** Downloads a private storage object (service role), enforces size and real file signature. */
export async function loadDoc(bucket: string, path: string, notFoundMessage = 'No se encontró uno de los documentos subidos') {
  const { data, error } = await admin.storage.from(bucket).download(path)
  if (error || !data) throw new HttpError(400, 'file_not_found', notFoundMessage)
  if (data.size === 0 || data.size > MAX_BYTES) throw new HttpError(400, 'invalid_file', 'Cada documento debe pesar hasta 10 MB')
  const bytes = new Uint8Array(await data.arrayBuffer())
  const mime = sniffMime(bytes)
  if (!mime) throw new HttpError(400, 'invalid_file', 'Usa PDF, JPG o PNG')
  return { mime, base64: encodeBase64(bytes) }
}

export type Doc = Awaited<ReturnType<typeof loadDoc>>

export const docBlock = (d: Doc) =>
  d.mime === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: d.base64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: d.mime, data: d.base64 } }

/**
 * Asks Claude for a JSON object that follows `schema`, then runs `parse` (defensive shape validation: never trust
 * the schema alone for an approval). Every failure throws an HttpError; `pendingNote` closes each message
 * (e.g. "La factura sigue en revisión.").
 */
export async function askJson<T>(opts: {
  label: string
  system: string
  schema: Record<string, unknown>
  content: Anthropic.MessageParam['content']
  pendingNote: string
  parse: (raw: unknown) => T
  maxTokens?: number
}): Promise<T> {
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: MODEL_TIMEOUT_MS, maxRetries: 1 })
  const { label, pendingNote } = opts
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: opts.schema } },
      messages: [{ role: 'user', content: opts.content }],
    } as Anthropic.MessageCreateParamsNonStreaming)

    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') {
      console.error(`${label}: unusable stop_reason`, msg.stop_reason)
      throw new HttpError(502, 'ai_unavailable', `El agente no pudo emitir un veredicto. ${pendingNote}`)
    }
    const block = msg.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block')
    return opts.parse(JSON.parse(block.text))
  } catch (e) {
    if (e instanceof HttpError) throw e
    // Most specific first.
    if (e instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, 'ai_rate_limited', `El agente está saturado. Intenta de nuevo en un minuto; ${pendingNote[0].toLowerCase()}${pendingNote.slice(1)}`)
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error(`${label}: Anthropic credentials rejected`)
      throw new HttpError(500, 'ai_misconfigured', 'El agente no está configurado correctamente')
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      throw new HttpError(504, 'ai_timeout', `El agente tardó demasiado en responder. ${pendingNote}`)
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new HttpError(502, 'ai_unavailable', `No se pudo contactar al agente. ${pendingNote}`)
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`${label}: Anthropic API error`, e.status)
      throw new HttpError(502, 'ai_unavailable', `El agente no pudo emitir un veredicto. ${pendingNote}`)
    }
    console.error(`${label}: malformed model output`, e instanceof Error ? e.message : e)
    throw new HttpError(502, 'ai_malformed', `El agente devolvió una respuesta inválida. ${pendingNote}`)
  }
}
