import { suggestCasesFromIntake } from "@/lib/triage/runtime";

type IntakeRequest = {
  text?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as IntakeRequest;
  const text = body.text?.trim();
  if (!text) {
    return Response.json({ suggestions: [] });
  }

  return Response.json({ suggestions: suggestCasesFromIntake(text) });
}
