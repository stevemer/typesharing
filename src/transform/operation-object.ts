import type { GlobalContext, OperationObject, ParameterObject } from "../types.js";
import { escObjKey, getEntries, getSchemaObjectComment, indent, tsOptionalProperty, tsReadonly } from "../utils.js";
import transformParameterObject from "./parameter-object.js";
import transformRequestBodyObject from "./request-body-object.js";
import transformResponseObject from "./response-object.js";
import transformSchemaObject from "./schema-object.js";

export interface TransformOperationObjectOptions {
  path: string;
  ctx: GlobalContext;
  wrapObject?: boolean;
}

export default function transformOperationObject(
  operationObject: OperationObject,
  { path, ctx, wrapObject = true }: TransformOperationObjectOptions
): string {
  let { indentLv } = ctx;
  const output: string[] = wrapObject ? ["{"] : [];
  indentLv++;

  // parameters
  {
    if (operationObject.parameters) {
      const parameterOutput: string[] = [];
      indentLv++;
      for (const paramIn of ["query", "header", "path", "cookie"] as ParameterObject["in"][]) {
        const paramInternalOutput: string[] = [];
        indentLv++;
        for (const param of operationObject.parameters ?? []) {
          const node: ParameterObject | undefined = "$ref" in param ? ctx.parameters[param.$ref] : param;
          if (node?.in !== paramIn) continue;
          let key = escObjKey(node.name);
          if (paramIn !== "path" && !node.required) key = tsOptionalProperty(key);
          const c = getSchemaObjectComment(param, indentLv);
          if (c) paramInternalOutput.push(indent(c, indentLv));
          const parameterType =
            "$ref" in param
              ? param.$ref
              : transformParameterObject(param, {
                  path: `${path}/parameters/${param.name}`,
                  ctx: { ...ctx, indentLv },
                });
          paramInternalOutput.push(indent(`${key}: ${parameterType};`, indentLv));
        }
        indentLv--;
        if (paramInternalOutput.length) {
          parameterOutput.push(indent(`${paramIn}: {`, indentLv));
          parameterOutput.push(...paramInternalOutput);
          parameterOutput.push(indent(`};`, indentLv));
        }
      }
      indentLv--;

      if (parameterOutput.length) {
        output.push(indent(`parameters: {`, indentLv));
        output.push(parameterOutput.join("\n"));
        output.push(indent("};", indentLv));
      }
    }
  }

  // requestBody
  {
    if (operationObject.requestBody) {
      const c = getSchemaObjectComment(operationObject.requestBody, indentLv);
      if (c) output.push(indent(c, indentLv));
      let key = "requestBody";
      if (ctx.immutableTypes) key = tsReadonly(key);
      if ("$ref" in operationObject.requestBody) {
        output.push(indent(`${key}: ${transformSchemaObject(operationObject.requestBody, { path, ctx })};`, indentLv));
      } else {
        if (!operationObject.requestBody.required) key = tsOptionalProperty(key);
        const requestBody = transformRequestBodyObject(operationObject.requestBody, {
          path: `${path}/requestBody`,
          ctx: { ...ctx, indentLv },
        });
        output.push(indent(`${key}: ${requestBody};`, indentLv));
      }
    }
  }

  // responses
  {
    if (operationObject.responses) {
      output.push(indent(`responses: {`, indentLv));
      indentLv++;
      for (const [responseCode, responseObject] of getEntries(operationObject.responses, ctx.alphabetize)) {
        const key = escObjKey(responseCode);
        const c = getSchemaObjectComment(responseObject, indentLv);
        if (c) output.push(indent(c, indentLv));
        if ("$ref" in responseObject) {
          output.push(
            indent(
              `${key}: ${transformSchemaObject(responseObject, {
                path: `${path}/responses/${responseCode}`,
                ctx,
              })};`,
              indentLv
            )
          );
        } else {
          const responseType = transformResponseObject(responseObject, {
            path: `${path}/responses/${responseCode}`,
            ctx: { ...ctx, indentLv },
          });
          output.push(indent(`${key}: ${responseType};`, indentLv));
        }
      }
      indentLv--;
      output.push(indent(`};`, indentLv));
    }
  }

  indentLv--;
  if (wrapObject) {
    output.push(indent("}", indentLv));
  }
  return output.join("\n");
}

export function operationRequestType(
  operationId: string,
  operation: OperationObject,
  options: TransformOperationObjectOptions
): string {
  const { path = {}, ...ctx } = options;
  const parameters = (pathItem.parameters || []).concat(operation.parameters || []);
  const types = getParameterLocations(parameters, { ...ctx, globalParameters });

  const opType = `operations["${operationId}"]`;
  const opParams = `${opType}["parameters"]`;
  const paramType = types.includes("path") ? `${opParams}["path"]` : "never";
  const bodyType = operation.requestBody ? `${opType}["requestBody"]["content"]["application/json"]` : "never";

  return `${paramType}, express<SLocals, RLocals>["${operationId}"]["responses"], ${bodyType}, never, RLocals`;
}

export function queryStringType(
  operationId: string,
  operation: OperationObject,
  options: TransformOperationObjectOptions
): string {
  const { path = {}, ...ctx } = options;
  const parameters = (path.parameters || []).concat(operation.parameters || []);
  const types = getParameterLocations(parameters, { ...ctx, globalParameters });
  const opType = `operations["${operationId}"]`;
  const opParams = `${opType}["parameters"]`;

  return types.includes("query") ? `${opParams}["query"]` : "never";
}
