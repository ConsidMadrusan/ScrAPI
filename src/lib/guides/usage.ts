import type { GeneratedFile, GenerateSuccess, OperationSummary } from "@/lib/validation/responses";

/** A generated method for one selected operation, found in the generated code. */
export interface UsageExample {
  operation: OperationSummary;
  /** Class (TypeScript) or interface (C#) that declares the method. */
  typeName: string;
  methodName: string;
  /** The declared parameter list, exactly as generated. */
  parameters: string;
  /** False when the call needs arguments the user must fill in. */
  callableWithoutArguments: boolean;
}

interface Pattern {
  methodName: (operationId: string) => string;
  /** Matches the method declaration; group 1 is the parameter list. */
  declaration: (methodName: string) => RegExp;
  /** Matches the declaring type; group 1 is its name. */
  typeDeclaration: RegExp;
}

const PATTERNS: Record<"axios" | "fetch" | "angular" | "csharp", Pattern> = {
  axios: {
    methodName: camelCase,
    declaration: (name) => new RegExp(`\\bpublic ${name}\\(([^)]*)\\)`),
    typeDeclaration: /export class (\w+) extends BaseAPI\b/,
  },
  fetch: {
    methodName: camelCase,
    declaration: (name) => new RegExp(`\\basync ${name}\\(([^)]*)\\)`),
    typeDeclaration: /export class (\w+) extends runtime\.BaseAPI\b/,
  },
  angular: {
    methodName: camelCase,
    declaration: (name) => new RegExp(`\\bpublic ${name}\\(([^)]*)\\): Observable<`),
    typeDeclaration: /export class (\w+) extends BaseService\b/,
  },
  csharp: {
    methodName: (operationId) => `${pascalCase(operationId)}Async`,
    declaration: (name) => new RegExp(`\\bTask<[^>]+> ${name}\\(([^)]*)\\);`),
    typeDeclaration: /public interface (I\w+) : IApi\b/,
  },
};

/**
 * Picks a selected operation and finds its generated method. Operations that
 * need no arguments come first, GET before other methods. Only methods that
 * are actually declared in the generated files are returned; nothing is guessed.
 */
export function findUsageExample(result: GenerateSuccess): UsageExample | undefined {
  const pattern = PATTERNS[flavor(result)];
  const candidates = [...result.operations].sort(
    (a, b) =>
      Number(a.requiresInput) - Number(b.requiresInput) ||
      Number(a.method !== "get") - Number(b.method !== "get"),
  );

  for (const operation of candidates) {
    if (operation.operationId === undefined) continue;
    const methodName = pattern.methodName(operation.operationId);
    if (!/^[A-Za-z_]\w*$/.test(methodName)) continue;

    for (const file of result.files) {
      const found = findIn(file, pattern, methodName);
      if (found) {
        return {
          operation,
          ...found,
          methodName,
          callableWithoutArguments: !operation.requiresInput,
        };
      }
    }
  }
  return undefined;
}

function flavor(result: GenerateSuccess): keyof typeof PATTERNS {
  switch (result.options.target) {
    case "typescript-next":
    case "typescript-nuxt":
      return result.options.httpClient;
    case "typescript-angular":
      return "angular";
    case "csharp":
      return "csharp";
  }
}

function findIn(file: GeneratedFile, pattern: Pattern, methodName: string) {
  const declaration = pattern.declaration(methodName).exec(file.content);
  const typeName = pattern.typeDeclaration.exec(file.content)?.[1];
  if (!declaration || typeName === undefined) return undefined;
  return { typeName, parameters: (declaration[1] ?? "").trim() };
}

function words(text: string): string[] {
  return text.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
}

/** `list_todos`, `list-todos`, `ListTodos` → `listTodos`. */
export function camelCase(text: string): string {
  return words(text)
    .map((word, index) =>
      index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");
}

/** `listTodos`, `list_todos` → `ListTodos`. */
export function pascalCase(text: string): string {
  return words(text)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}
