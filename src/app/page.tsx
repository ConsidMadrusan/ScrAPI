import { Workflow } from "@/components/workflow/workflow";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">ScrAPI</h1>
        <p className="text-muted-foreground text-lg">
          Generate typed API integration code from an OpenAPI specification.
        </p>
      </header>
      <Workflow />
    </main>
  );
}
