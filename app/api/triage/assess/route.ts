import { assessIntake } from "@/lib/triage/runtime";

type AssessRequest = {
  history?: string[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as AssessRequest;
  const history = Array.isArray(body.history) ? body.history : [];

  if (history.length === 0) {
    return Response.json({ error: "history is required" }, { status: 400 });
  }

  try {
    return Response.json(await assessIntake(history));
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "failed to assess intake",
      },
      { status: 500 },
    );
  }
}
