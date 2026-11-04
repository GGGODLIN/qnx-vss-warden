import { runVerificationPipeline } from "../../../../lib/pipeline.ts";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const result = runVerificationPipeline(rawBody);
  return Response.json(result, { status: result.statusCode });
}

