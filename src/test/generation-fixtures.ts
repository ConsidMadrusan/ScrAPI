import type { GenerationOptions } from "@/lib/validation/requests";
import type { GenerateSuccess, OperationSummary } from "@/lib/validation/responses";

/** Test support: generation results whose files contain declarations copied from real 7.26.0 output. */

export const TODO_OPERATIONS: OperationSummary[] = [
  { id: "GET /todos", method: "get", path: "/todos", tags: ["todos"], requiresInput: false, operationId: "listTodos", summary: "List todos" },
  { id: "GET /todos/{todoId}", method: "get", path: "/todos/{todoId}", tags: ["todos"], requiresInput: true, operationId: "getTodo", summary: "Get a todo" },
  { id: "DELETE /todos/{todoId}", method: "delete", path: "/todos/{todoId}", tags: ["todos"], requiresInput: true, operationId: "deleteTodo", summary: "Delete a todo" },
];

const AXIOS_API = `export class TodosApi extends BaseAPI {
    public getTodo(todoId: number, options?: RawAxiosRequestConfig) {
    public listTodos(status?: TodoStatus, options?: RawAxiosRequestConfig) {
    public deleteTodo(todoId: number, options?: RawAxiosRequestConfig) {
}`;

const FETCH_API = `export class TodosApi extends runtime.BaseAPI {
    async getTodo(requestParameters: GetTodoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Todo> {
    async listTodos(requestParameters: ListTodosRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Todo>> {
    async deleteTodo(requestParameters: DeleteTodoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
}`;

const ANGULAR_SERVICE = `export class TodosService extends BaseService {
    public getTodo(todoId: number, observe?: 'body', reportProgress?: boolean, options?: {httpHeaderAccept?: 'application/json', context?: HttpContext, transferCache?: boolean}): Observable<Todo>;
    public listTodos(status?: TodoStatus, observe?: 'body', reportProgress?: boolean, options?: {httpHeaderAccept?: 'application/json', context?: HttpContext, transferCache?: boolean}): Observable<Array<Todo>>;
    public deleteTodo(todoId: number, observe?: 'body', reportProgress?: boolean, options?: {httpHeaderAccept?: undefined, context?: HttpContext, transferCache?: boolean}): Observable<any>;
}`;

const CSHARP_API = `namespace ApiClient.Api
{
    public interface ITodosApi : IApi
    {
        Task<IGetTodoApiResponse> GetTodoAsync(long todoId, System.Threading.CancellationToken cancellationToken = default);
        Task<IListTodosApiResponse> ListTodosAsync(Option<TodoStatus> status = default, System.Threading.CancellationToken cancellationToken = default);
        Task<IDeleteTodoApiResponse> DeleteTodoAsync(long todoId, System.Threading.CancellationToken cancellationToken = default);
    }
}`;

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Http" Condition="'$(TargetFramework)' == 'net10.0'" Version="10.0.1" />
    <PackageReference Include="Microsoft.Extensions.Hosting" Condition="'$(TargetFramework)' == 'net10.0'" Version="10.0.1" />
  </ItemGroup>
</Project>`;

const LAYOUT = {
  "typescript-next": { archiveRoot: "api-client", destinationRoot: "src/lib/api-client" },
  "typescript-nuxt": { archiveRoot: "api-client", destinationRoot: "app/lib/api-client" },
  "typescript-angular": { archiveRoot: "api-client", destinationRoot: "src/app/api-client" },
  csharp: { archiveRoot: "ApiClient", destinationRoot: "src/ApiClient" },
} as const;

function filesFor(options: GenerationOptions): Record<string, string> {
  switch (options.target) {
    case "typescript-next":
    case "typescript-nuxt":
      return options.httpClient === "axios"
        ? { "api/todos-api.ts": AXIOS_API, "index.ts": 'export * from "./api";\n', "model/todo.ts": "export interface Todo {}\n" }
        : { "apis/TodosApi.ts": FETCH_API, "index.ts": "export * from './runtime';\n", "models/Todo.ts": "export interface Todo {}\n" };
    case "typescript-angular":
      return { "api/todos.service.ts": ANGULAR_SERVICE, "index.ts": "export * from './api/api';\n" };
    case "csharp":
      return { "Api/TodosApi.cs": CSHARP_API, "ApiClient.csproj": CSPROJ, "Model/Todo.cs": "namespace ApiClient.Model;\n" };
  }
}

export const ALL_OPTIONS: GenerationOptions[] = [
  { target: "typescript-next", httpClient: "axios" },
  { target: "typescript-next", httpClient: "fetch" },
  { target: "typescript-nuxt", httpClient: "axios" },
  { target: "typescript-nuxt", httpClient: "fetch" },
  { target: "typescript-angular" },
  { target: "csharp" },
];

export function generationResult(
  options: GenerationOptions,
  operations: OperationSummary[] = TODO_OPERATIONS,
): GenerateSuccess {
  const layout = LAYOUT[options.target];
  return {
    ok: true,
    options,
    ...layout,
    operations,
    files: Object.entries(filesFor(options)).map(([path, content]) => ({
      archivePath: `${layout.archiveRoot}/${path}`,
      destinationPath: `${layout.destinationRoot}/${path}`,
      content,
    })),
  };
}
