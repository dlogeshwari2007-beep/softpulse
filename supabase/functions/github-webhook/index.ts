import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function constantTimeEqual(leftValue: string, rightValue: string) {
  const left = new TextEncoder().encode(leftValue);
  const right = new TextEncoder().encode(rightValue);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function verifyGitHubSignature(rawBody: Uint8Array, signatureHeader: string, secret: string) {
  if (!/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = "sha256=" + [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(signatureHeader.toLowerCase(), expected);
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const webhookSecret = Deno.env.get("GITHUB_WEBHOOK_SECRET") ?? "";
  const internalSecret = Deno.env.get("SOFTPULSE_INTERNAL_WEBHOOK_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!webhookSecret || !internalSecret || !supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Webhook function secrets are not configured." }, 500);
  }

  const signature = request.headers.get("X-Hub-Signature-256") ?? "";
  const deliveryId = request.headers.get("X-GitHub-Delivery") ?? "";
  const eventName = request.headers.get("X-GitHub-Event") ?? "";
  if (!deliveryId || deliveryId.length > 128) return jsonResponse({ error: "Missing GitHub delivery identifier." }, 400);

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > 5 * 1024 * 1024) return jsonResponse({ error: "Webhook payload is too large." }, 413);
  const signatureValid = await verifyGitHubSignature(rawBody, signature, webhookSecret);
  if (!signatureValid) return jsonResponse({ error: "Invalid GitHub webhook signature." }, 401);

  if (eventName !== "push") return jsonResponse({ accepted: true, ignored: "unsupported_event" }, 202);

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, 400);
  }

  if (payload.deleted === true) return jsonResponse({ accepted: true, ignored: "branch_deleted" }, 202);

  const repositoryFullName = String(payload.repository?.full_name ?? "");
  const repositoryParts = repositoryFullName.split("/");
  const owner = repositoryParts[0] ?? "";
  const repositoryName = repositoryParts[1] ?? "";
  const ref = String(payload.ref ?? "");
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
  const commitSha = String(payload.after ?? "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repositoryName) || !branch) {
    return jsonResponse({ error: "The push payload does not identify a supported GitHub repository branch." }, 400);
  }
  if (!/^[a-f0-9]{40,64}$/i.test(commitSha) || /^0+$/.test(commitSha)) {
    return jsonResponse({ accepted: true, ignored: "no_commit" }, 202);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: projects, error: projectError } = await serviceClient
    .from("projects")
    .select("id,repo_url,repo_owner,repo_name,default_branch,scan_on_push");
  if (projectError) {
    console.error("Could not resolve projects for GitHub push:", projectError.message);
    return jsonResponse({ error: "Unable to resolve the repository in SoftPulse." }, 500);
  }

  const matchingProjects = (projects ?? []).filter((project: any) =>
    String(project.repo_owner ?? "").toLowerCase() === owner.toLowerCase()
    && String(project.repo_name ?? "").toLowerCase() === repositoryName.toLowerCase()
    && project.scan_on_push !== false
    && String(project.default_branch ?? "main") === branch
  );
  if (!matchingProjects.length) {
    return jsonResponse({ accepted: true, queued: 0, ignored: "no_enabled_default_branch_project" }, 202);
  }

  const commitMessage = String(payload.head_commit?.message ?? "").split("\n")[0].slice(0, 500) || "GitHub push";
  const commitAuthor = String(payload.head_commit?.author?.name ?? payload.sender?.login ?? "GitHub").slice(0, 120);
  const queuedScanIds: string[] = [];
  const tasks: Promise<void>[] = [];

  for (const project of matchingProjects) {
    const { data: existing, error: existingError } = await serviceClient
      .from("scans")
      .select("*")
      .eq("project_id", project.id)
      .eq("webhook_delivery_id", deliveryId)
      .maybeSingle();
    if (existingError) {
      console.error("Could not check duplicate webhook delivery:", existingError.message);
      continue;
    }

    let scan: any = existing;
    if (scan && ["running", "completed", "cancelled"].includes(scan.status)) continue;
    if (scan?.status === "failed") {
      const { data: resetScan, error: resetError } = await serviceClient
        .from("scans")
        .update({
          status: "queued",
          progress: 0,
          current_stage: "Clone",
          current_file: null,
          error_message: null,
          cancelled_at: null,
          started_at: null,
          completed_at: null,
          progress_log: [{
            at: new Date().toISOString(),
            stage: "Clone",
            progress: 0,
            message: "GitHub retried this push delivery. The scan has been re-queued."
          }]
        })
        .eq("id", scan.id)
        .eq("status", "failed")
        .select("*")
        .maybeSingle();
      if (resetError || !resetScan) continue;
      scan = resetScan;
    } else if (!scan) {
      const { data: createdScan, error: insertError } = await serviceClient
        .from("scans")
        .insert({
          project_id: project.id,
          started_by: null,
          trigger_source: "push",
          webhook_delivery_id: deliveryId,
          status: "queued",
          progress: 0,
          current_stage: "Clone",
          commit_sha: commitSha,
          commit_message: commitMessage,
          commit_author: commitAuthor,
          progress_log: [{
            at: new Date().toISOString(),
            stage: "Clone",
            progress: 0,
            message: "Verified GitHub push received. Waiting for the repository analyzer."
          }]
        })
        .select("*")
        .single();
      if (insertError || !createdScan) {
        console.warn("Push scan could not be queued:", insertError?.message ?? "No scan row returned.");
        continue;
      }
      scan = createdScan;
    } else if (scan.status !== "queued") {
      continue;
    }

    queuedScanIds.push(scan.id);
    const task = (async () => {
      try {
        const response = await fetch(supabaseUrl.replace(/\/+$/, "") + "/functions/v1/run-scan", {
          method: "POST",
          headers: {
            apikey: serviceKey,
            "Content-Type": "application/json",
            "x-softpulse-internal-secret": internalSecret
          },
          body: JSON.stringify({
            repo_url: project.repo_url,
            project_id: project.id,
            scan_id: scan.id,
            commit_sha: commitSha
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.error) throw new Error(String(result?.error ?? "The scan worker returned HTTP " + response.status + "."));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unable to start the push scan.";
        console.error("Push scan dispatch failed:", message);
        await serviceClient.from("scans").update({
          status: "failed",
          error_message: message.slice(0, 1000),
          current_stage: "Report",
          completed_at: new Date().toISOString()
        }).eq("id", scan.id).eq("status", "queued");
      }
    })();
    tasks.push(task);
  }

  const backgroundTask = Promise.all(tasks);
  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
  }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(backgroundTask);
  else await backgroundTask;

  return jsonResponse({
    accepted: true,
    queued: queuedScanIds.length,
    scan_ids: queuedScanIds,
    delivery_id: deliveryId
  }, 202);
});
