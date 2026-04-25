import { previewBatch } from "@/lib/triage/runtime";

type PreviewRequest = {
  taskId?: string;
  batchSize?: number;
};

export async function POST(request: Request) {
  const body = (await request.json()) as PreviewRequest;
  if (!body.taskId) {
    return Response.json({ error: "taskId is required" }, { status: 400 });
  }
  const batchSize = Math.max(1, Math.min(15, Number(body.batchSize) || 5));
  try {
    const patients = previewBatch(body.taskId, batchSize);
    return Response.json({ taskId: body.taskId, batchSize, patients });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "failed to preview batch",
      },
      { status: 500 },
    );
  }
}
