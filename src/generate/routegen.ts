import { OperationObject, PathsObject } from "types.js";
import * as fs from "fs";
import * as path from "path";

export type RouteNode = {
  fns: Record<string, string>;
  children?: Record<string, RouteNode>;
};

const removeInvalidCharacters = (input: string): string => input.replace(/[^a-zA-Z0-9_]/g, "");

export function convertRoutes(input: PathsObject): Record<string, RouteNode> {
  const output: Record<string, RouteNode> = {};

  for (const [path, methods] of Object.entries(input)) {
    const [parentPath, ...childPaths] = path.startsWith("/") ? path.slice(1).split("/") : path.split("/");

    let currentNode = output[parentPath] || { fns: {}, children: {} };
    output[parentPath] = currentNode;

    for (const childPath of childPaths) {
      currentNode.children = currentNode.children || {};
      currentNode.children[childPath] = currentNode.children[childPath] || { fns: {} };
      currentNode = currentNode.children[childPath];
    }
    const res: Record<string, string> = {};
    for (const [key, val] of Object.entries(methods as Record<string, OperationObject>)) {
      if (typeof val === "object" && val !== null) {
        res[key] = val.operationId! as string;
      }
    }
    currentNode.fns = res;
  }

  return output;
}

export function createFilesFromRoutes(
  routes: Record<string, RouteNode>, // The list of routes to install for this module.
  basePath: string // The base path to perform absolute imports from.
) {
  return _createFilesFromRoutes(routes, basePath, "");
}

function _createFilesFromRoutes(
  routes: Record<string, RouteNode>, // The routes (and nested routes) to install for this module.
  installPath: string, // Where in the filesystem to install this module.
  relativePath: string
) {
  ensureDirectoryExistence(installPath);
  for (const [routeKey, value] of Object.entries(routes)) {
    console.log("Processing", routeKey, value);
    const currentPath = installPath + "/" + routeKey;
    ensureDirectoryExistence(currentPath);

    const filePath = path.join(currentPath, "router.ts");
    ensureDirectoryExistence(filePath);
    const routerPaths = value.children ? Object.keys(value.children) : [];
    const handlers = Object.entries(value.fns).map(([methodKey, val]) => {
      return {
        method: methodKey,
        name: val,
        path: relativePath + "/" + routeKey,
      };
    });
    console.log("Writing router file:", filePath);
    writeRouterFile(filePath, routerPaths, handlers, relativePath + "/" + routeKey);

    if (value.children) {
      _createFilesFromRoutes(value.children, currentPath, relativePath + "/" + routeKey);
    }
  }
}

function writeRouterFile(filepath: string, routers: string[], handlers: Handler[], relpath: string) {
  const output = [];
  output.push('import promiseRouter from "express-promise-router";');
  output.push(`import { handlers } from "${makeContractImportPath(relpath)}";`);
  for (const router of routers) {
    const routername = removeInvalidCharacters(router) + "Router";
    output.push(`import ${routername} from "./${router}/router"`);
  }
  for (const handler of handlers) {
    output.push(`import ${handler.name} from "./${handler.name}";`);
  }
  output.push("");
  output.push("const router = promiseRouter();");

  output.push("");
  for (const handler of handlers) {
    output.push(
      `const ${handler.name}TypedHandler: handlers<{}, {}>["${handler.path}"]["${handler.method}"] = ${handler.name};`
    );
  }

  output.push("");
  for (const handler of handlers) {
    output.push(`router.${handler.method}("${handler.path}", ${handler.name}TypedHandler);`);
  }
  for (const router of routers) {
    const routername = removeInvalidCharacters(router) + "Router";
    output.push(`router.use("${router}", ${routername});`);
  }
  output.push("");
  output.push("export default router;");
  fs.writeFileSync(filepath, output.join("\n"));
}

function ensureDirectoryExistence(filePath: string) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

type Handler = {
  method: string;
  name: string;
  path: string;
};

const makeContractImportPath = (relpath: string) => {
  return (
    relpath
      .split("/")
      .map(() => "..")
      .join("/") + "/contract"
  );
};
