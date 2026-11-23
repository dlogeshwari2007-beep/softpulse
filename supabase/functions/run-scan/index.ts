import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const METRIC_DEFAULTS: Record<string, number> = {
  lines_of_code: 0.04, cyclomatic_complexity: 0.12, maintainability_index: 0.14,
  duplication_pct: 0.10, code_smells: 0.10, comment_ratio: 0.04,
  function_length: 0.08, nesting_depth: 0.08, test_coverage_pct: 0.12,
  test_to_code_ratio: 0.06, outdated_dependencies: 0.06, vulnerable_dependencies: 0.06
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const lowerIsBetter = (value: number, ceiling: number) => clamp(100 - (value / ceiling) * 100);
const gradeFor = (score: number) => score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";

class ScanCancelled extends Error {
  constructor() {
    super("Scan cancelled by user.");
    this.name = "ScanCancelled";
  }
}

function sourceLines(source: string) {
  return source.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function inspectSource(path: string, source: string) {
  const lines = source.split(/\r?\n/);
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const commentLines = lines.filter((line) => /^\s*(\/\/|#|\/\*|\*|<!--)/.test(line)).length;
  const decisionCount = (source.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g) ?? []).length;
  const functionMatches = source.match(/\bfunction\b|=>|\b(def|func)\s+[A-Za-z_$]/g) ?? [];
  const averageFunctionLength = functionMatches.length ? Math.max(1, Math.round(nonEmpty.length / functionMatches.length)) : 0;
  let depth = 0;
  let maxDepth = 0;
  for (const line of lines) {
    depth += (line.match(/[\{\[]/g) ?? []).length;
    depth -= (line.match(/[\}\]]/g) ?? []).length;
    depth = Math.max(0, depth);
    maxDepth = Math.max(maxDepth, depth);
  }
  const smells = (source.match(/TODO|FIXME|HACK|console\.log\s*\(|debugger\s*;|\bvar\s+/g) ?? []).length;
  const testFile = /(^|\/)(__tests__|tests?)(\/|$)|\.(test|spec)\.[^.]+$/i.test(path);
  const complexity = 1 + decisionCount / Math.max(1, functionMatches.length || 1);
  return {
    path,
    linesOfCode: nonEmpty.length,
    commentLines,
    complexity,
    functionLength: averageFunctionLength,
    nestingDepth: maxDepth,
    smells,
    testFile,
    language: path.endsWith(".py") ? "Python" : path.endsWith(".java") ? "Java" : path.endsWith(".go") ? "Go" : path.endsWith(".cs") ? "C#" : path.endsWith(".rb") ? "Ruby" : path.endsWith(".php") ? "PHP" : path.endsWith(".rs") ? "Rust" : "JavaScript / TypeScript",
    source
  };
}

function parseDependencies(packageJson: unknown, packageLock: unknown) {
  const deps = new Map<string, string>();
  const manifest = packageJson as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;
  for (const group of [manifest?.dependencies, manifest?.devDependencies]) {
    for (const [name, version] of Object.entries(group ?? {})) deps.set(name, String(version));
  }
  const lock = packageLock as any;
  if (lock?.packages && typeof lock.packages === "object") {
    for (const [path, data] of Object.entries(lock.packages as Record<string, any>)) {
      if (path.startsWith("node_modules/") && data?.version) deps.set(path.slice("node_modules/".length), String(data.version));
    }
  } else if (lock?.dependencies && typeof lock.dependencies === "object") {
    for (const [name, data] of Object.entries(lock.dependencies as Record<string, any>)) {
      if ((data as any)?.version) deps.set(name, String((data as any).version));
    }
  }
  return [...deps.entries()].slice(0, 80).map(([name, version]) => ({ name, version }));
}

function versionTuple(value: string) {
  const cleaned = value.replace(/^[^0-9]*/, "").split(/[+-]/)[0];
  const parts = cleaned.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

async function countOutdated(dependencies: { name: string; version: string }[]) {
  let outdated = 0;
  for (const dependency of dependencies.slice(0, 30)) {
    try {
      const response = await fetch("https://registry.npmjs.org/" + encodeURIComponent(dependency.name) + "/latest");
      if (!response.ok) continue;
      const latest = (await response.json()).version as string | undefined;
      if (!latest) continue;
      const installed = versionTuple(dependency.version);
      const current = versionTuple(latest);
      if (current[0] > installed[0] || (current[0] === installed[0] && current[1] > installed[1])) outdated++;
    } catch {
      // Registry lookups are best-effort; inaccessible registries do not fail a source scan.
    }
  }
  return outdated;
}

async function countVulnerable(dependencies: { name: string; version: string }[]) {
  if (!dependencies.length) return null;
  try {
    const response = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: dependencies.map((dependency) => ({
          package: { name: dependency.name, ecosystem: "npm" },
          version: dependency.version.replace(/^[^0-9]*/, "")
        }))
      })
    });
    if (!response.ok) return null;
    const result = await response.json();
    return (result.results ?? []).filter((entry: any) => (entry.vulns ?? []).length > 0).length;
  } catch {
    return null;
  }
}

async function fetchText(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("GitHub returned " + response.status + " for " + url);
  return response.text();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ error: "Supabase function secrets are not configured." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) return new Response(JSON.stringify({ error: "Authentication required." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userResult, error: userError } = await userClient.auth.getUser();
  if (userError || !userResult.user) return new Response(JSON.stringify({ error: "Invalid or expired session." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: allowed, error: roleError } = await userClient.rpc("has_role", {
    required_roles: ["admin", "manager", "engineer"]
  });
  if (roleError || !allowed) return new Response(JSON.stringify({ error: "Your workspace role cannot start scans." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const serviceClient = createClient(supabaseUrl, serviceKey);
  let scanId: string | null = null;

  try {
    const body = await request.json();
    const repoUrl = String(body.repo_url ?? "").trim().replace(/\/$/, "");
    const repoMatch = repoUrl.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (!repoMatch) throw new Error("Enter a public GitHub repository URL.");
    const [, owner, repository] = repoMatch;
    const githubHeaders: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SoftPulse-Code-Health"
    };
    const githubToken = Deno.env.get("GITHUB_TOKEN");
    if (githubToken) githubHeaders.Authorization = "Bearer " + githubToken;

    const repositoryResponse = await fetch("https://api.github.com/repos/" + owner + "/" + repository, { headers: githubHeaders });
    if (!repositoryResponse.ok) throw new Error(repositoryResponse.status === 404 ? "Repository not found or is not public." : "GitHub repository lookup failed (" + repositoryResponse.status + ").");
    const repositoryInfo = await repositoryResponse.json();
    if (repositoryInfo.private) throw new Error("SoftPulse currently accepts public GitHub repositories only.");
    const branch = repositoryInfo.default_branch || "main";

    let projectId = typeof body.project_id === "string" ? body.project_id : null;
    if (projectId) {
      const { data: project, error } = await serviceClient.from("projects").select("id,repo_url").eq("id", projectId).maybeSingle();
      if (error || !project || project.repo_url.replace(/\/$/, "") !== repoUrl) throw new Error("Project does not match the submitted repository URL.");
    } else {
      const { data: existing } = await serviceClient.from("projects").select("id").eq("owner_id", userResult.user.id).eq("repo_url", repoUrl).maybeSingle();
      if (existing) projectId = existing.id;
      else {
        const { data: created, error } = await serviceClient.from("projects").insert({
          owner_id: userResult.user.id,
          name: repositoryInfo.name,
          repo_url: repoUrl,
          repo_owner: owner,
          repo_name: repository,
          default_branch: branch
        }).select("id").single();
        if (error) throw error;
        projectId = created.id;
      }
    }

    let scan: any;
    const requestedScanId = typeof body.scan_id === "string" ? body.scan_id : null;
    if (requestedScanId) {
      const { data: queuedScan, error: queuedScanError } = await serviceClient
        .from("scans")
        .select("*")
        .eq("id", requestedScanId)
        .maybeSingle();
      if (queuedScanError) throw queuedScanError;
      if (!queuedScan || queuedScan.project_id !== projectId || queuedScan.started_by !== userResult.user.id) {
        throw new Error("The requested scan does not belong to your account and repository.");
      }
      if (!["queued", "running"].includes(queuedScan.status)) {
        throw new Error("This scan is no longer available to run.");
      }
      scan = queuedScan;
      const { data: runningScan, error: runningError } = await serviceClient
        .from("scans")
        .update({
          status: "running",
          progress: Math.max(4, scan.progress ?? 0),
          current_stage: "Clone",
          started_at: scan.started_at ?? new Date().toISOString(),
          progress_log: Array.isArray(scan.progress_log) ? scan.progress_log : []
        })
        .eq("id", requestedScanId)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();
      if (runningError) throw runningError;
      if (runningScan) scan = runningScan;
    } else {
      const { data: createdScan, error: scanError } = await serviceClient.from("scans").insert({
        project_id: projectId,
        started_by: userResult.user.id,
        status: "running",
        progress: 4,
        current_stage: "Clone",
        progress_log: [{
          at: new Date().toISOString(),
          stage: "Clone",
          progress: 4,
          message: "Scan started. Resolving the public GitHub repository."
        }],
        started_at: new Date().toISOString()
      }).select("*").single();
      if (scanError) throw scanError;
      scan = createdScan;
    }
    scanId = scan.id;

    const ensureScanActive = async () => {
      const { data: current, error } = await serviceClient
        .from("scans")
        .select("status,progress_log")
        .eq("id", scanId)
        .maybeSingle();
      if (error) throw error;
      if (current?.status === "cancelled") throw new ScanCancelled();
      if (!current || current.status !== "running") throw new Error("Scan is no longer running.");
      return current;
    };

    const updateStage = async (
      progress: number,
      stage: string,
      currentFile: string | null = null,
      message = stage + " stage updated.",
      healthScore?: number
    ) => {
      const current = await ensureScanActive();
      const previousLog = Array.isArray(current.progress_log) ? current.progress_log : [];
      const nextLog = [...previousLog, {
        at: new Date().toISOString(),
        stage,
        progress,
        message
      }].slice(-120);
      const updates: Record<string, unknown> = {
        progress,
        current_stage: stage,
        current_file: currentFile,
        progress_log: nextLog
      };
      if (typeof healthScore === "number") updates.health_score = Number(healthScore.toFixed(2));
      const { data: updated, error } = await serviceClient
        .from("scans")
        .update(updates)
        .eq("id", scanId)
        .eq("status", "running")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updated) await ensureScanActive();
    };

    await updateStage(6, "Clone", null, "Repository metadata confirmed. Fetching the latest commit.");
    const commitResponse = await fetch("https://api.github.com/repos/" + owner + "/" + repository + "/commits/" + branch, { headers: githubHeaders });
    const commit = commitResponse.ok ? await commitResponse.json() : null;
    await ensureScanActive();
    const { error: commitUpdateError } = await serviceClient.from("scans").update({
      commit_sha: commit?.sha ?? null,
      commit_message: commit?.commit?.message?.split("\n")[0] ?? null,
      commit_author: commit?.commit?.author?.name ?? null
    }).eq("id", scanId).eq("status", "running");
    if (commitUpdateError) throw commitUpdateError;
    await ensureScanActive();

    await updateStage(14, "Parse", null, "Repository commit identified. Reading the recursive file tree.");
    const treeResponse = await fetch("https://api.github.com/repos/" + owner + "/" + repository + "/git/trees/" + branch + "?recursive=1", { headers: githubHeaders });
    if (!treeResponse.ok) throw new Error("Unable to read the repository tree from GitHub.");
    const tree = await treeResponse.json();
    const sourceExtensions = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|go|cs|rb|php|rs|c|h|cpp|cc)$/i;
    const sourceFiles = (tree.tree ?? []).filter((entry: any) => entry.type === "blob" && sourceExtensions.test(entry.path) && !/(node_modules|vendor|dist|build|\.next|coverage)\//.test(entry.path)).slice(0, 140);
    if (!sourceFiles.length) throw new Error("No supported source files were found in this repository.");

    const packageFile = (tree.tree ?? []).find((entry: any) => entry.type === "blob" && entry.path === "package.json");
    const lockFile = (tree.tree ?? []).find((entry: any) => entry.type === "blob" && entry.path === "package-lock.json");
    const coverageFile = (tree.tree ?? []).find((entry: any) => entry.type === "blob" && entry.path.toLowerCase().endsWith("lcov.info"));

    await updateStage(27, "Measure", null, "Source tree parsed. Measuring supported source files.");
    const inspected: ReturnType<typeof inspectSource>[] = [];
    for (let index = 0; index < sourceFiles.length; index += 8) {
      await ensureScanActive();
      const batch = sourceFiles.slice(index, index + 8);
      const texts = await Promise.all(batch.map(async (entry: any) => {
        try {
          const pathUrl = entry.path.split("/").map(encodeURIComponent).join("/");
          const source = await fetchText("https://raw.githubusercontent.com/" + owner + "/" + repository + "/" + encodeURIComponent(branch) + "/" + pathUrl, {});
          return inspectSource(entry.path, source.slice(0, 1_000_000));
        } catch {
          return null;
        }
      }));
      inspected.push(...texts.filter(Boolean) as ReturnType<typeof inspectSource>[]);
      await updateStage(Math.min(72, 27 + Math.round((index + batch.length) / sourceFiles.length * 45)), "Measure", batch[batch.length - 1]?.path ?? null, "Measured " + Math.min(index + batch.length, sourceFiles.length) + " of " + sourceFiles.length + " source files.");
    }
    if (!inspected.length) throw new Error("Source files were listed but their contents could not be read.");

    const codeFiles = inspected.filter((file) => !file.testFile);
    const testFiles = inspected.filter((file) => file.testFile);
    const codeLines = codeFiles.reduce((sum, file) => sum + file.linesOfCode, 0);
    const testLines = testFiles.reduce((sum, file) => sum + file.linesOfCode, 0);
    const allLines = inspected.reduce((sum, file) => sum + file.linesOfCode, 0);
    const comments = inspected.reduce((sum, file) => sum + file.commentLines, 0);
    const complexity = codeFiles.reduce((sum, file) => sum + file.complexity, 0) / Math.max(1, codeFiles.length);
    const functionLength = codeFiles.reduce((sum, file) => sum + file.functionLength, 0) / Math.max(1, codeFiles.length);
    const nesting = codeFiles.reduce((sum, file) => sum + file.nestingDepth, 0) / Math.max(1, codeFiles.length);
    const smells = inspected.reduce((sum, file) => sum + file.smells, 0);
    const nonBlankLines = inspected.flatMap((file) => sourceLines(file.source).map((line) => line.trim()).filter((line) => line.length > 28));
    const duplicateCount = nonBlankLines.length - new Set(nonBlankLines).size;
    const duplication = nonBlankLines.length ? duplicateCount / nonBlankLines.length * 100 : 0;
    const commentRatio = allLines ? comments / allLines * 100 : 0;
    const maintainability = clamp(100 - complexity * 1.7 - Math.log10(Math.max(10, codeLines)) * 7 - duplication * 0.7 - smells * 0.35);
    let coverage: number | null = null;
    if (coverageFile) {
      try {
        const coverageText = await fetchText("https://raw.githubusercontent.com/" + owner + "/" + repository + "/" + encodeURIComponent(branch) + "/" + coverageFile.path.split("/").map(encodeURIComponent).join("/"), {});
        const found = Number((coverageText.match(/^LF:(\d+)/m) ?? [])[1] ?? 0);
        const hit = Number((coverageText.match(/^LH:(\d+)/m) ?? [])[1] ?? 0);
        if (found > 0) coverage = hit / found * 100;
      } catch { coverage = null; }
    }

    let packageJson: unknown = null;
    let packageLock: unknown = null;
    if (packageFile) {
      try { packageJson = JSON.parse(await fetchText("https://raw.githubusercontent.com/" + owner + "/" + repository + "/" + encodeURIComponent(branch) + "/package.json", {})); } catch { packageJson = null; }
    }
    if (lockFile) {
      try { packageLock = JSON.parse(await fetchText("https://raw.githubusercontent.com/" + owner + "/" + repository + "/" + encodeURIComponent(branch) + "/package-lock.json", {})); } catch { packageLock = null; }
    }
    const dependencies = parseDependencies(packageJson, packageLock);
    const outdated = await countOutdated(dependencies);
    const vulnerable = await countVulnerable(dependencies);

    const metricValues: Record<string, { raw: number | null; normalized: number }> = {
      lines_of_code: { raw: codeLines, normalized: lowerIsBetter(codeLines, 30000) },
      cyclomatic_complexity: { raw: complexity, normalized: lowerIsBetter(complexity, 30) },
      maintainability_index: { raw: maintainability, normalized: maintainability },
      duplication_pct: { raw: duplication, normalized: lowerIsBetter(duplication, 35) },
      code_smells: { raw: smells, normalized: lowerIsBetter(smells, 100) },
      comment_ratio: { raw: commentRatio, normalized: clamp(commentRatio / 20 * 100) },
      function_length: { raw: functionLength, normalized: lowerIsBetter(functionLength, 100) },
      nesting_depth: { raw: nesting, normalized: lowerIsBetter(nesting, 10) },
      test_coverage_pct: { raw: coverage, normalized: coverage === null ? 50 : clamp(coverage) },
      test_to_code_ratio: { raw: codeLines ? testLines / codeLines : 0, normalized: clamp((codeLines ? testLines / codeLines : 0) / 0.5 * 100) },
      outdated_dependencies: { raw: dependencies.length ? outdated : null, normalized: dependencies.length ? lowerIsBetter(outdated, 30) : 50 },
      vulnerable_dependencies: { raw: vulnerable, normalized: vulnerable === null ? 50 : lowerIsBetter(vulnerable, 10) }
    };

    const { data: storedWeights } = await serviceClient.from("metric_weights").select("metric_key,weight");
    const weights = new Map<string, number>((storedWeights ?? []).map((item: any) => [item.metric_key, Number(item.weight)]));
    let totalWeight = 0;
    let weightedTotal = 0;
    const metricEntries = Object.entries(metricValues);
    const metricRows: Record<string, unknown>[] = [];
    for (let index = 0; index < metricEntries.length; index += 1) {
      await ensureScanActive();
      const [metricKey, value] = metricEntries[index];
      const weight = weights.get(metricKey) ?? METRIC_DEFAULTS[metricKey] ?? 0;
      totalWeight += weight;
      weightedTotal += value.normalized * weight;
      metricRows.push({
        scan_id: scanId,
        module_id: null,
        metric_key: metricKey,
        raw_value: value.raw,
        normalized_score: Number(value.normalized.toFixed(2)),
        weight,
        contribution: Number((value.normalized * weight).toFixed(4))
      });
      const partialScore = Number((weightedTotal / Math.max(totalWeight, 0.0001)).toFixed(2));
      const metricProgress = 74 + Math.round(((index + 1) / metricEntries.length) * 12);
      await updateStage(
        metricProgress,
        "Score",
        null,
        "Normalised metric " + (index + 1) + " of " + metricEntries.length + ": " + metricKey.replaceAll("_", " ") + ".",
        partialScore
      );
    }
    const healthScore = Number((weightedTotal / Math.max(totalWeight, 0.0001)).toFixed(2));
    const grade = gradeFor(healthScore);

    await updateStage(88, "Score", null, "Weighted health score finalised at " + healthScore + " / 100.", healthScore);
    const moduleRows = codeFiles.map((file) => {
      const riskProbability = clamp(Math.round(file.complexity * 2.2 + file.smells * 4 + file.linesOfCode / 65 + file.nestingDepth * 3 - 15));
      const risk = riskProbability >= 65 ? "high" : riskProbability >= 38 ? "medium" : "low";
      return {
        scan_id: scanId,
        project_id: projectId,
        path: file.path,
        language: file.language,
        lines_of_code: file.linesOfCode,
        risk,
        risk_probability: riskProbability,
        estimated_refactor_hours: Math.max(1, Math.round(file.linesOfCode / 110 + file.complexity * 0.65 + file.smells * 1.3)),
        technical_debt_ratio: Number((riskProbability / 5).toFixed(2))
      };
    });

    await updateStage(90, "Report", null, "Score calculated. Saving module risk results.");
    const { data: savedModules, error: moduleError } = await serviceClient
      .from("modules")
      .insert(moduleRows)
      .select("id,path");
    if (moduleError) throw moduleError;

    const moduleMetricRows = (savedModules ?? []).flatMap((savedModule: any) => {
      const file = codeFiles.find((candidate) => candidate.path === savedModule.path);
      if (!file) return [];
      const moduleMaintainability = clamp(100 - file.complexity * 2 - Math.log10(Math.max(10, file.linesOfCode)) * 8 - file.smells * 0.7);
      const moduleCommentRatio = file.linesOfCode ? file.commentLines / file.linesOfCode * 100 : 0;
      const measurements: Record<string, { raw: number; normalized: number }> = {
        lines_of_code: { raw: file.linesOfCode, normalized: lowerIsBetter(file.linesOfCode, 5000) },
        cyclomatic_complexity: { raw: file.complexity, normalized: lowerIsBetter(file.complexity, 20) },
        maintainability_index: { raw: moduleMaintainability, normalized: moduleMaintainability },
        code_smells: { raw: file.smells, normalized: lowerIsBetter(file.smells, 35) },
        comment_ratio: { raw: moduleCommentRatio, normalized: clamp(moduleCommentRatio / 20 * 100) },
        function_length: { raw: file.functionLength, normalized: lowerIsBetter(file.functionLength, 100) },
        nesting_depth: { raw: file.nestingDepth, normalized: lowerIsBetter(file.nestingDepth, 10) }
      };
      return Object.entries(measurements).map(([metricKey, value]) => {
        const weight = weights.get(metricKey) ?? METRIC_DEFAULTS[metricKey] ?? 0;
        return {
          scan_id: scanId,
          module_id: savedModule.id,
          metric_key: metricKey,
          raw_value: Number(value.raw.toFixed(2)),
          normalized_score: Number(value.normalized.toFixed(2)),
          weight,
          contribution: Number((value.normalized * weight).toFixed(4))
        };
      });
    });

    await ensureScanActive();
    const { error: metricError } = await serviceClient.from("metrics").insert([...metricRows, ...moduleMetricRows]);
    if (metricError) throw metricError;
    await updateStage(96, "Report", null, "Saved " + moduleRows.length + " modules and " + (metricRows.length + moduleMetricRows.length) + " metric measurements.");
    await ensureScanActive();

    const currentBeforeComplete = await ensureScanActive();
    const completedLog = [
      ...(Array.isArray(currentBeforeComplete.progress_log) ? currentBeforeComplete.progress_log : []),
      {
        at: new Date().toISOString(),
        stage: "Report",
        progress: 100,
        message: "Scan completed. Health score and module report are ready."
      }
    ].slice(-120);
    const { data: completed, error: completeError } = await serviceClient.from("scans").update({
      status: "completed",
      progress: 100,
      current_stage: "Report",
      current_file: null,
      health_score: healthScore,
      grade,
      progress_log: completedLog,
      completed_at: new Date().toISOString()
    }).eq("id", scanId).eq("status", "running").select("*").single();
    if (completeError) throw completeError;

    return new Response(JSON.stringify({
      scan: completed,
      summary: { files_analysed: inspected.length, modules_saved: moduleRows.length, metrics_saved: metricRows.length, coverage_available: coverage !== null, dependency_audit_available: vulnerable !== null }
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Scan failed.";
    if (scanId) {
      const { data: currentScan } = await serviceClient.from("scans").select("status,progress,progress_log").eq("id", scanId).maybeSingle();
      if (currentScan?.status === "cancelled" || cause instanceof ScanCancelled) {
        const previousLog = Array.isArray(currentScan?.progress_log) ? currentScan.progress_log : [];
        const nextLog = [...previousLog, {
          at: new Date().toISOString(),
          stage: "Cancelled",
          progress: currentScan?.progress ?? 0,
          message: "Scan cancelled by a workspace user."
        }].slice(-120);
        await serviceClient.from("scans").update({
          status: "cancelled",
          current_stage: "Cancelled",
          current_file: null,
          cancelled_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          progress_log: nextLog
        }).eq("id", scanId);
        return new Response(JSON.stringify({ cancelled: true, scan_id: scanId }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      await serviceClient.from("scans").update({
        status: "failed",
        error_message: message,
        current_stage: "Report",
        current_file: null,
        completed_at: new Date().toISOString()
      }).eq("id", scanId).eq("status", "running");
    }
    return new Response(JSON.stringify({ error: message, scan_id: scanId }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
