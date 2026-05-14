// TypeScript validators for mh-creative-os workflow protocols. Mirrors
// packages/protocols/python/mh_protocols/. Schema files in
// ../../schemas/ are the source of truth — both languages load the same
// JSON Schema documents at runtime so a change to a schema reaches both
// validators atomically.

export type {
  AdRequestV1,
  EmailRequestV1,
  EmailPurpose,
  PopupRequestV1,
  PopupPurpose,
  AdAspect,
  EmailAspect,
  PopupAspect,
  Engine,
  RunResultV1Extensions,
  AdOutput,
  EmailOutput,
  PopupOutput,
} from './types.js'

export {
  ProtocolValidationError,
  validateAdRequestV1,
  validateEmailRequestV1,
  validatePopupRequestV1,
  validateRunResultV1Extensions,
  SCHEMAS_DIR,
} from './validators.js'
