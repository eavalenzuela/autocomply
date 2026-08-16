// Route schemas.
//
// The API had none. Fastify validates nothing it is not told to validate, so
// every param and body arrived unchecked and the first thing that objected was
// usually Postgres — which is why `POST /api/soa/99999999999` came back as a
// 500 carrying the failing SQL. Validating at the edge turns those into 400s
// with a useful message, and means the handler below can trust its inputs.
//
// These are deliberately narrow. A schema that accepts anything documents
// nothing and catches nothing.

/** A database id in a path segment. Bounded to int4 — the range the columns actually hold. */
export const idParam = (name: string) => ({
  type: "object" as const,
  required: [name],
  properties: { [name]: { type: "integer", minimum: 1, maximum: 2147483647 } },
});

/** A control code such as "AC-2" or "SC-28". */
export const codeParam = {
  type: "object" as const,
  required: ["code"],
  properties: { code: { type: "string", minLength: 1, maxLength: 32, pattern: "^[A-Za-z0-9._()-]+$" } },
};

export const DIMENSIONS = ["pol", "proc", "impl", "meas", "mang"] as const;
export const RATINGS = ["nc", "sc", "pc", "mc", "fc"] as const;
export const ROLES = ["admin", "compliance_manager", "control_owner", "auditor", "viewer"] as const;
export const FRAMEWORKS = ["soc2", "iso27001"] as const;

export const loginBody = {
  type: "object" as const,
  required: ["email", "password"],
  properties: {
    email: { type: "string", minLength: 3, maxLength: 254 },
    password: { type: "string", minLength: 1, maxLength: 512 },
  },
};

export const attestBody = {
  type: "object" as const,
  required: ["control", "dimension", "rating"],
  // `marker` is intentionally absent and additionalProperties is false. Note
  // what that actually does here: Fastify's ajv runs with removeAdditional, so
  // an unknown field is STRIPPED before the handler sees it, not rejected with
  // a 400. That is the outcome we want for machine provenance — the handler
  // cannot be fed a forged marker — but it is silent, so do not read this line
  // as "the caller is told no".
  additionalProperties: false,
  properties: {
    control: { type: "string", minLength: 1, maxLength: 32 },
    dimension: { type: "string", enum: [...DIMENSIONS] },
    rating: { type: "string", enum: [...RATINGS] },
    justification: { type: "string", maxLength: 4000 },
  },
};

export const exceptionBody = {
  type: "object" as const,
  required: ["control", "reason"],
  properties: {
    control: { type: "string", minLength: 1, maxLength: 32 },
    reason: { type: "string", minLength: 1, maxLength: 4000 },
    expiresAt: { type: "string", maxLength: 64 },
  },
};

export const decideBody = {
  type: "object" as const,
  required: ["decision"],
  properties: { decision: { type: "string", enum: ["approve", "reject"] } },
};

export const soaBody = {
  type: "object" as const,
  properties: {
    applicable: { type: "boolean" },
    status: { type: "string", maxLength: 32 },
    justification: { type: "string", maxLength: 4000 },
  },
};

export const roleBody = {
  type: "object" as const,
  required: ["role"],
  properties: { role: { type: "string", enum: [...ROLES] } },
};

export const tokenBody = {
  type: "object" as const,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 64 },
    role: { type: "string", enum: [...ROLES] },
    expiresAt: { type: "string", maxLength: 64 },
  },
};

export const passwordBody = {
  type: "object" as const,
  required: ["currentPassword", "newPassword"],
  properties: {
    currentPassword: { type: "string", minLength: 1, maxLength: 512 },
    newPassword: { type: "string", minLength: 8, maxLength: 512 },
  },
};

export const stepUpBody = {
  type: "object" as const,
  required: ["password"],
  properties: { password: { type: "string", minLength: 1, maxLength: 512 } },
};

export const assignBody = {
  type: "object" as const,
  required: ["control", "userId"],
  properties: {
    control: { type: "string", minLength: 1, maxLength: 32 },
    userId: { type: "integer", minimum: 1, maximum: 2147483647 },
  },
};

export const frameworkQuery = {
  type: "object" as const,
  properties: {
    framework: { type: "string", enum: [...FRAMEWORKS] },
    export: { type: "string", maxLength: 8 },
  },
};

export const periodBody = {
  type: "object" as const,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 128 },
    framework: { type: "string", enum: [...FRAMEWORKS] },
    tier: { type: "string", maxLength: 32 },
    startDate: { type: "string", maxLength: 64 },
    endDate: { type: "string", maxLength: 64 },
    tscCategories: { type: "array", items: { type: "string", maxLength: 32 } },
  },
};

export const periodStatusBody = {
  type: "object" as const,
  required: ["status"],
  properties: { status: { type: "string", enum: ["planning", "active", "closed"] } },
};
