import { NextResponse } from "next/server";

const LLAMA_PARSE_URL =
  "https://api.cloud.llamaindex.ai/api/v1/parsing";

const POLL_INTERVAL = 5000;
const MAX_ATTEMPTS = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    const apiKey = process.env.LLAMA_CLOUD_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "LLAMA_CLOUD_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 1. Upload file to LlamaParse
    // --------------------------------------------------

    const uploadFormData = new FormData();

    uploadFormData.append("file", file);

    const uploadResponse = await fetch(
      `${LLAMA_PARSE_URL}/upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: uploadFormData,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();

      console.error("LlamaParse upload error:", errorText);

      return NextResponse.json(
        {
          error: "Failed to upload file to LlamaParse",
          details: errorText,
        },
        { status: uploadResponse.status }
      );
    }

    const uploadResult = await uploadResponse.json();

    console.log("LlamaParse upload:", uploadResult);

    const jobId = uploadResult.id;

    if (!jobId) {
      return NextResponse.json(
        {
          error: "LlamaParse did not return a job ID",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 2. Poll processing status
    // --------------------------------------------------

    let status = "PENDING";
    let jobResult: any = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL)
      );

      const statusResponse = await fetch(
        `${LLAMA_PARSE_URL}/job/${jobId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          cache: "no-store",
        }
      );

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();

        console.error(
          "LlamaParse status error:",
          errorText
        );

        return NextResponse.json(
          {
            error: "Failed to check parsing status",
            details: errorText,
          },
          { status: statusResponse.status }
        );
      }

      jobResult = await statusResponse.json();

      status = jobResult.status;

      console.log(
        `LlamaParse status: ${status}`
      );

      if (
        status === "SUCCESS" ||
        status === "PARTIAL_SUCCESS"
      ) {
        break;
      }

      if (
        status === "ERROR" ||
        status === "CANCELLED"
      ) {
        return NextResponse.json(
          {
            error: "LlamaParse processing failed",
            job: jobResult,
          },
          { status: 500 }
        );
      }
    }

    if (
      status !== "SUCCESS" &&
      status !== "PARTIAL_SUCCESS"
    ) {
      return NextResponse.json(
        {
          error: "LlamaParse processing timed out",
          jobId,
          status,
        },
        { status: 504 }
      );
    }

    // --------------------------------------------------
    // 3. Get parsed Markdown
    // --------------------------------------------------

    const resultResponse = await fetch(
      `${LLAMA_PARSE_URL}/job/${jobId}/result/markdown`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
      }
    );

    if (!resultResponse.ok) {
      const errorText = await resultResponse.text();

      console.error(
        "LlamaParse result error:",
        errorText
      );

      return NextResponse.json(
        {
          error: "Failed to get parsed document",
          details: errorText,
        },
        { status: resultResponse.status }
      );
    }

    const parsedResult = await resultResponse.json();

    // --------------------------------------------------
    // 4. Return parsed document
    // --------------------------------------------------

    return NextResponse.json({
      jobId,
      status,
      markdown: parsedResult.markdown,
      metadata: parsedResult.job_metadata,
    });
  } catch (error) {
    console.error("Parse API error:", error);

    return NextResponse.json(
      {
        error: "Something went wrong",
      },
      { status: 500 }
    );
  }
}