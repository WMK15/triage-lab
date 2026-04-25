import { runLiveEpisode } from "@/lib/triage/runtime";
import type { ManualPatient, RunRequest } from "@/lib/triage/types";

type LooseRunBody = {
  mode?: string;
  taskId?: string;
  batchSize?: number;
  extraPatient?: string;
  note?: string;
  patient?: ManualPatient;
  patients?: ManualPatient[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as LooseRunBody;

  // Per-mode validation. The mode field drives dispatch.
  let runRequest: RunRequest;
  if (body.mode === "manual-single") {
    if (!body.patient || typeof body.patient.chiefComplaint !== "string") {
      return Response.json(
        { error: "manual-single requires patient.chiefComplaint" },
        { status: 400 },
      );
    }
    runRequest = { mode: "manual-single", patient: body.patient };
  } else if (body.mode === "manual-multi") {
    if (!Array.isArray(body.patients) || body.patients.length === 0) {
      return Response.json(
        { error: "manual-multi requires a non-empty patients[] array" },
        { status: 400 },
      );
    }
    if (body.patients.length > 8) {
      return Response.json(
        { error: "manual-multi capped at 8 patients per run" },
        { status: 400 },
      );
    }
    runRequest = { mode: "manual-multi", patients: body.patients };
  } else if (body.mode === "test" || (!body.mode && body.taskId)) {
    // Default mode: test batch. Backwards-compat: if no mode but taskId
    // is present, treat as test mode.
    const taskId = body.taskId;
    if (!taskId) {
      return Response.json(
        { error: "test mode requires taskId" },
        { status: 400 },
      );
    }
    const batchSize = Math.max(1, Math.min(15, Number(body.batchSize) || 5));
    runRequest = {
      mode: "test",
      taskId,
      batchSize,
      extraPatient: body.extraPatient ?? body.note,
    };
  } else {
    return Response.json(
      { error: `unknown mode: ${body.mode ?? "(missing)"}` },
      { status: 400 },
    );
  }

  try {
    const result = await runLiveEpisode(runRequest);
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
