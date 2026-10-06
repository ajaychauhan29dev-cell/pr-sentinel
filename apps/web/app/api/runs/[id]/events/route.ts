import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events: replays the run's events so far, then streams new ones until the run ends. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = store.runs.get(id);
  if (!run) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      for (const e of run.events) send("run-event", e);
      const close = () => {
        send("end", { status: run.status });
        cleanup();
        controller.close();
      };
      if (run.status === "completed" || run.status === "failed") return close();
      const unsubscribe = store.subscribe(id, (e) => (e.kind === "__end" ? close() : send("run-event", e)));
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15_000);
      cleanup = () => {
        unsubscribe();
        clearInterval(keepAlive);
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" }
  });
}
