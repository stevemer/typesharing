import type { GlobalContext, ParameterObject, ReferenceObject, Subschema } from "../types.js";
import transformSchemaObject from "./schema-object.js";

export interface TransformParameterObjectOptions {
  path: string;
  ctx: GlobalContext;
}

const PARAM_END_RE = /"\]$/;

export default function transformParameterObject(
  parameterObject: ParameterObject,
  { path, ctx }: TransformParameterObjectOptions
): string {
  return parameterObject.schema ? transformSchemaObject(parameterObject.schema, { path, ctx }) : "string"; // assume a parameter is a string by default rather than "unknown"
}

export function getParameterLocations(
  parameters: (ReferenceObject | ParameterObject)[],
  options: TransformParameterObjectOptions & { allSchemas: { [id: string]: Subschema } }
): string[] {
  const { ctx } = options;
  const types: string[] = [];

  // sort into map
  const mappedParams: Record<string, Record<string, ParameterObject>> = {};
  for (const paramObj of parameters as any[]) {
    if (paramObj.$ref && ctx.parameters) {
      const paramName = paramObj.$ref.split('["').pop().replace(PARAM_END_RE, ""); // take last segment
      if (ctx.parameters[paramName]) {
        const reference = ctx.parameters[paramName] as any;
        if (!mappedParams[reference.in]) mappedParams[reference.in] = {};
        mappedParams[reference.in][reference.name || paramName] = {
          ...reference,
          schema: { $ref: paramObj.$ref },
        };
        break;
      }
      continue;
    }

    if (!paramObj.in || !paramObj.name) continue;
    if (!types.includes(paramObj.in)) {
      types.push(paramObj.in);
    }
  }

  return types;
}
