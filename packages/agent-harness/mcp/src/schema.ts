/**
 * JSON Schema normalization for MCP tool inputs.
 *
 * Servers publish schemas written for validators, not for models: `$ref` into
 * `$defs`, `anyOf` unions, `allOf` fragments and `if`/`then`/`else` conditionals.
 * Models handle those badly — they either omit required properties or invent a
 * shape that satisfies none of the branches. These helpers flatten a schema into
 * the single object shape a model can actually fill in, without changing what
 * the server will accept.
 *
 * Nothing here is MCP-specific beyond the intent, and nothing here is
 * application-specific: it is the generic "make a published schema usable by a
 * model" step every MCP client needs.
 */

export type McpJsonSchema = Record<string, unknown>;

/**
 * The fragment a `#`-local `$ref` points at, by walking the whole pointer.
 *
 * Resolving only the last path segment against `$defs` covers `#/$defs/User`
 * and nothing else — a pointer through a definition (`#/$defs/Outer/properties/
 * inner`) or into any other container resolves to the wrong node or to nothing.
 */
const resolveJsonPointer = (
  root: McpJsonSchema,
  ref: string,
): McpJsonSchema | undefined => {
  if (!ref.startsWith("#")) {
    return undefined;
  }

  let current: unknown = root;
  for (const rawSegment of ref.slice(1).split("/").filter(Boolean)) {
    const segment = decodeURIComponent(rawSegment)
      .replaceAll("~1", "/")
      .replaceAll("~0", "~");
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return isPlainObject(current) ? current : undefined;
};

export const dereferenceJsonSchema = (schema: McpJsonSchema): McpJsonSchema => {
  /*
   * A `$ref` that could not be inlined. Definitions are dropped from the output
   * because an inlined schema no longer needs them — but dropping them while a
   * pointer into them survives leaves the model a reference to nothing, which
   * it can only fill with `{}`. Whatever is still referenced is kept.
   */
  let hasUnresolvedRef = false;

  const resolveRefs = (
    value: unknown,
    visitedRefs = new Set<string>(),
  ): unknown => {
    if (typeof value !== "object" || value === null) {
      return value;
    }

    if ("$ref" in value && typeof value.$ref === "string") {
      const refPath = value.$ref;
      const definition = resolveJsonPointer(schema, refPath);
      if (!definition) {
        hasUnresolvedRef = true;
        return value;
      }

      if (visitedRefs.has(refPath)) {
        return { type: "object" };
      }

      const nextVisitedRefs = new Set(visitedRefs);
      nextVisitedRefs.add(refPath);

      const { $ref: _ref, ...rest } = value as McpJsonSchema;
      return {
        ...(resolveRefs(definition, nextVisitedRefs) as McpJsonSchema),
        ...rest,
      };
    }

    if (Array.isArray(value)) {
      return value.map((item) => resolveRefs(item, visitedRefs));
    }

    const result: McpJsonSchema = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "$defs" || key === "definitions") {
        continue;
      }
      result[key] = resolveRefs(entry, visitedRefs);
    }
    return result;
  };

  const resolved = resolveRefs(schema) as McpJsonSchema;
  if (!hasUnresolvedRef) {
    return resolved;
  }

  return {
    ...resolved,
    ...(schema.$defs === undefined ? {} : { $defs: schema.$defs }),
    ...(schema.definitions === undefined
      ? {}
      : { definitions: schema.definitions }),
  };
};

const deepMergeSchemas = (
  target: McpJsonSchema,
  source: McpJsonSchema,
): McpJsonSchema => {
  const result: McpJsonSchema = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key];

    if (key === "required" && Array.isArray(targetValue)) {
      result[key] = [
        ...new Set([...targetValue, ...(sourceValue as unknown[])]),
      ];
      continue;
    }

    if (
      key === "properties" &&
      isPlainObject(targetValue) &&
      isPlainObject(sourceValue)
    ) {
      const mergedProperties: McpJsonSchema = { ...targetValue };
      for (const [propertyKey, propertyValue] of Object.entries(sourceValue)) {
        mergedProperties[propertyKey] =
          isPlainObject(mergedProperties[propertyKey]) &&
          isPlainObject(propertyValue)
            ? deepMergeSchemas(
                mergedProperties[propertyKey] as McpJsonSchema,
                propertyValue,
              )
            : propertyValue;
      }
      result[key] = mergedProperties;
      continue;
    }

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      result[key] = [...targetValue, ...sourceValue];
      continue;
    }

    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      result[key] = deepMergeSchemas(
        targetValue as McpJsonSchema,
        sourceValue as McpJsonSchema,
      );
      continue;
    }

    result[key] = sourceValue;
  }

  return result;
};

const extractPropertiesFromConditional = (
  schema: McpJsonSchema,
): McpJsonSchema => {
  let result: McpJsonSchema = {};

  for (const branch of [schema.then, schema.else]) {
    if (!isPlainObject(branch)) {
      continue;
    }

    if (isPlainObject(branch.properties)) {
      result = deepMergeSchemas(result, { properties: branch.properties });
    }

    if (Array.isArray(branch.required)) {
      result.required = [
        ...new Set([
          ...((result.required as unknown[] | undefined) ?? []),
          ...branch.required,
        ]),
      ];
    }
  }

  return result;
};

export const simplifyJsonSchemaForLLM = (
  schema: McpJsonSchema,
): McpJsonSchema => {
  const {
    allOf,
    anyOf,
    oneOf,
    not: _not,
    if: conditionalIf,
    then: conditionalThen,
    else: conditionalElse,
    $schema: _schema,
    unevaluatedProperties: _unevaluatedProperties,
    ...baseSchema
  } = schema;

  let result: McpJsonSchema = { ...baseSchema };

  if (conditionalIf || conditionalThen || conditionalElse) {
    result = deepMergeSchemas(
      result,
      extractPropertiesFromConditional({
        if: conditionalIf,
        then: conditionalThen,
        else: conditionalElse,
      }),
    );
  }

  if (Array.isArray(allOf)) {
    for (const entry of allOf) {
      if (isPlainObject(entry)) {
        if (entry.if || entry.then || entry.else) {
          result = deepMergeSchemas(
            result,
            extractPropertiesFromConditional(entry),
          );
        }
        result = deepMergeSchemas(result, simplifyJsonSchemaForLLM(entry));
      }
    }
  }

  const unionSchemas = Array.isArray(anyOf)
    ? anyOf
    : Array.isArray(oneOf)
      ? oneOf
      : undefined;

  if (unionSchemas?.length) {
    /*
     * `Optional[str]` reaches us as `anyOf: [{type: string}, {type: null}]`,
     * which every Python MCP server emits for every optional argument. The
     * null branch says nothing a model can act on, so it is dropped and what
     * remains is folded back in — otherwise the union is destructured away and
     * the property is handed to the model with no type at all.
     */
    const branches = unionSchemas
      .filter((entry): entry is McpJsonSchema => isPlainObject(entry))
      .map((entry) => simplifyJsonSchemaForLLM(entry))
      .filter((entry) => entry.type !== "null");

    const objectSchemas = branches.filter(
      (entry) =>
        (entry.type as string | undefined) === "object" ||
        isPlainObject(entry.properties),
    );

    if (objectSchemas.length === 0) {
      if (branches.length === 1) {
        // The parent's own keywords (title, description, default) win: they
        // describe this property, the branch only describes its value.
        result = { ...branches[0], ...result };
      } else if (branches.length > 1) {
        result.anyOf = branches;
      }
    }

    if (objectSchemas.length > 0) {
      const mergedProperties: McpJsonSchema = {};
      const requiredSets: Array<Set<string>> = [];

      for (const simplified of objectSchemas) {
        if (isPlainObject(simplified.properties)) {
          Object.assign(mergedProperties, simplified.properties);
        }
        if (Array.isArray(simplified.required)) {
          requiredSets.push(new Set(simplified.required as string[]));
        }
        if (simplified.type && !result.type) {
          result.type = simplified.type;
        }
      }

      if (Object.keys(mergedProperties).length > 0) {
        result.properties = {
          ...(isPlainObject(result.properties) ? result.properties : {}),
          ...mergedProperties,
        };
      }

      if (requiredSets.length > 0) {
        const commonRequired = requiredSets.reduce((current, set) => {
          return new Set([...current].filter((key) => set.has(key)));
        });
        if (commonRequired.size > 0) {
          result.required = [
            ...new Set([
              ...((result.required as string[] | undefined) ?? []),
              ...commonRequired,
            ]),
          ];
        }
      }
    }
  }

  /*
   * Recursion into `properties` used to be gated behind "the schema declares no
   * type", which every real tool schema does declare — so the flattening above
   * only ever reached a root object and array items, and a `$ref`, `anyOf` or
   * `allOf` one level down (where servers actually put them) went to the model
   * untouched.
   */
  if (isPlainObject(result.properties)) {
    if (!result.type) {
      result.type = "object";
    }
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, value]) => [
        key,
        isPlainObject(value)
          ? simplifyJsonSchemaForLLM(value as McpJsonSchema)
          : value,
      ]),
    );
  }

  if (Array.isArray(result.items)) {
    result.items = result.items.map((item) =>
      isPlainObject(item)
        ? simplifyJsonSchemaForLLM(item as McpJsonSchema)
        : item,
    );
  } else if (isPlainObject(result.items)) {
    result.items = simplifyJsonSchemaForLLM(result.items as McpJsonSchema);
  }

  if (isPlainObject(result.additionalProperties)) {
    result.additionalProperties = simplifyJsonSchemaForLLM(
      result.additionalProperties as McpJsonSchema,
    );
  }

  return result;
};

const isPlainObject = (value: unknown): value is McpJsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The full input-schema treatment a tool descriptor should carry: references
 * resolved first (so a `$ref` inside an `anyOf` branch is visible), then
 * flattened for the model.
 */
/**
 * Names a sibling property is likely to have when it says *which* tool the
 * free-form object belongs to.
 */
const TARGET_NAMING_KEYS = [
  "tool_slug",
  "toolSlug",
  "slug",
  "tool_name",
  "toolName",
  "action",
  "tool",
];

/**
 * An object the schema describes only as "an object": no properties, and
 * anything allowed inside.
 *
 * A tool router publishes exactly this for the parameters of the tool it is
 * routing to, because it cannot know them in advance. The trouble is that `{}`
 * satisfies such a schema completely, so a model that writes nothing has, by
 * the letter of the schema, complied — and providers refuse the call for
 * missing fields the schema never mentioned.
 */
const isFreeFormObject = (node: McpJsonSchema): boolean =>
  node.type === "object" &&
  node.additionalProperties !== false &&
  (!isPlainObject(node.properties) ||
    Object.keys(node.properties as McpJsonSchema).length === 0);

const targetNameIn = (
  properties: McpJsonSchema,
  self: string,
): string | undefined =>
  TARGET_NAMING_KEYS.find((key) => key !== self && key in properties);

const withHint = (node: McpJsonSchema, hint: string): McpJsonSchema => {
  const existing =
    typeof node.description === "string" ? node.description.trim() : "";
  if (existing.includes(hint)) return node;
  return {
    ...node,
    description: existing ? `${existing}

${hint}` : hint,
  };
};

/**
 * Spell out, in the one field a model actually reads, what an opaque object is
 * for.
 *
 * The schema alone cannot say "this object must not be empty" without also
 * lying about tools that genuinely take no parameters, so the requirement is
 * stated where it belongs: in the description. It costs nothing, it cannot make
 * a valid call invalid, and it is the difference between a model reading "an
 * object" and reading "the parameters for the tool you named, which you must
 * look up if you do not know them".
 */
export const annotateFreeFormObjects = (
  schema: McpJsonSchema,
): McpJsonSchema => {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isPlainObject(node)) return node;

    const result: McpJsonSchema = { ...node };

    if (isPlainObject(result.properties)) {
      const properties = result.properties as McpJsonSchema;

      result.properties = Object.fromEntries(
        Object.entries(properties).map(([name, value]) => {
          if (!isPlainObject(value)) return [name, value];
          let property = visit(value) as McpJsonSchema;

          if (isFreeFormObject(property)) {
            const target = targetNameIn(properties, name);
            const subject = target
              ? `the tool named in \`${target}\``
              : "this call";
            property = withHint(
              property,
              [
                `Fill this with the complete input parameters for ${subject}.`,
                "An empty object is only correct when that tool takes no parameters at all;",
                "otherwise the call is rejected for the fields you left out.",
                "If you do not know its parameters, look up its schema before calling.",
              ].join(" "),
            );
          }

          return [name, property];
        }),
      );
    }

    for (const key of ["items", "additionalProperties"] as const) {
      if (isPlainObject(result[key]) || Array.isArray(result[key])) {
        result[key] = visit(result[key]);
      }
    }

    return result;
  };

  return visit(schema) as McpJsonSchema;
};

export const normalizeToolInputSchema = (
  schema: McpJsonSchema,
): McpJsonSchema =>
  annotateFreeFormObjects(simplifyJsonSchemaForLLM(dereferenceJsonSchema(schema)));
