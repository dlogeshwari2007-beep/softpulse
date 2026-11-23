import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight,
  Bell, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Code2, Eye, EyeOff,
  ExternalLink, FileCode2, Flame, FolderGit2, Github, GitBranch, History,
  LayoutDashboard, LockKeyhole, LogOut, Mail, Menu, Moon, MoreHorizontal, Plus,
  RefreshCw, Search, Settings, ShieldCheck, SlidersHorizontal, Sun, Users,
  X, Download, Sparkles
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Page = "dashboard" | "projects" | "scans" | "modules" | "risks" | "history" | "users" | "settings";
type Role = "admin" | "manager" | "engineer" | "viewer";
type Risk = "low" | "medium" | "high";
type Mode = "signin" | "signup" | "reset";
type Project = { id: string; name: string; repo_url: string; repo_owner?: string; repo_name?: string; default_branch?: string; created_at?: string; grade?: string; health_score?: number; last_scan?: string; trend?: number };
type ScanLogEntry = { at?: string; stage?: string; progress?: number; message: string };
type Scan = { id: string; project_id: string; status: string; progress?: number; current_stage?: string; current_file?: string | null; progress_log?: ScanLogEntry[]; health_score?: number; grade?: string; commit_sha?: string; commit_message?: string; commit_author?: string; error_message?: string | null; cancelled_at?: string | null; created_at?: string; started_at?: string; completed_at?: string };
type Module = { id: string; scan_id?: string; project_id?: string; path: string; language?: string; lines_of_code: number; risk: Risk; risk_probability: number; estimated_refactor_hours: number; technical_debt_ratio: number; complexity?: number; coverage?: number; smells?: number };
type MetricRecord = { scan_id: string; module_id?: string | null; metric_key: string; raw_value: number | null; normalized_score: number; weight: number };

const metricWeights = [
  { key: "lines_of_code", label: "Lines of code", weight: 4, direction: "Lower is better", note: "Large modules are harder to understand and change." },
  { key: "cyclomatic_complexity", label: "Cyclomatic complexity", weight: 12, direction: "Lower is better", note: "Fewer decision paths make code easier to test." },
  { key: "maintainability_index", label: "Maintainability index", weight: 14, direction: "Higher is better", note: "A composite indicator of how easy code is to maintain." },
  { key: "duplication_pct", label: "Duplication", weight: 10, direction: "Lower is better", note: "Repeated code increases the cost of every change." },
  { key: "code_smells", label: "Code smells", weight: 10, direction: "Lower is better", note: "Potential design and implementation problems." },
  { key: "comment_ratio", label: "Comment ratio", weight: 4, direction: "Higher is better", note: "Useful comments add context where code is not self-explanatory." },
  { key: "function_length", label: "Function length", weight: 8, direction: "Lower is better", note: "Short, focused functions are easier to reason about." },
  { key: "nesting_depth", label: "Nesting depth", weight: 8, direction: "Lower is better", note: "Shallow control flow is easier to follow." },
  { key: "test_coverage_pct", label: "Test coverage", weight: 12, direction: "Higher is better", note: "Coverage indicates how much code is exercised by tests." },
  { key: "test_to_code_ratio", label: "Test-to-code ratio", weight: 6, direction: "Higher is better", note: "A healthy test suite provides a safety net for change." },
  { key: "outdated_dependencies", label: "Outdated dependencies", weight: 6, direction: "Lower is better", note: "Old dependencies can increase maintenance effort." },
  { key: "vulnerable_dependencies", label: "Vulnerable dependencies", weight: 6, direction: "Lower is better", note: "Known vulnerabilities increase security exposure." }
];

const demoProjects: Project[] = [
  { id: "p1", name: "commons-utils", repo_url: "https://github.com/acme/commons-utils", repo_owner: "acme", repo_name: "commons-utils", default_branch: "main", grade: "A", health_score: 91, last_scan: "8 min ago", trend: 4 },
  { id: "p2", name: "payments-api", repo_url: "https://github.com/acme/payments-api", repo_owner: "acme", repo_name: "payments-api", default_branch: "main", grade: "B", health_score: 78, last_scan: "2 hours ago", trend: 2 },
  { id: "p3", name: "customer-portal", repo_url: "https://github.com/acme/customer-portal", repo_owner: "acme", repo_name: "customer-portal", default_branch: "develop", grade: "C", health_score: 64, last_scan: "Yesterday", trend: -3 }
];

const demoScans: Scan[] = [
  { id: "s1", project_id: "p1", status: "completed", health_score: 91, grade: "A", commit_sha: "a81c29d", commit_message: "Refactor shared validation utilities", commit_author: "Maya Chen", created_at: "2026-11-23T08:10:00Z" },
  { id: "s2", project_id: "p2", status: "completed", health_score: 78, grade: "B", commit_sha: "f2b711a", commit_message: "Add payment retry handling", commit_author: "Arjun Rao", created_at: "2026-11-23T06:00:00Z" },
  { id: "s3", project_id: "p1", status: "completed", health_score: 87, grade: "B", commit_sha: "c87d142", commit_message: "Improve error boundaries", commit_author: "Maya Chen", created_at: "2026-11-22T10:00:00Z" },
  { id: "s4", project_id: "p3", status: "completed", health_score: 64, grade: "C", commit_sha: "9a71e52", commit_message: "Update account settings flow", commit_author: "Nina Patel", created_at: "2026-11-22T08:00:00Z" },
  { id: "s5", project_id: "p2", status: "completed", health_score: 76, grade: "B", commit_sha: "bd82f61", commit_message: "Add transaction audit events", commit_author: "Arjun Rao", created_at: "2026-11-21T11:00:00Z" },
  { id: "s6", project_id: "p1", status: "completed", health_score: 84, grade: "B", commit_sha: "1dc803e", commit_message: "Reduce duplicate formatting logic", commit_author: "Maya Chen", created_at: "2026-11-20T09:00:00Z" },
  { id: "s7", project_id: "p3", status: "completed", health_score: 67, grade: "C", commit_sha: "2c04a6e", commit_message: "Resolve navigation regression", commit_author: "Nina Patel", created_at: "2026-11-19T14:00:00Z" },
  { id: "s8", project_id: "p2", status: "completed", health_score: 72, grade: "B", commit_sha: "e45d01b", commit_message: "Introduce service layer", commit_author: "Arjun Rao", created_at: "2026-11-18T13:00:00Z" }
];

const moduleNames = [
  ["src/validation/schema.ts", "TypeScript", 1240, "low", 18, 3, 8],
  ["src/formatters/date.ts", "TypeScript", 860, "low", 22, 2, 4],
  ["src/transform/mapper.ts", "TypeScript", 1890, "medium", 47, 8, 14],
  ["src/services/payment.ts", "TypeScript", 2420, "high", 82, 18, 26],
  ["src/controllers/checkout.ts", "TypeScript", 1680, "medium", 56, 10, 18],
  ["src/auth/session.ts", "TypeScript", 920, "low", 25, 3, 6],
  ["src/components/LegacyTable.tsx", "TypeScript", 2110, "high", 88, 16, 30],
  ["src/hooks/useFilters.ts", "TypeScript", 730, "medium", 52, 7, 12],
  ["src/api/client.ts", "TypeScript", 1120, "low", 24, 4, 5],
  ["src/reports/exporter.ts", "TypeScript", 1980, "high", 76, 14, 24],
  ["src/utils/strings.ts", "TypeScript", 410, "low", 12, 1, 2],
  ["src/state/store.ts", "TypeScript", 1450, "medium", 51, 9, 16]
] as const;

const demoMetrics: MetricRecord[] = [
  ["maintainability_index",86,86,0.14],["cyclomatic_complexity",7.4,81,0.12],
  ["duplication_pct",3.8,88,0.10],["test_coverage_pct",78,78,0.12],
  ["code_smells",24,78,0.10],["vulnerable_dependencies",2,55,0.06],
  ["lines_of_code",12400,74,0.04],["comment_ratio",8.2,72,0.04],
  ["function_length",32,80,0.08],["nesting_depth",3,75,0.08],
  ["test_to_code_ratio",0.22,69,0.06],["outdated_dependencies",5,65,0.06]
].map(([metric_key, raw_value, normalized_score, weight]) => ({
  scan_id: "s1", metric_key: String(metric_key), raw_value: Number(raw_value),
  normalized_score: Number(normalized_score), weight: Number(weight)
})));

const demoModules: Module[] = moduleNames.map((m, i) => ({
  id: "m" + (i + 1), scan_id: i < 6 ? "s1" : i < 10 ? "s2" : "s4", project_id: i < 6 ? "p1" : i < 10 ? "p2" : "p3",
  path: m[0], language: m[1], lines_of_code: m[2], risk: m[3] as Risk, risk_probability: m[4],
  estimated_refactor_hours: m[5], technical_debt_ratio: m[6], complexity: 6 + i * 2, coverage: Math.max(42, 94 - i * 4), smells: i + 1
}));

const sparkData = [
  [72, 74, 73, 79, 82, 87, 91], [68, 70, 72, 73, 74, 76, 78], [74, 72, 68, 70, 66, 65, 64],
  [54, 58, 57, 62, 65, 68, 72], [82, 80, 83, 85, 86, 88, 91], [43, 45, 46, 51, 54, 57, 61]
].map((vals) => vals.map((value, i) => ({ i, value })));

const gradeFrom = (score?: number) => !Number.isFinite(score) ? "—" : (score! >= 85 ? "A" : score! >= 70 ? "B" : score! >= 55 ? "C" : score! >= 40 ? "D" : "E");
const gradeClass = (grade?: string) => "grade-" + (grade || "C").toLowerCase();
const riskClass = (risk: Risk) => "risk-" + risk;
const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const getProject = (projects: Project[], id?: string) => projects.find((p) => p.id === id);

function GradeBadge({ grade }: { grade?: string }) {
  return <span className={"grade-badge " + gradeClass(grade)}><span>{grade || "—"}</span><small>GRADE</small></span>;
}
function RiskPill({ risk }: { risk: Risk }) {
  return <span className={"risk-pill " + riskClass(risk)}><i />{risk[0].toUpperCase() + risk.slice(1)}</span>;
}
function ScoreGauge({ score, size = "large" }: { score: number; size?: "large" | "small" }) {
  const grade = gradeFrom(score);
  return <div className={"score-gauge " + size}>
    <div className="gauge-track" style={{ background: "conic-gradient(rgb(var(--accent)) " + Math.max(0, Math.min(100, score)) * 3.6 + "deg, rgb(var(--border)) 0deg)" }}>
      <div className="gauge-inner"><strong>{Math.round(score)}</strong><span>/ 100</span></div>
    </div>
    <div className="gauge-grade"><GradeBadge grade={grade} /><span>Overall health score</span></div>
  </div>;
}
function Sparkline({ values }: { values: { i: number; value: number }[] }) {
  return <div className="sparkline"><ResponsiveContainer width="100%" height="100%"><AreaChart data={values}><Area type="monotone" dataKey="value" stroke="rgb(var(--accent))" fill="rgb(var(--accent) / .13)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div>;
}
function EmptyState({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{copy}</p></div>;
}
function Skeleton({ count = 3 }: { count?: number }) {
  return <div className="skeleton-grid">{Array.from({ length: count }, (_, i) => <div className="skeleton-card" key={i}><i /><b /><span /></div>)}</div>;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [dark, setDark] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [demoMode, setDemoMode] = useState(!isSupabaseConfigured);
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>(demoProjects);
  const [scans, setScans] = useState<Scan[]>(demoScans);
  const [modules, setModules] = useState<Module[]>(demoModules);
  const [metricRows, setMetricRows] = useState<MetricRecord[]>(demoMetrics);
  const [weightRows, setWeightRows] = useState(metricWeights);
  const [users, setUsers] = useState<{ id: string; email: string; role: Role; display_name?: string }[]>([
    { id: "u1", email: "maya.chen@softpulse.dev", role: "admin", display_name: "Maya Chen" },
    { id: "u2", email: "arjun.rao@softpulse.dev", role: "engineer", display_name: "Arjun Rao" },
    { id: "u3", email: "nina.patel@softpulse.dev", role: "manager", display_name: "Nina Patel" },
    { id: "u4", email: "sam.lee@softpulse.dev", role: "viewer", display_name: "Sam Lee" }
  ]);
  const [loading, setLoading] = useState(false);
  const [scanningProjectId, setScanningProjectId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "error" | "offline">("offline");
  const cancelledDemoScanIds = useRef<Set<string>>(new Set());
  const scanLogRef = useRef<HTMLDivElement | null>(null);
  const [dataError, setDataError] = useState("");
  const [toast, setToast] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [repoNameInput, setRepoNameInput] = useState("");
  const [repoTouched, setRepoTouched] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [moduleQuery, setModuleQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [moduleSort, setModuleSort] = useState<"risk" | "lines" | "path">("risk");
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [selectedScanId, setSelectedScanId] = useState("s1");
  const [compareA, setCompareA] = useState("s1");
  const [compareB, setCompareB] = useState("s3");

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => {
    scanLogRef.current?.scrollTo({ top: scanLogRef.current.scrollHeight, behavior: "smooth" });
  }, [selectedScanId, scans.find((scan) => scan.id === selectedScanId)?.progress_log]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadWorkspace = useCallback(async (id?: string) => {
    if (!supabase || !id) return;
    setLoading(true);
    setDataError("");
    try {
      const [projectResult, scanResult, moduleResult, roleResult, metricResult, weightResult] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("scans").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("modules").select("*").order("risk_probability", { ascending: false }).limit(200),
        supabase.from("user_roles").select("role").eq("user_id", id).maybeSingle(),
        supabase.from("metrics").select("scan_id,module_id,metric_key,raw_value,normalized_score,weight").order("measured_at", { ascending: false }).limit(5000),
        supabase.from("metric_weights").select("metric_key,label,weight,direction,explanation").order("metric_key")
      ]);
      if (projectResult.error) throw projectResult.error;
      if (scanResult.error) throw scanResult.error;
      if (moduleResult.error) throw moduleResult.error;
      if (roleResult.error) throw roleResult.error;
      if (metricResult.error) throw metricResult.error;
      if (weightResult.error) throw weightResult.error;
      setProjects((projectResult.data ?? []) as Project[]);
      setScans((scanResult.data ?? []) as Scan[]);
      setModules((moduleResult.data ?? []) as Module[]);
      setMetricRows((metricResult.data ?? []) as MetricRecord[]);
      if (weightResult.data?.length) setWeightRows(weightResult.data.map((weight: any) => ({ key: weight.metric_key, label: weight.label, weight: Math.round(Number(weight.weight) * 100), direction: weight.direction === "higher_better" ? "Higher is better" : weight.direction === "lower_better" ? "Lower is better" : "Informational", note: weight.explanation })));
      if (roleResult.data?.role) setRole(roleResult.data.role as Role);

      if (roleResult.data?.role === "admin") {
        const [profileResult, rolesResult] = await Promise.all([
          supabase.from("profiles").select("id,email,display_name").order("created_at", { ascending: false }),
          supabase.from("user_roles").select("user_id,role")
        ]);
        if (!profileResult.error && !rolesResult.error && profileResult.data) {
          setUsers(profileResult.data.map((profile: any) => ({
            id: profile.id,
            email: profile.email,
            display_name: profile.display_name,
            role: (rolesResult.data?.find((r: any) => r.user_id === profile.id)?.role || "viewer") as Role
          })));
        }
      }
    } catch (cause) {
      setDataError(cause instanceof Error ? cause.message : "Unable to load workspace data.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      setSessionEmail(user?.email ?? null);
      setUserId(user?.id ?? null);
      if (user) void loadWorkspace(user.id);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setSessionEmail(user?.email ?? null);
      setUserId(user?.id ?? null);
      if (user) void loadWorkspace(user.id);
    });
    return () => data.subscription.unsubscribe();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!supabase || !userId || demoMode) {
      setRealtimeStatus("offline");
      return;
    }

    setRealtimeStatus("connecting");
    const channel = supabase
      .channel("softpulse-scans-" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: "scans" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const deleted = payload.old as { id?: string };
          if (deleted.id) setScans((current) => current.filter((scan) => scan.id !== deleted.id));
          return;
        }
        const changedScan = payload.new as Scan;
        if (!changedScan?.id) return;
        setScans((current) => {
          const exists = current.some((scan) => scan.id === changedScan.id);
          return exists
            ? current.map((scan) => scan.id === changedScan.id ? { ...scan, ...changedScan } : scan)
            : [changedScan, ...current];
        });
        if (changedScan.status === "completed") {
          void loadWorkspace(userId);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRealtimeStatus("error");
        else if (status === "CLOSED") setRealtimeStatus("offline");
      });

    return () => {
      setRealtimeStatus("offline");
      void supabase.removeChannel(channel);
    };
  }, [userId, demoMode, loadWorkspace]);

  const notify = (message: string) => setToast(message);
  const isAdmin = demoMode || role === "admin";
  const canScan = demoMode || ["admin", "manager", "engineer"].includes(role);
  const selectedScan = scans.find((scan) => scan.id === selectedScanId) || scans[0];
  const workspaceScores = projects.map((project) =>
    project.health_score ?? scans.find((scan) => scan.project_id === project.id)?.health_score
  ).filter((score): score is number => typeof score === "number" && score > 0);
  const workspaceScore = workspaceScores.length
    ? Math.round(workspaceScores.reduce((sum, score) => sum + score, 0) / workspaceScores.length)
    : 0;
  const latestMetricValue = (key: string, fallback: number) => {
    if (!scans.length) return "—";
    const row = metricRows.find((metric) => metric.scan_id === scans[0].id && metric.metric_key === key);
    return row ? (row.raw_value ?? "N/A") : fallback;
  };
  const selectedModuleMetricValue = (key: string, fallback: ReactNode) => {
    const row = metricRows.find((metric) => metric.module_id === selectedModule?.id && metric.metric_key === key);
    return row ? (row.raw_value ?? "N/A") : fallback;
  };
  const trendChartData = [...scans]
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
    .slice(-8)
    .map((scan) => ({
      scan: formatDate(scan.created_at),
      score: scan.health_score ?? 0,
      repository: getProject(projects, scan.project_id)?.name ?? "Repository"
    }));
  const validRepoUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(repoInput.trim());
  const latestScanByProject = new Map<string, string>();
  [...scans].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .forEach((scan) => { if (!latestScanByProject.has(scan.project_id)) latestScanByProject.set(scan.project_id, scan.id); });
  const moduleInventory = demoMode ? modules : modules.filter((module) =>
    module.scan_id && latestScanByProject.get(module.project_id || "") === module.scan_id
  );
  const filteredProjects = useMemo(() => projects.filter((project) => {
    const grade = project.grade || gradeFrom(project.health_score);
    const matchesText = (project.name + " " + project.repo_url).toLowerCase().includes(projectQuery.toLowerCase());
    const matchesGrade = projectFilter === "all" || grade === projectFilter;
    return matchesText && matchesGrade;
  }), [projects, projectQuery, projectFilter]);
  const filteredModules = useMemo(() => moduleInventory.filter((module) =>
    (module.path + " " + (module.language || "")).toLowerCase().includes(moduleQuery.toLowerCase()) &&
    (moduleFilter === "all" || module.risk === moduleFilter)
  ).sort((a, b) => moduleSort === "lines" ? b.lines_of_code - a.lines_of_code : moduleSort === "path" ? a.path.localeCompare(b.path) : b.risk_probability - a.risk_probability), [moduleInventory, moduleQuery, moduleFilter, moduleSort]);
  const topRiskModules = [...moduleInventory].sort((a, b) => b.risk_probability - a.risk_probability).slice(0, 5);
  const scansForHistory = [...scans].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const searchMatches = globalQuery.trim() ? [
    ...projects.filter((p) => p.name.toLowerCase().includes(globalQuery.toLowerCase())).slice(0, 3).map((p) => ({ label: p.name, detail: "Project", action: () => { setPage("projects"); setProjectQuery(p.name); setShowSearch(false); } })),
    ...modules.filter((m) => m.path.toLowerCase().includes(globalQuery.toLowerCase())).slice(0, 3).map((m) => ({ label: m.path, detail: "Module", action: () => { setPage("modules"); setModuleQuery(m.path); setShowSearch(false); } }))
  ] : [];

  const doSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError(""); setAuthMessage("");
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthError("Enter a valid email address."); return; }
    if (mode !== "reset" && password.length < 8) { setAuthError("Use a password with at least 8 characters."); return; }
    if (!supabase) { setAuthError("Supabase is not configured. Use demo mode or add the project keys to .env.local."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setAuthMessage("Account created. Check your inbox to confirm your email, then sign in.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setAuthMessage("Password reset link sent. Check your inbox.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  };

  const enterDemo = () => {
    setDemoMode(true);
    setSessionEmail("demo@softpulse.dev");
    setRole("admin");
    setPage("dashboard");
    notify("Welcome to the SoftPulse demo workspace.");
  };
  const signOut = async () => {
    if (supabase && !demoMode) await supabase.auth.signOut();
    setDemoMode(!isSupabaseConfigured);
    setSessionEmail(null); setUserId(null); setMode("signin"); setPassword("");
  };
  const changePage = (next: Page) => {
    if (next === "users" && !isAdmin) { notify("Only workspace admins can manage users."); return; }
    setPage(next); setSelectedModule(null); setMobileNavOpen(false); setShowSearch(false);
  };
  const addProject = async (event: FormEvent) => {
    event.preventDefault();
    setRepoTouched(true);
    if (!validRepoUrl) return;
    if (!canScan) { notify("Your workspace role is read-only. Ask an admin for project access."); return; }
    const cleanUrl = repoInput.trim().replace(/\/$/, "");
    const parts = cleanUrl.split("/");
    const owner = parts[3]; const name = parts[4];
    const nextProject: Project = {
      id: "local-" + Date.now(), name: repoNameInput.trim() || name, repo_url: cleanUrl,
      repo_owner: owner, repo_name: name, default_branch: "main", health_score: 0, grade: "—", last_scan: "Not scanned", trend: 0
    };
    try {
      if (supabase && !demoMode && userId) {
        const { data, error } = await supabase.from("projects").insert({
          owner_id: userId, name: nextProject.name, repo_url: cleanUrl, repo_owner: owner, repo_name: name
        }).select().single();
        if (error) throw error;
        setProjects((current) => [data as Project, ...current]);
      } else {
        setProjects((current) => [nextProject, ...current]);
      }
      setShowAddProject(false); setRepoInput(""); setRepoNameInput(""); setRepoTouched(false);
      notify("Repository added. You can start its first scan in the scan workflow.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Unable to add this repository.");
    }
  };
  const startScan = async (project: Project) => {
    if (!canScan) {
      notify("Your workspace role is read-only. Ask an admin or engineer to start a scan.");
      return;
    }
    setScanningProjectId(project.id);
    let pendingScanId: string | null = null;
    try {
      if (supabase && !demoMode && userId) {
        const { data: queuedScan, error: queueError } = await supabase.from("scans").insert({
          project_id: project.id,
          started_by: userId,
          status: "queued",
          progress: 0,
          current_stage: "Clone",
          progress_log: [{
            at: new Date().toISOString(),
            stage: "Clone",
            progress: 0,
            message: "Scan queued. Waiting for the repository analyzer to start."
          }]
        }).select("*").single();
        if (queueError) throw queueError;

        pendingScanId = queuedScan.id;
        setScans((current) => [queuedScan as Scan, ...current]);
        setSelectedScanId(queuedScan.id);
        setPage("scans");
        setMobileNavOpen(false);

        const { data, error } = await supabase.functions.invoke("run-scan", {
          body: { repo_url: project.repo_url, project_id: project.id, scan_id: queuedScan.id }
        });
        if (error) throw error;
        if (data?.cancelled) {
          notify("Scan cancelled. The live status has been saved.");
          await loadWorkspace(userId);
          return;
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.scan?.id) throw new Error("The scan function did not return a scan result.");
        await loadWorkspace(userId);
        setSelectedScanId(data.scan.id);
        setPage("scans");
        notify("Repository scan completed. Your health report is ready.");
      } else {
        const nextId = "demo-scan-" + Date.now();
        pendingScanId = nextId;
        const nextScore = Math.min(96, Math.max(58, (project.health_score || 70) + 3));
        const startedAt = new Date().toISOString();
        const initialLog: ScanLogEntry = {
          at: startedAt, stage: "Clone", progress: 2,
          message: "Demo scan started. Connecting to the sample repository."
        };
        const runningScan: Scan = {
          id: nextId, project_id: project.id, status: "running", progress: 2,
          current_stage: "Clone", current_file: null, health_score: 0,
          commit_sha: "demo" + String(Date.now()).slice(-4),
          commit_message: "Manual SoftPulse demo assessment",
          commit_author: "Demo user", created_at: startedAt,
          started_at: startedAt, progress_log: [initialLog]
        };
        setScans((current) => [runningScan, ...current]);
        setSelectedScanId(nextId);
        setPage("scans");
        setMobileNavOpen(false);
        notify("Demo scan started. Progress will update in this preview.");

        const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const demoSteps: { stage: string; progress: number; message: string; file?: string; score?: number }[] = [
          { stage: "Clone", progress: 8, message: "Repository metadata loaded. Fetching the latest branch." },
          { stage: "Parse", progress: 18, message: "Parsed the source tree and identified supported files." },
          { stage: "Measure", progress: 28, message: "Started measuring source files.", file: "src/index.ts" },
          { stage: "Measure", progress: 39, message: "Measured module complexity and function length.", file: "src/services/payment.ts" },
          { stage: "Measure", progress: 52, message: "Measured duplication, comments and code smells.", file: "src/transform/mapper.ts" },
          { stage: "Measure", progress: 68, message: "Checked test files and dependency manifests.", file: "package.json" },
          { stage: "Score", progress: 72, message: "Normalised metric 1 of 12: lines of code.", score: 66 },
          { stage: "Score", progress: 74, message: "Normalised metric 2 of 12: cyclomatic complexity.", score: 69 },
          { stage: "Score", progress: 76, message: "Normalised metric 3 of 12: maintainability index.", score: 73 },
          { stage: "Score", progress: 78, message: "Normalised metric 4 of 12: duplication.", score: 76 },
          { stage: "Score", progress: 80, message: "Normalised metric 5 of 12: code smells.", score: 78 },
          { stage: "Score", progress: 82, message: "Normalised metric 6 of 12: comment ratio.", score: 80 },
          { stage: "Score", progress: 84, message: "Normalised metric 7 of 12: function length.", score: 82 },
          { stage: "Score", progress: 86, message: "Normalised metric 8 of 12: nesting depth.", score: 84 },
          { stage: "Score", progress: 88, message: "Normalised metric 9 of 12: test coverage.", score: 86 },
          { stage: "Score", progress: 90, message: "Normalised metric 10 of 12: test-to-code ratio.", score: 87 },
          { stage: "Score", progress: 92, message: "Normalised metric 11 of 12: outdated dependencies.", score: 88 },
          { stage: "Score", progress: 94, message: "Normalised metric 12 of 12: vulnerable dependencies.", score: nextScore },
          { stage: "Report", progress: 97, message: "Generating the module risk report and refactoring priorities.", score: nextScore }
        ];
        for (const step of demoSteps) {
          await wait(360);
          if (cancelledDemoScanIds.current.has(nextId)) {
            cancelledDemoScanIds.current.delete(nextId);
            return;
          }
          const entry: ScanLogEntry = { at: new Date().toISOString(), stage: step.stage, progress: step.progress, message: step.message };
          setScans((current) => current.map((scan) => scan.id === nextId ? {
            ...scan,
            status: "running",
            progress: step.progress,
            current_stage: step.stage,
            current_file: step.file ?? null,
            health_score: step.score ?? scan.health_score,
            progress_log: [...(scan.progress_log ?? []), entry].slice(-120)
          } : scan));
        }
        await wait(300);
        if (cancelledDemoScanIds.current.has(nextId)) {
          cancelledDemoScanIds.current.delete(nextId);
          return;
        }
        const completedLog: ScanLogEntry = {
          at: new Date().toISOString(), stage: "Report", progress: 100,
          message: "Scan completed. Health score and module report are ready."
        };
        const nextScan: Scan = {
          ...runningScan, status: "completed", progress: 100, current_stage: "Report",
          current_file: null, health_score: nextScore, grade: gradeFrom(nextScore),
          completed_at: new Date().toISOString(),
          progress_log: [...(runningScan.progress_log ?? []), ...demoSteps.map((step) => ({ at: startedAt, stage: step.stage, progress: step.progress, message: step.message })), completedLog]
        };
        const nextModules = demoModules.slice(0, 5).map((module, index) => ({
          ...module, id: nextId + "-m" + index, scan_id: nextId, project_id: project.id
        }));
        setScans((current) => current.map((scan) => scan.id === nextId ? nextScan : scan));
        setModules((current) => [...nextModules, ...current]);
        setProjects((current) => current.map((item) => item.id === project.id
          ? { ...item, health_score: nextScore, grade: gradeFrom(nextScore), last_scan: "Just now", trend: 3 }
          : item));
        notify("Demo scan completed. Sample report generated.");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to start repository scan.";
      if (pendingScanId && supabase && !demoMode) {
        await supabase.from("scans").update({
          status: "failed",
          error_message: message,
          current_stage: "Report",
          completed_at: new Date().toISOString()
        }).eq("id", pendingScanId).in("status", ["queued", "running"]);
      }
      notify(message);
    } finally {
      setScanningProjectId(null);
    }
  };

  const cancelSelectedScan = async () => {
    const scan = selectedScan;
    if (!scan || !["queued", "running"].includes(scan.status)) return;
    if (!canScan) {
      notify("Only an admin, manager or engineer can cancel a scan.");
      return;
    }
    if (!window.confirm("Cancel this scan? The partial results will remain in scan history.")) return;

    if (demoMode) {
      cancelledDemoScanIds.current.add(scan.id);
      const logEntry: ScanLogEntry = {
        at: new Date().toISOString(), stage: "Cancelled", progress: scan.progress ?? 0,
        message: "Demo scan cancelled by the workspace user."
      };
      setScans((current) => current.map((item) => item.id === scan.id ? {
        ...item, status: "cancelled", current_stage: "Cancelled", current_file: null,
        cancelled_at: new Date().toISOString(), completed_at: new Date().toISOString(),
        progress_log: [...(item.progress_log ?? []), logEntry]
      } : item));
      notify("Demo scan cancelled.");
      return;
    }

    if (!supabase) return;
    try {
      const logEntry: ScanLogEntry = {
        at: new Date().toISOString(), stage: "Cancelled", progress: scan.progress ?? 0,
        message: "Cancellation requested by a workspace user."
      };
      const { data, error } = await supabase.from("scans").update({
        status: "cancelled",
        current_stage: "Cancelled",
        current_file: null,
        cancelled_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        progress_log: [...(scan.progress_log ?? []), logEntry].slice(-120)
      }).eq("id", scan.id).in("status", ["queued", "running"]).select("id").maybeSingle();
      if (error) throw error;
      if (!data) {
        notify("This scan has already finished or been cancelled.");
        return;
      }
      setScans((current) => current.map((item) => item.id === scan.id ? {
        ...item, status: "cancelled", current_stage: "Cancelled", current_file: null,
        cancelled_at: new Date().toISOString(), completed_at: new Date().toISOString(),
        progress_log: [...(item.progress_log ?? []), logEntry].slice(-120)
      } : item));
      notify("Cancellation requested. The scanner will stop at its next checkpoint.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Unable to cancel this scan.");
    }
  };

  const updateUserRole = async (id: string, nextRole: Role) => {
    if (!isAdmin) return;
    try {
      if (supabase && !demoMode) {
        const { error } = await supabase.from("user_roles").update({ role: nextRole }).eq("user_id", id);
        if (error) throw error;
      }
      setUsers((current) => current.map((user) => user.id === id ? { ...user, role: nextRole } : user));
      notify("User role updated.");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Unable to update user role."); }
  };
  const retryLoad = () => { if (userId) void loadWorkspace(userId); else { setDataError(""); notify("Demo data is ready."); } };

  const navItems: { id: Page; label: string; icon: ReactNode }[] = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
    { id: "projects", label: "Projects", icon: <FolderGit2 size={18} /> },
    { id: "scans", label: "Scans", icon: <Activity size={18} /> },
    { id: "modules", label: "Modules", icon: <FileCode2 size={18} /> },
    { id: "risks", label: "Risk ranking", icon: <Flame size={18} /> },
    { id: "history", label: "Scan history", icon: <History size={18} /> },
    { id: "users", label: "Users", icon: <Users size={18} /> },
    { id: "settings", label: "Settings", icon: <Settings size={18} /> }
  ];
  const titles: Record<Page, string> = {
    dashboard: "Dashboard", projects: "Projects", scans: "Scan details", modules: "Module report",
    risks: "Risk ranking", history: "Scan history", users: "User management", settings: "Settings"
  };

  if (!sessionEmail) {
    return <main className="auth-shell">
      <section className="visual-panel" aria-label="SoftPulse product overview">
        <div className="visual-grid" />
        <div className="brand brand-light"><span className="brand-mark"><Activity size={19} /></span><span>softpulse</span></div>
        <div className="visual-copy">
          <div className="eyebrow"><span className="pulse-dot" /> SOFTWARE HEALTH INTELLIGENCE</div>
          <h1>Build with confidence.<br /><span>Maintain with clarity.</span></h1>
          <p>One clear view of code quality, maintainability and the work that matters next.</p>
          <div className="preview-card">
            <div className="preview-top"><span>Repository health</span><span className="live-label"><i /> READY</span></div>
            <div className="preview-score-row"><div className="score-ring"><div><strong>87</strong><small>/100</small></div></div><div className="score-copy"><strong>Healthy codebase</strong><span>Grade A <b>↑ 4.2%</b></span><small>Compared with your last assessment</small></div></div>
            <div className="preview-bars">
              <div><span>Maintainability</span><i><b style={{ width: "91%" }} /></i><strong>91</strong></div>
              <div><span>Test coverage</span><i><b style={{ width: "78%" }} /></i><strong>78</strong></div>
              <div><span>Code quality</span><i><b style={{ width: "84%" }} /></i><strong>84</strong></div>
            </div>
            <div className="preview-foot"><span><Code2 size={14} /> commons-utils</span><span>Last scan · 8 min ago</span></div>
          </div>
        </div>
        <div className="visual-footer"><span>Clarity for every commit.</span><span>© 2026 SoftPulse</span></div>
      </section>
      <section className="form-panel">
        <header className="form-header">
          <div className="brand brand-dark"><span className="brand-mark"><Activity size={18} /></span><span>softpulse</span></div>
          <button className="theme-toggle" onClick={() => setDark((v) => !v)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        </header>
        <div className="form-wrap">
          <div className="form-heading">
            <div className="eyebrow muted">{mode === "signup" ? "GET STARTED" : mode === "reset" ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</div>
            <h2>{mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in to SoftPulse"}</h2>
            <p className="subcopy">{mode === "signup" ? "Start making software health visible." : mode === "reset" ? "We'll email you a secure reset link." : "Your codebase health, all in one place."}</p>
          </div>
          {!isSupabaseConfigured && <div className="config-note"><ShieldCheck size={17} /><span><strong>Demo workspace available</strong><br />Explore the product with sample projects and scan history.</span></div>}
          <form onSubmit={doSignIn} noValidate>
            <label htmlFor="email">Email address</label>
            <div className="input-wrap"><Mail size={17} /><input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {mode !== "reset" && <>
              <div className="label-row"><label htmlFor="password">Password</label>{mode === "signin" && <button type="button" className="text-button" onClick={() => { setMode("reset"); setAuthError(""); setAuthMessage(""); }}>Forgot password?</button>}</div>
              <div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="eye-button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            </>}
            {authError && <div className="form-alert error" role="alert">{authError}</div>}
            {authMessage && <div className="form-alert success" role="status">{authMessage}</div>}
            {isSupabaseConfigured && <button className="primary-button" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"} <ArrowRight size={17} /></button>}
          </form>
          {!isSupabaseConfigured && <button className="primary-button demo-entry" onClick={enterDemo}>Explore demo workspace <ArrowRight size={17} /></button>}
          {isSupabaseConfigured && <div className="form-switch">{mode === "signup" ? "Already have an account?" : mode === "reset" ? "Remembered your password?" : "New to SoftPulse?"} <button className="text-button strong" onClick={() => { setMode(mode === "signup" || mode === "reset" ? "signin" : "signup"); setAuthError(""); setAuthMessage(""); }}>{mode === "signup" || mode === "reset" ? "Sign in" : "Create an account"}</button></div>}
          <div className="security-note"><ShieldCheck size={15} /> Your workspace is protected with role-based access.</div>
        </div>
        <footer className="form-footer"><span>Privacy</span><span>Security</span><span>Help centre</span><span className="version">SOFTPULSE 0.2.0</span></footer>
      </section>
    </main>;
  }

  const pageIntro: Record<Page, string> = {
    dashboard: "A current view of software quality across your repositories.",
    projects: "Manage repositories and keep their health assessments organised.",
    scans: "Review the measurements and outcome of a repository scan.",
    modules: "Find the modules creating the most maintenance pressure.",
    risks: "Prioritise refactoring work by risk, effort and technical debt.",
    history: "Track score movement and compare individual assessments.",
    users: "Manage workspace access and responsibilities.",
    settings: "Understand the scoring model and workspace preferences."
  };

  const renderDashboard = () => projects.length === 0 ? <div className="card"><EmptyState icon={<FolderGit2 size={22} />} title="Your workspace is ready" copy="Add a public GitHub repository to begin measuring code health and maintenance risk." /><button className="button-primary centered-button" onClick={() => setShowAddProject(true)}><Plus size={15} /> Add first repository</button></div> : <div className="page-stack">
    <div className="welcome-row"><div><div className="eyebrow muted">WORKSPACE OVERVIEW</div><h1>Good morning<span className="welcome-period">.</span></h1><p>Here’s the latest health pulse across your repositories.</p></div><button className="button-secondary" onClick={() => changePage("projects")}><Plus size={16} /> Add repository</button></div>
    <div className="dashboard-hero card">
      <div className="hero-score">
        <div className="eyebrow muted">WORKSPACE HEALTH</div>
        <ScoreGauge score={workspaceScore} />
        <div className="score-context"><span className="neutral-trend">Portfolio average</span><span>across repositories with a completed scan</span></div>
      </div>
      <div className="hero-divider" />
      <div className="hero-summary"><div className="eyebrow muted">AT A GLANCE</div><h2>{workspaceScore >= 85 ? "Your repositories are in healthy shape." : workspaceScore >= 70 ? "Your workspace has a solid foundation." : "There are opportunities to improve maintainability."}</h2><p>The portfolio score is the average of each repository’s latest completed assessment. Open a project to review the factors behind its score.</p>
        <div className="hero-stats">
          <div><strong>{projects.length.toString().padStart(2, "0")}</strong><span>Repositories</span></div>
          <div><strong>{scans.length.toString().padStart(2, "0")}</strong><span>Completed scans</span></div>
          <div><strong>{moduleInventory.filter((m) => m.risk === "high").length.toString().padStart(2, "0")}</strong><span>High-risk modules</span></div>
        </div>
      </div>
      <div className="hero-grade"><GradeBadge grade={gradeFrom(workspaceScore)} /><span>Overall grade</span><small>Target: 85+</small></div>
    </div>
    <div className="section-heading"><div><h2>Quality indicators</h2><p>Six core signals, each updated from the latest available assessment.</p></div><button className="quiet-button" onClick={() => changePage("settings")}>Scoring methodology <ArrowRight size={14} /></button></div>
    <div className="metric-grid">
      {[
        ["maintainability_index", "Maintainability index", latestMetricValue("maintainability_index", 86), "+5.2%", "positive", "MI"],
        ["cyclomatic_complexity", "Cyclomatic complexity", latestMetricValue("cyclomatic_complexity", 7.4), "−0.8", "positive", "CC"],
        ["duplication_pct", "Code duplication", latestMetricValue("duplication_pct", 3.8), "−1.1%", "positive", "DU"],
        ["test_coverage_pct", "Test coverage", latestMetricValue("test_coverage_pct", 78), "+6.4%", "positive", "TC"],
        ["code_smells", "Code smells", latestMetricValue("code_smells", 24), "−8", "positive", "CS"],
        ["vulnerable_dependencies", "Vulnerable dependencies", latestMetricValue("vulnerable_dependencies", 2), "No change", "neutral", "VD"]
      ].map((item, i) => <div className="metric-card card" key={item[0]}>
        <div className="metric-card-top"><span className="metric-symbol">{item[5]}</span><span className="metric-label">{item[1]}</span></div>
        <div className="metric-value-row"><strong>{item[2]}{item[0] === "duplication_pct" || item[0] === "test_coverage_pct" ? "%" : ""}</strong><span className={item[4] === "positive" ? "delta positive-trend" : "delta neutral-trend"}>{item[3]}</span></div>
        <Sparkline values={sparkData[i]} />
      </div>)}
    </div>
    <div className="content-grid two-one">
      <section className="card chart-card">
        <div className="card-heading"><div><h2>Health score trend</h2><p>Last eight assessments · score out of 100</p></div><button className="quiet-button" onClick={() => changePage("history")}>View history <ArrowRight size={14} /></button></div>
        <div className="chart-legend"><span><i className="legend-dot teal" /> Assessment health score</span></div>
        <div className="main-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendChartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><CartesianGrid stroke="rgb(var(--border))" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="scan" tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 11 }} /><YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 11 }} /><Tooltip formatter={(value, _name, item) => [value + " / 100", item.payload.repository]} contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--border))", borderRadius: 10, color: "rgb(var(--text))" }} /><Line type="monotone" dataKey="score" name="Health score" stroke="rgb(var(--accent))" strokeWidth={2.5} dot={{ r: 3, fill: "rgb(var(--accent))" }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div>
      </section>
      <section className="card risk-preview-card">
        <div className="card-heading"><div><h2>Highest risk modules</h2><p>Start with these refactoring candidates.</p></div><button className="icon-button" aria-label="Open risk ranking" onClick={() => changePage("risks")}><ArrowRight size={17} /></button></div>
        <div className="risk-preview-list">{topRiskModules.slice(0, 5).map((module) => <button className="risk-preview-item" key={module.id} onClick={() => { changePage("modules"); setSelectedModule(module); }}>
          <span className="file-icon"><FileCode2 size={16} /></span><span className="risk-file"><strong>{module.path.split("/").pop()}</strong><small>{module.path}</small></span><RiskPill risk={module.risk} />
        </button>)}</div>
        <button className="text-link" onClick={() => changePage("risks")}>See complete risk ranking <ArrowRight size={14} /></button>
      </section>
    </div>
    <section className="card recent-card">
      <div className="card-heading"><div><h2>Recent scans</h2><p>Latest repository assessments in this workspace.</p></div><button className="quiet-button" onClick={() => changePage("history")}>All scans <ArrowRight size={14} /></button></div>
      <ScanTable scans={scans.slice(0, 4)} projects={projects} onSelect={(scan) => { setSelectedScanId(scan.id); changePage("scans"); }} />
    </section>
  </div>;

  const renderProjects = () => <div className="page-stack">
    <div className="page-toolbar"><div className="search-field"><Search size={16} /><input placeholder="Search repositories..." value={projectQuery} onChange={(e) => setProjectQuery(e.target.value)} /></div><div className="toolbar-actions"><select className="select-control" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Filter projects by grade"><option value="all">All grades</option>{["A","B","C","D","E"].map((g) => <option key={g} value={g}>Grade {g}</option>)}</select><button className="button-primary" onClick={() => { setShowAddProject(true); setRepoTouched(false); }}><Plus size={16} /> Add repository</button></div></div>
    <div className="project-grid">
      {filteredProjects.map((project) => {
        const projectHistory = scans.filter((s) => s.project_id === project.id).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        const projectLatestScan = projectHistory[0];
        const projectTrend = project.trend ?? (projectHistory.length > 1 ? (projectHistory[0].health_score ?? 0) - (projectHistory[1].health_score ?? 0) : 0);
        const score = project.health_score ?? projectLatestScan?.health_score ?? 0;
        const lastScanLabel = project.last_scan || (projectLatestScan?.created_at ? formatDate(projectLatestScan.created_at) : "No scan yet");
        const grade = project.grade || gradeFrom(score);
        return <article className="project-card card" key={project.id}>
          <div className="project-card-top"><div className="repo-avatar"><Github size={20} /></div><button className="icon-button" aria-label={"Open actions for " + project.name} onClick={() => notify("Project actions are available in the next workflow update.")}><MoreHorizontal size={18} /></button></div>
          <div className="project-name-row"><h3>{project.name}</h3><GradeBadge grade={grade} /></div>
          <a className="repo-url" href={project.repo_url} target="_blank" rel="noreferrer">{project.repo_owner || "github"}/{project.repo_name || project.name} <ExternalLink size={12} /></a>
          <div className="project-score-row"><strong>{score || "—"}</strong><span>/ 100 health score</span><span className={projectTrend > 0 ? "trend-up" : projectTrend < 0 ? "trend-down" : "trend-flat"}>{projectTrend ? (projectTrend > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />) : null}{projectTrend ? Math.abs(projectTrend) + " pts" : "New"}</span></div>
          <div className="mini-progress"><i style={{ width: Math.max(0, Math.min(100, score)) + "%" }} /></div>
          <div className="project-meta"><span><GitBranch size={13} /> {project.default_branch || "main"}</span><span><Clock3 size={13} /> {lastScanLabel}</span></div>
          <div className="project-card-footer"><button className="button-secondary project-scan-action" disabled={!canScan || scanningProjectId === project.id} onClick={() => void startScan(project)}><RefreshCw size={13} className={scanningProjectId === project.id ? "spin-icon" : ""} />{scanningProjectId === project.id ? "Scanning…" : "Scan now"}</button><button className="text-link" onClick={() => { const s = scans.find((scan) => scan.project_id === project.id); if (s) { setSelectedScanId(s.id); changePage("scans"); } else notify("No assessment yet. Start the first scan."); }}>Latest report <ArrowRight size={14} /></button><button className="icon-button" aria-label={"Open " + project.name + " on GitHub"} onClick={() => window.open(project.repo_url, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /></button></div>
        </article>;
      })}
      {filteredProjects.length === 0 && <div className="card full-span"><EmptyState icon={<FolderGit2 size={22} />} title="No repositories found" copy="Try another search or add a public GitHub repository to get started." /><button className="button-primary centered-button" onClick={() => setShowAddProject(true)}><Plus size={16} /> Add repository</button></div>}
    </div>
  </div>;

  const renderScans = () => {
    const scan = selectedScan || scans[0];
    const project = scan ? getProject(projects, scan.project_id) : undefined;
    const scanModules = scan ? modules.filter((module) => module.scan_id === scan.id) : [];
    return <div className="page-stack">
      {scan ? <>
        <div className="scan-detail-header card">
          <div className="scan-title-line"><div><div className="eyebrow muted">ASSESSMENT REPORT</div><h2>{project?.name || "Repository scan"}</h2><a className="repo-url" href={project?.repo_url} target="_blank" rel="noreferrer">{project?.repo_url || "Repository details unavailable"} <ExternalLink size={12} /></a></div><GradeBadge grade={scan.grade || gradeFrom(scan.health_score)} /></div>
          <div className="scan-meta-grid"><div><span>Scan ID</span><strong>{scan.id}</strong></div><div><span>Commit</span><strong>{(scan.commit_sha || "—").slice(0, 8)}</strong></div><div><span>Author</span><strong>{scan.commit_author || "SoftPulse"}</strong></div><div><span>Scanned</span><strong>{formatDate(scan.created_at)}</strong></div></div>
          <div className="commit-message"><GitBranch size={15} /><span>{scan.commit_message || "Repository health assessment"}</span><span className="status-complete"><Check size={13} /> {scan.status}</span></div>
        </div>
        <div className="scan-stage-card card">
          <div className="card-heading"><div><h2>Scan pipeline</h2><p>Five stages from repository inspection to the final health report.</p></div><span className="status-complete"><Check size={13} /> Completed</span></div>
          <div className="scan-stepper">{["Clone", "Parse", "Measure", "Score", "Report"].map((stage, i) => <div className="scan-step" key={stage}><div className="step-node"><Check size={15} /></div><strong>{stage}</strong><small>{i === 0 ? "Repository fetched" : i === 1 ? "Source parsed" : i === 2 ? "12 metrics measured" : i === 3 ? "Weighted score" : "Report ready"}</small></div>)}</div>
          <div className="step-progress"><span style={{ width: "100%" }} /></div>
          <div className="pipeline-note"><span>Latest scan is complete.</span><span>Live progress, current-file streaming and cancellation will be added in Step 1.</span></div>
        </div>
        <div className="content-grid scan-results-grid">
          <div className="card results-score-card"><div className="eyebrow muted">HEALTH SCORE</div><ScoreGauge score={scan.health_score ?? 87} /><p>Score combines the 12 normalised code-quality metrics using the weights in Settings.</p></div>
          <div className="card results-overview"><div className="card-heading"><div><h2>Assessment summary</h2><p>Current results from the selected scan.</p></div></div><div className="summary-stat-grid">
            <div><strong>12</strong><span>Metrics measured</span></div><div><strong>{scanModules.length}</strong><span>Modules analysed</span></div><div><strong>{scanModules.filter((m) => m.risk === "high").length}</strong><span>High-risk modules</span></div><div><strong>{scanModules.reduce((sum, m) => sum + m.estimated_refactor_hours, 0)}h</strong><span>Refactoring estimate</span></div>
          </div><div className="plain-explain"><Sparkles size={16} /><p><strong>What this means:</strong> a higher score indicates a more maintainable repository. A-grade projects score 85 or above; lower grades identify where engineering effort may have the greatest return.</p></div></div>
        </div>
        <div className="card recent-card"><div className="card-heading"><div><h2>Modules in this assessment</h2><p>Review module health and open the full report.</p></div><button className="quiet-button" onClick={() => changePage("modules")}>Open module report <ArrowRight size={14} /></button></div>{scanModules.length ? <ModuleTable modules={scanModules.slice(0, 5)} onSelect={(m) => { changePage("modules"); setSelectedModule(m); }} /> : <EmptyState icon={<FileCode2 size={22} />} title="No module details for this scan" copy="The scan has no saved module measurements. Run a new scan after deploying the run-scan function." />}</div>
      </> : <div className="card"><EmptyState icon={<Activity size={22} />} title="No scans yet" copy="Add a public GitHub repository to prepare your first assessment." /><button className="button-primary centered-button" onClick={() => changePage("projects")}>View projects</button></div>}
    </div>;
  };

  const renderModules = () => <div className="page-stack">
    <div className="module-summary-strip"><div><strong>{moduleInventory.length}</strong><span>Modules analysed</span></div><div><strong>{moduleInventory.filter((m) => m.risk === "high").length}</strong><span>High risk</span></div><div><strong>{moduleInventory.filter((m) => m.risk === "medium").length}</strong><span>Medium risk</span></div><div><strong>{moduleInventory.filter((m) => m.risk === "low").length}</strong><span>Low risk</span></div></div>
    <div className="card">
      <div className="card-heading"><div><h2>Module inventory</h2><p>Sort and filter modules to locate maintenance hotspots.</p></div><button className="button-secondary" onClick={() => notify("Module CSV export will be enabled with report exports.")}><Download size={15} /> Export</button></div>
      <div className="table-toolbar"><div className="search-field"><Search size={15} /><input placeholder="Find a module..." value={moduleQuery} onChange={(e) => setModuleQuery(e.target.value)} /></div><select className="select-control" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} aria-label="Filter module risk"><option value="all">All risks</option><option value="high">High risk</option><option value="medium">Medium risk</option><option value="low">Low risk</option></select><select className="select-control" value={moduleSort} onChange={(e) => setModuleSort(e.target.value as typeof moduleSort)} aria-label="Sort modules"><option value="risk">Sort: Risk</option><option value="lines">Sort: LOC</option><option value="path">Sort: Name</option></select></div>
      <ModuleTable modules={filteredModules} onSelect={setSelectedModule} />
      {filteredModules.length === 0 && <EmptyState icon={<FileCode2 size={22} />} title="No matching modules" copy="Change the risk filter or search for another module path." />}
    </div>
    <div className="card treemap-card"><div className="card-heading"><div><h2>Codebase risk map</h2><p>Tile area represents lines of code; colour indicates maintenance risk.</p></div><div className="treemap-legend"><span><i className="low" /> Low</span><span><i className="medium" /> Medium</span><span><i className="high" /> High</span></div></div>
      <div className="treemap-grid">{moduleInventory.slice(0, 12).map((module) => <button key={module.id} className={"treemap-tile " + riskClass(module.risk)} style={{ flexGrow: Math.max(1, module.lines_of_code / 280), flexBasis: Math.max(125, Math.min(255, module.lines_of_code / 9)) + "px" }} onClick={() => setSelectedModule(module)}><strong>{module.path.split("/").pop()}</strong><span>{module.lines_of_code.toLocaleString()} LOC</span><small>{module.risk} risk</small></button>)}</div>
    </div>
  </div>;

  const renderRisks = () => <div className="page-stack">
    <div className="risk-overview-grid">
      <div className="card risk-overview-card"><div className="eyebrow muted">TOTAL TECHNICAL DEBT</div><strong>146h</strong><p>Estimated refactoring effort across the analysed modules.</p><div className="risk-stat-foot"><span className="positive-trend">↓ 12h</span><span>from the previous assessment</span></div></div>
      <div className="card risk-overview-card"><div className="eyebrow muted">HIGH-RISK MODULES</div><strong>{moduleInventory.filter((m) => m.risk === "high").length}</strong><p>Modules with elevated maintenance probability.</p><div className="risk-stat-foot"><span className="risk-dot high" /> <span>Needs engineering attention</span></div></div>
      <div className="card risk-overview-card"><div className="eyebrow muted">TECHNICAL DEBT RATIO</div><strong>18.6%</strong><p>Estimated rework compared with total implementation effort.</p><div className="risk-stat-foot"><span className="trend-down">−2.1%</span><span>since the prior scan</span></div></div>
    </div>
    <div className="content-grid risk-content-grid">
      <div className="card">
        <div className="card-heading"><div><h2>Refactoring priority</h2><p>Ranked by estimated probability of maintenance friction.</p></div><span className="eyebrow muted">TOP {modules.length}</span></div>
        <div className="ranked-risk-list">{[...moduleInventory].sort((a, b) => b.risk_probability - a.risk_probability).map((module, i) => <button className="ranked-risk-row" key={module.id} onClick={() => { changePage("modules"); setSelectedModule(module); }}><span className="rank-number">{String(i + 1).padStart(2, "0")}</span><span className="rank-main"><strong>{module.path.split("/").pop()}</strong><small>{module.path}</small><i className="risk-bar"><b className={riskClass(module.risk)} style={{ width: module.risk_probability + "%" }} /></i></span><span className="rank-probability">{module.risk_probability}%<small>risk</small></span><span className="rank-hours">{module.estimated_refactor_hours}h<small>estimate</small></span></button>)}</div>
      </div>
      <div className="risk-side-stack">
        <div className="card top-action-card"><div className="action-spark"><Sparkles size={17} /></div><div className="eyebrow muted">TOP ACTION</div><h2>Break down the payment service.</h2><p><strong>src/services/payment.ts</strong> has high complexity and long functions. Extract payment validation and retry orchestration into smaller units.</p><div className="action-impact"><div><strong>18h</strong><span>Estimated effort</span></div><div><strong>+6 pts</strong><span>Potential score gain</span></div></div><button className="button-primary" onClick={() => notify("Refactoring plans arrive in Step 6.")}>View recommendation <ArrowRight size={15} /></button></div>
        <div className="card risk-breakdown-card"><h3>Risk distribution</h3>{(["high", "medium", "low"] as Risk[]).map((risk) => <div className="risk-breakdown-row" key={risk}><span><RiskPill risk={risk} /></span><strong>{moduleInventory.filter((m) => m.risk === risk).length}</strong><small>modules</small></div>)}</div>
      </div>
    </div>
  </div>;

  const renderHistory = () => {
    const a = scans.find((scan) => scan.id === compareA) || scans[0];
    const b = scans.find((scan) => scan.id === compareB) || scans[1] || scans[0];
    return <div className="page-stack">
      <div className="card history-timeline-card"><div className="card-heading"><div><h2>Assessment timeline</h2><p>Health and grade changes across the workspace.</p></div><button className="button-secondary" onClick={() => notify("Report export is planned for Step 8.")}><Download size={15} /> Export history</button></div>
        <div className="history-timeline">{scansForHistory.map((scan, i) => {
          const project = getProject(projects, scan.project_id);
          return <button className="timeline-row" key={scan.id} onClick={() => { setSelectedScanId(scan.id); changePage("scans"); }}><div className="timeline-marker"><span /></div><div className="timeline-date">{formatDate(scan.created_at)}<small>{i === 0 ? "Latest" : "Assessment"}</small></div><div className="timeline-body"><strong>{project?.name || "Repository"}</strong><p>{scan.commit_message || "Health assessment complete"}</p><small>{(scan.commit_sha || "—").slice(0, 8)} · {scan.commit_author || "SoftPulse"}</small></div><div className="timeline-score"><strong>{scan.health_score ?? "—"}</strong><GradeBadge grade={scan.grade || gradeFrom(scan.health_score)} /></div><ChevronRight size={16} className="timeline-chevron" /></button>;
        })}</div>
      </div>
      <div className="card compare-card"><div className="card-heading"><div><h2>Compare assessments</h2><p>Choose two scans to review their score and grade side by side.</p></div><span className="eyebrow muted">COMPARISON</span></div>
        <div className="compare-selects"><label>Assessment A<select value={compareA} onChange={(e) => setCompareA(e.target.value)}>{scans.map((scan) => <option value={scan.id} key={scan.id}>{getProject(projects, scan.project_id)?.name || "Repository"} · {formatDate(scan.created_at)} · {scan.health_score}</option>)}</select></label><span className="compare-vs">VS</span><label>Assessment B<select value={compareB} onChange={(e) => setCompareB(e.target.value)}>{scans.map((scan) => <option value={scan.id} key={scan.id}>{getProject(projects, scan.project_id)?.name || "Repository"} · {formatDate(scan.created_at)} · {scan.health_score}</option>)}</select></label></div>
        <div className="compare-results"><div><span>{getProject(projects, a?.project_id)?.name || "Assessment A"}</span><strong>{a?.health_score ?? "—"}</strong><GradeBadge grade={a?.grade || gradeFrom(a?.health_score)} /></div><div className="compare-delta"><span>Score difference</span><strong className={(a?.health_score ?? 0) >= (b?.health_score ?? 0) ? "positive-trend" : "trend-down"}>{(a?.health_score ?? 0) - (b?.health_score ?? 0) > 0 ? "+" : ""}{(a?.health_score ?? 0) - (b?.health_score ?? 0)} pts</strong></div><div><span>{getProject(projects, b?.project_id)?.name || "Assessment B"}</span><strong>{b?.health_score ?? "—"}</strong><GradeBadge grade={b?.grade || gradeFrom(b?.health_score)} /></div></div>
      </div>
    </div>;
  };

  const renderUsers = () => !isAdmin ? <div className="card"><EmptyState icon={<ShieldCheck size={22} />} title="Admin access required" copy="Only workspace administrators can manage user roles." /></div> : <div className="page-stack">
    <div className="users-summary"><div className="card"><span>Workspace members</span><strong>{users.length}</strong></div><div className="card"><span>Engineers & managers</span><strong>{users.filter((u) => ["engineer", "manager"].includes(u.role)).length}</strong></div><div className="card"><span>Read-only members</span><strong>{users.filter((u) => u.role === "viewer").length}</strong></div></div>
    <div className="card"><div className="card-heading"><div><h2>Workspace members</h2><p>Roles determine which actions each member can perform.</p></div><span className="admin-lock"><ShieldCheck size={14} /> Admin only</span></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Permissions</th><th>Access</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="member-cell"><span className="member-avatar">{(user.display_name || user.email).slice(0, 1).toUpperCase()}</span><span><strong>{user.display_name || user.email.split("@")[0]}</strong><small>{user.email}</small></span></div></td><td><select className="select-control role-select" value={user.role} disabled={!isAdmin || (user.id === userId)} onChange={(e) => void updateUserRole(user.id, e.target.value as Role)} aria-label={"Role for " + user.email}>{(["admin", "manager", "engineer", "viewer"] as Role[]).map((r) => <option value={r} key={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></td><td><span className="permission-text">{user.role === "admin" ? "Full workspace control" : user.role === "manager" ? "Manage projects and scans" : user.role === "engineer" ? "Add repositories and scan" : "Read-only access"}</span></td><td><span className="member-active"><i /> Active</span></td></tr>)}</tbody></table></div>
      <div className="role-note"><AlertCircle size={15} /><span>Role changes are enforced by database Row Level Security. A member cannot grant themselves additional permissions.</span></div>
    </div>
  </div>;

  const renderSettings = () => <div className="page-stack">
    <div className="card settings-intro"><div className="settings-icon"><SlidersHorizontal size={20} /></div><div><h2>Health score methodology</h2><p>SoftPulse normalises each metric to a 0–100 quality score, then calculates a weighted average. Weights are stored in the database and sum to 100%.</p></div></div>
    <div className="card"><div className="card-heading"><div><h2>Metric weights</h2><p>Each weight shows how much the metric contributes to the final score.</p></div><span className="weight-total">100% total</span></div>
      <div className="weights-list">{weightRows.map((metric) => <div className="weight-row" key={metric.key}><div className="weight-name"><strong>{metric.label}</strong><small>{metric.note}</small></div><div className="weight-meter"><i style={{ width: metric.weight * 6 + "%" }} /></div><strong className="weight-value">{metric.weight}%</strong><span className="direction-tag">{metric.direction}</span></div>)}</div>
    </div>
    <div className="content-grid two-one">
      <div className="card"><div className="card-heading"><div><h2>Grade thresholds</h2><p>Every score is paired with a letter grade.</p></div></div><div className="grade-thresholds">{[{g:"A",r:"85–100",t:"Excellent"},{g:"B",r:"70–84",t:"Good"},{g:"C",r:"55–69",t:"Moderate"},{g:"D",r:"40–54",t:"Needs attention"},{g:"E",r:"0–39",t:"Critical"}].map((item) => <div className="grade-threshold-row" key={item.g}><GradeBadge grade={item.g} /><strong>{item.r}</strong><span>{item.t}</span></div>)}</div></div>
      <div className="card"><div className="card-heading"><div><h2>Workspace preferences</h2><p>Appearance and account session.</p></div></div><div className="preference-row"><span><strong>Appearance</strong><small>Choose light or dark workspace theme.</small></span><button className="button-secondary" onClick={() => setDark((v) => !v)}>{dark ? <Sun size={15} /> : <Moon size={15} />}{dark ? "Light mode" : "Dark mode"}</button></div><div className="preference-row"><span><strong>Signed in as</strong><small>{sessionEmail}</small></span><button className="quiet-button" onClick={signOut}><LogOut size={14} /> Sign out</button></div></div>
    </div>
  </div>;

  const renderPage = () => {
    if (loading) return <Skeleton count={6} />;
    switch (page) {
      case "dashboard": return renderDashboard();
      case "projects": return renderProjects();
      case "scans": return renderScans();
      case "modules": return renderModules();
      case "risks": return renderRisks();
      case "history": return renderHistory();
      case "users": return renderUsers();
      case "settings": return renderSettings();
      default: return renderDashboard();
    }
  };

  return <div className="app-shell">
    <aside className={"sidebar " + (sidebarCollapsed ? "collapsed" : "") + (mobileNavOpen ? " mobile-open" : "")}>
      <div className="sidebar-brand"><span className="brand-mark"><Activity size={18} /></span>{!sidebarCollapsed && <span>softpulse</span>}<button className="collapse-button" onClick={() => setSidebarCollapsed((v) => !v)} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}><ChevronLeft size={16} /></button></div>
      <div className="workspace-switch"><div className="workspace-avatar">S</div>{!sidebarCollapsed && <div><strong>SoftPulse workspace</strong><small>{demoMode ? "Demo environment" : "Team workspace"}</small></div>}<ChevronDown size={14} /></div>
      <div className="nav-caption">{!sidebarCollapsed && "WORKSPACE"}</div>
      <nav className="side-nav" aria-label="Main navigation">{navItems.map((item) => <button key={item.id} className={"nav-item " + (page === item.id ? "active" : "") + (item.id === "users" && !isAdmin ? " disabled" : "")} onClick={() => changePage(item.id)} title={sidebarCollapsed ? item.label : undefined}>{item.icon}{!sidebarCollapsed && <span>{item.label}</span>}{item.id === "users" && !isAdmin && !sidebarCollapsed && <ShieldCheck size={12} className="nav-lock" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-help"><CircleHelpIcon />{!sidebarCollapsed && <span>Help & documentation</span>}</div><div className="sidebar-profile"><div className="profile-avatar">{(sessionEmail || "S").slice(0, 1).toUpperCase()}</div>{!sidebarCollapsed && <div className="profile-copy"><strong>{sessionEmail?.split("@")[0]}</strong><small>{role}</small></div>}<button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={15} /></button></div></div>
    </aside>
    {mobileNavOpen && <button className="mobile-nav-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
    <main className={"main-shell " + (sidebarCollapsed ? "sidebar-small" : "")}>
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setMobileNavOpen((v) => !v)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13} /><strong>{titles[page]}</strong></div></div>
        <div className="topbar-actions">
          <div className="global-search-wrap"><Search size={15} /><input value={globalQuery} onFocus={() => setShowSearch(true)} onChange={(e) => { setGlobalQuery(e.target.value); setShowSearch(true); }} placeholder="Search..." aria-label="Global search" /><kbd>⌘ K</kbd>
            {showSearch && <div className="search-popover">{globalQuery ? searchMatches.length ? searchMatches.map((match, i) => <button key={i} onClick={match.action}><Search size={14} /><span>{match.label}</span><small>{match.detail}</small></button>) : <div className="search-empty">No matching projects or modules.</div> : <div className="search-empty">Search projects and modules</div>}</div>}
          </div>
          <div className="topbar-popover-wrap"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setShowNotifications((v) => !v)}><Bell size={18} /><i /></button>{showNotifications && <div className="notification-popover"><strong>Notifications</strong><p>You’re all caught up.</p><small>Grade alerts and live activity will be available in Step 3.</small></div>}</div>
          <button className="icon-button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setDark((v) => !v)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="top-user" onClick={() => changePage("settings")}><span className="profile-avatar">{(sessionEmail || "S").slice(0, 1).toUpperCase()}</span><ChevronDown size={14} /></button>
        </div>
      </header>
      <section className="content-shell" onClick={() => { if (showSearch) setShowSearch(false); }}>
        <div className="page-heading"><div><div className="eyebrow muted">SOFTPULSE / {titles[page].toUpperCase()}</div><h1>{titles[page]}</h1><p>{pageIntro[page]}</p></div><div className="page-heading-right"><span className="environment-pill"><i /> {demoMode ? "Demo data" : "Workspace"}</span>{page === "projects" && <button className="button-primary mobile-add" onClick={() => setShowAddProject(true)}><Plus size={15} /> Add repo</button>}</div></div>
        {dataError && <div className="data-error" role="alert"><AlertTriangle size={16} /><span>{dataError}</span><button className="quiet-button" onClick={retryLoad}><RefreshCw size={14} /> Retry</button></div>}
        {renderPage()}
        <footer className="app-footer"><span>SoftPulse <b>0.2.0</b></span><span>Software health, made clear.</span><span>All times shown in your local timezone</span></footer>
      </section>
    </main>
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{navItems.filter((item) => ["dashboard", "projects", "scans", "modules"].includes(item.id)).map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => changePage(item.id)}>{item.icon}<small>{item.label}</small></button>)}<button onClick={() => setMobileNavOpen(true)}><Menu size={18} /><small>More</small></button></nav>

    {showAddProject && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddProject(false); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
      <div className="modal-heading"><div><div className="eyebrow muted">NEW REPOSITORY</div><h2 id="add-project-title">Add a GitHub repository</h2><p>Connect a public repository to start tracking its software health.</p></div><button className="icon-button" onClick={() => setShowAddProject(false)} aria-label="Close dialog"><X size={18} /></button></div>
      <form onSubmit={addProject} className="modal-form">
        <label htmlFor="repo-url">GitHub repository URL</label><div className={"input-wrap " + (repoTouched && repoInput && !validRepoUrl ? "invalid-input" : validRepoUrl ? "valid-input" : "")}><Github size={17} /><input id="repo-url" placeholder="https://github.com/owner/repository" value={repoInput} onBlur={() => setRepoTouched(true)} onChange={(e) => setRepoInput(e.target.value)} autoFocus />{validRepoUrl && <Check size={16} className="valid-check" />}</div>
        {repoTouched && repoInput && !validRepoUrl && <small className="field-error">Enter a valid public GitHub repository URL.</small>}
        {validRepoUrl && <small className="field-success">Repository URL looks valid.</small>}
        <label htmlFor="repo-name">Display name <span className="optional-label">Optional</span></label><div className="input-wrap"><Code2 size={17} /><input id="repo-name" placeholder="Use repository name by default" value={repoNameInput} onChange={(e) => setRepoNameInput(e.target.value)} /></div>
        <div className="modal-info"><ShieldCheck size={15} /><span>SoftPulse only reads public repository contents for this connection. GitHub write access is not requested.</span></div>
        <div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setShowAddProject(false)}>Cancel</button><button type="submit" className="button-primary" disabled={!validRepoUrl}><Plus size={15} /> Add repository</button></div>
      </form>
    </div></div>}
    {selectedModule && <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedModule(null); }}><aside className="module-drawer" role="dialog" aria-modal="true" aria-label="Module metrics">
      <div className="drawer-header"><div><div className="eyebrow muted">MODULE DETAIL</div><h2>{selectedModule.path.split("/").pop()}</h2></div><button className="icon-button" onClick={() => setSelectedModule(null)} aria-label="Close module detail"><X size={18} /></button></div>
      <p className="drawer-path">{selectedModule.path}</p><RiskPill risk={selectedModule.risk} />
      <div className="drawer-stat-grid"><div><strong>{selectedModule.lines_of_code.toLocaleString()}</strong><span>Lines of code</span></div><div><strong>{selectedModule.risk_probability}%</strong><span>Risk probability</span></div><div><strong>{selectedModule.estimated_refactor_hours}h</strong><span>Refactor estimate</span></div><div><strong>{selectedModule.technical_debt_ratio}%</strong><span>Debt ratio</span></div></div>
      <div className="drawer-section"><h3>Quality signals</h3><div className="drawer-metric-row"><span>Cyclomatic complexity</span><strong>{selectedModuleMetricValue("cyclomatic_complexity", selectedModule.complexity ?? "—")}</strong></div><div className="drawer-metric-row"><span>Test coverage</span><strong>{selectedModuleMetricValue("test_coverage_pct", selectedModule.coverage === undefined ? "Not available" : selectedModule.coverage + "%")}</strong></div><div className="drawer-metric-row"><span>Code smells</span><strong>{selectedModuleMetricValue("code_smells", selectedModule.smells ?? "—")}</strong></div></div>
      <div className="drawer-callout"><AlertTriangle size={16} /><p><strong>Suggested focus</strong><br />Review long functions and reduce nested control flow before the next release.</p></div>
      <button className="button-primary full-button" onClick={() => { setSelectedModule(null); changePage("risks"); }}>Open risk ranking <ArrowRight size={15} /></button>
    </aside></div>}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}<button onClick={() => setToast("")} aria-label="Dismiss notification"><X size={14} /></button></div>}
  </div>;
}

function CircleHelpIcon() { return <span className="help-icon">?</span>; }

function ScanTable({ scans, projects, onSelect }: { scans: Scan[]; projects: Project[]; onSelect: (scan: Scan) => void }) {
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Repository</th><th>Commit</th><th>Date</th><th>Health</th><th>Grade</th><th>Status</th><th /></tr></thead><tbody>{scans.map((scan) => <tr key={scan.id} onClick={() => onSelect(scan)} className="clickable-row"><td><div className="repo-cell"><Github size={15} /><strong>{getProject(projects, scan.project_id)?.name || "Repository"}</strong></div></td><td><code>{(scan.commit_sha || "—").slice(0, 8)}</code></td><td>{formatDate(scan.created_at)}</td><td><strong>{scan.health_score ?? "—"}</strong><span className="table-score-suffix">/100</span></td><td><GradeBadge grade={scan.grade || gradeFrom(scan.health_score)} /></td><td><span className="status-complete"><Check size={12} /> {scan.status}</span></td><td><ChevronRight size={15} className="table-chevron" /></td></tr>)}</tbody></table></div>;
}

function ModuleTable({ modules, onSelect }: { modules: Module[]; onSelect: (module: Module) => void }) {
  return <div className="data-table-wrap"><table className="data-table module-data-table"><thead><tr><th>Module</th><th>Language</th><th>Lines</th><th>Risk probability</th><th>Risk</th><th>Refactor effort</th><th /></tr></thead><tbody>{modules.map((module) => <tr key={module.id} onClick={() => onSelect(module)} className="clickable-row"><td><div className="module-name-cell"><FileCode2 size={15} /><strong>{module.path}</strong></div></td><td>{module.language || "—"}</td><td>{module.lines_of_code.toLocaleString()}</td><td><div className="table-risk-meter"><i className={riskClass(module.risk)} style={{ width: module.risk_probability + "%" }} /><span>{module.risk_probability}%</span></div></td><td><RiskPill risk={module.risk} /></td><td>{module.estimated_refactor_hours}h</td><td><ChevronRight size={15} className="table-chevron" /></td></tr>)}</tbody></table></div>;
}
