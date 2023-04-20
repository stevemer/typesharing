import type { GlobalContext, OpenAPI2, OpenAPI3, SchemaObject, SwaggerToTSOptions } from "./types.js";
import path from "path";
import fs from "fs";
import prettier from "prettier";
import parserTypescript from "prettier/parser-typescript.js";
import { Readable } from "stream";
import { URL } from "url";
import load, { resolveSchema, VIRTUAL_JSON_URL } from "./load.js";
import { swaggerVersion } from "./utils.js";
import { transformAll } from "./transform/index.js";
import { makeApiPathsEnum } from "./transform/paths.js";
export * from "./types.js"; // expose all types to consumers

export const COMMENT_HEADER = `/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */


`;

const TYPE_ARGUMENTS: Record<string, any> = {
  express: "<SLocals extends Record<string, any>, RLocals extends Record<string, any>>",
  handlers: "<SLocals extends Record<string, any>, RLocals extends Record<string, any>>",
};

/**
 * This function is the entry to the program and allows the user to pass in a remote schema and/or local schema.
 * The URL or schema and headers can be passed in either programmatically and/or via the CLI.
 * Remote schemas are fetched from a server that supplies JSON or YAML format via an HTTP GET request. File based schemas
 * are loaded in via file path, most commonly prefixed with the file:// format. Alternatively, the user can pass in
 * OpenAPI2 or OpenAPI3 schema objects that can be parsed directly by the function without reading the file system.
 *
 * Function overloading is utilized for generating stronger types for our different schema types and option types.
 *
 * @param {string} schema Root Swagger Schema HTTP URL, File URL, and/or JSON or YAML schema
 * @param {SwaggerToTSOptions<typeof schema>} [options] Options to specify to the parsing system
 * @return {Promise<string>}  {Promise<string>} Parsed file schema
 */
async function openapiTS(
  schema: string | URL | OpenAPI2 | OpenAPI3 | Record<string, SchemaObject> | Readable,
  options: SwaggerToTSOptions = {} as Partial<SwaggerToTSOptions>
): Promise<string> {
  const ctx: GlobalContext = {
    additionalProperties: options.additionalProperties || false,
    auth: options.auth,
    commentHeader: typeof options.commentHeader === "string" ? options.commentHeader : COMMENT_HEADER,
    defaultNonNullable: options.defaultNonNullable || false,
    formatter: options && typeof options.formatter === "function" ? options.formatter : undefined,
    immutableTypes: options.immutableTypes || false,
    contentNever: options.contentNever || false,
    makePathsEnum: options.makePathsEnum || false,
    pathParamsAsTypes: options.pathParamsAsTypes,
    rawSchema: options.rawSchema || false,
    supportArrayLength: options.supportArrayLength,
    version: options.version || 3,
  };

  // note: we may be loading many large schemas into memory at once; take care to reuse references without cloning

  const isInlineSchema = typeof schema != "string" && schema instanceof URL == false;

  // 1. load schema
  let rootSchema: Record<string, any> = {};
  const external: Record<string, Record<string, any>> = {};
  const allSchemas: Record<string, Record<string, any>> = {};
  const schemaURL: URL = typeof schema === "string" ? resolveSchema(schema) : (schema as URL);

  await load(schemaURL, {
    ...ctx,
    schemas: allSchemas,
    rootURL: isInlineSchema ? new URL(VIRTUAL_JSON_URL) : schemaURL, // if an inline schema is passed, use virtual URL
    httpHeaders: options.httpHeaders,
    httpMethod: options.httpMethod,
  });

  for (const k of Object.keys(allSchemas)) {
    const rootSchemaID = isInlineSchema ? VIRTUAL_JSON_URL : schemaURL.href;
    if (k === rootSchemaID) {
      rootSchema = allSchemas[k];
    } else {
      external[k] = allSchemas[k];
    }
  }

  // 2. generate raw output
  let output = ctx.commentHeader;

  // 2a-1. import express and make a helper type
  output += `import type { Application } from 'express-serve-static-core';\nimport type { Request, Response } from 'express';\n\n`;
  output += `export type expressRequest<RType extends Request, Locals extends Record<string, any>, Query> =  Omit<RType, 'app' | 'query'> & { app: Application<Locals>, query: Query };\n\n`;

  // 2a. root schema
  if (!options?.version && !ctx.rawSchema) ctx.version = swaggerVersion(rootSchema as any); // note: root version cascades down to all subschemas
  const rootTypes = transformAll(rootSchema, { ...ctx });
  const exportedKind = options.exportType === true ? "type" : "interface";
  const exportedKindOperator = options.exportType === true ? " =" : "";
  const exportedKindSemicolon = options.exportType === true ? ";" : "";
  for (const k of Object.keys(rootTypes)) {
    if (typeof rootTypes[k] === "string") {
      const typeArguments = TYPE_ARGUMENTS[k] || "";
      output += `export ${exportedKind} ${k}${typeArguments}${exportedKindOperator} {\n  ${rootTypes[k]}\n}\n\n`;
    }
  }

  // 2b. external schemas (subschemas)
  output += `export ${exportedKind} external${exportedKindOperator} {\n`;
  const externalKeys = Object.keys(external);
  externalKeys.sort((a, b) => a.localeCompare(b, "en", { numeric: true })); // sort external keys because they may have resolved in a different order each time
  for (const subschemaURL of externalKeys) {
    output += `  "${subschemaURL}": {\n`;
    const subschemaTypes = transformAll(external[subschemaURL], { ...ctx, namespace: subschemaURL });
    for (const k of Object.keys(subschemaTypes)) {
      output += `    "${k}": {\n      ${subschemaTypes[k]}\n    }\n`;
    }
    output += `  }\n`;
  }
  output += `}${exportedKindSemicolon}\n\n`;

  // 2c. add paths enum
  if (ctx.makePathsEnum && rootSchema.paths) output += makeApiPathsEnum(rootSchema.paths);

  // 3. Prettify
  let prettierOptions: prettier.Options = {
    parser: "typescript",
    plugins: [parserTypescript],
  };
  if (options && options.prettierConfig) {
    try {
      const prettierConfigFile = path.resolve(process.cwd(), options.prettierConfig);
      await fs.promises.access(prettierConfigFile, fs.constants.F_OK);
      const userOptions = await prettier.resolveConfig(prettierConfigFile);
      prettierOptions = {
        ...(userOptions || {}),
        ...prettierOptions,
        plugins: [...(prettierOptions.plugins as prettier.Plugin[]), ...((userOptions && userOptions.plugins) || [])],
      };
    } catch (err) {
      console.error(`❌ ${err}`);
      process.exit(1);
    }
  }
  return prettier.format(output, prettierOptions);
}

export default openapiTS;
