import { runLiveEpisode } from "@/lib/triage/runtime";

type RunRequest = {
  taskId?: string;
  note?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as RunRequest;
  if (!body.taskId) {
    return Response.json({ error: "taskId is required" }, { status: 400 });
  }

  try {
    const result = await runLiveEpisode(body.taskId, body.note);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "failed to run triage episode",
      },
      { status: 500 },
    );
  }
}
