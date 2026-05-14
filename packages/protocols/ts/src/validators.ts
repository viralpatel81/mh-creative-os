import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import AjvImport, { type ValidateFunction, type Ajv as AjvType } from 'ajv'

// Ajv ships dual CJS/ESM exports; under NodeNext, `import Ajv from 'ajv'`
// resolves to the ESM default which is the *namespace* (not the class).
// Strip the .default off when present so both module resolutions work.
const AjvCtor: typeof AjvType =
  (AjvImport as unknown as { default?: typeof AjvType }).default ??
  (AjvImport as unknown as typeof AjvType)

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCHEMAS_DIR = join(HERE, '..', '..', 'schemas')

export class ProtocolValidationError extends Error {
  constructor(message: string, public readonly schema: string) {
    super(message)
    this.name = 'ProtocolValidationError'
  }
}

const ajv = new AjvCtor({ strict: false, allErrors: true })
const cache = new Map<string, ValidateFunction>()

function loadValidator(name: string): ValidateFunction {
  const cached = cache.get(name)
  if (cached) return cached
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8'))
  const validate = ajv.compile(schema)
  cache.set(name, validate)
  return validate
}

function validate(name: string, payload: unknown): void {
  const fn = loadValidator(name)
  const ok = fn(payload)
  if (!ok) {
    const first = fn.errors?.[0]
    const message = first
      ? `${name} validation failed: ${first.instancePath || '(root)'} ${first.message}`
      : `${name} validation failed`
    throw new ProtocolValidationError(message, name)
  }
}

export function validateAdRequestV1(payload: unknown): void {
  validate('ad_request.v1.json', payload)
}

export function validateEmailRequestV1(payload: unknown): void {
  validate('email_request.v1.json', payload)
}

export function validatePopupRequestV1(payload: unknown): void {
  validate('popup_request.v1.json', payload)
}

export function validateRunResultV1Extensions(payload: unknown): void {
  validate('run_result.v1.extensions.json', payload)
}
